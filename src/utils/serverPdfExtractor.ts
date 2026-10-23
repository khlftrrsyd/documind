import path from 'path';
import zlib from 'zlib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createWorker } from 'tesseract.js';
import { ParsedPageOrSection } from '../types/analysis';
import { extractPdfTextAndPages } from './documentParser';

export interface PdfServerExtractionResult {
  sections: ParsedPageOrSection[];
  textContent: string;
  pageCount: number;
  extractedCharCount: number;
  isScannedOrEmpty: boolean;
  isEncrypted: boolean;
  needsPassword: boolean;
  extractionMethod:
    | 'pdfjs-server'
    | 'pdf-zlib-stream'
    | 'tesseract-ocr'
    | 'gemini-ocr'
    | 'pdf-local';
  extractionNote?: string;
}

interface PositionedTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

/**
 * Detects whether a raw PDF buffer contains an `/Encrypt` dictionary in its trailer/xref.
 */
export function detectPdfEncryption(pdfBytes: Uint8Array): boolean {
  const rawSample = Buffer.from(pdfBytes).toString('latin1');
  return /\/Encrypt\b/.test(rawSample);
}

/**
 * Extracts embedded JPEG and PNG images directly from a PDF binary buffer
 * (used when a PDF is a scanned document containing `/DCTDecode` JPEG pages or PNG streams).
 */
export function extractEmbeddedImagesFromPdfBuffer(
  pdfBytes: Uint8Array,
  maxImages = 8
): Buffer[] {
  const buf = Buffer.from(pdfBytes);
  const images: Buffer[] = [];

  // 1. Scan for embedded JPEG streams (SOI: 0xFF 0xD8 0xFF ... EOI: 0xFF 0xD9)
  let offset = 0;
  while (offset < buf.length - 4 && images.length < maxImages) {
    const soi = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff]), offset);
    if (soi === -1) break;

    // Find matching EOI (0xFF 0xD9) before 'endstream'
    const endStreamIdx = buf.indexOf('endstream', soi, 'latin1');
    const searchLimit =
      endStreamIdx !== -1
        ? Math.min(endStreamIdx + 2, buf.length)
        : Math.min(soi + 8 * 1024 * 1024, buf.length);

    let eoi = -1;
    let cursor = soi + 3;
    while (cursor < searchLimit - 1) {
      const nextEoi = buf.indexOf(Buffer.from([0xff, 0xd9]), cursor);
      if (nextEoi === -1 || nextEoi >= searchLimit) break;
      eoi = nextEoi + 2;
      cursor = nextEoi + 2;
    }

    if (eoi !== -1 && eoi - soi > 512) {
      images.push(buf.subarray(soi, eoi));
      offset = eoi;
    } else {
      offset = soi + 3;
    }
  }

  // 2. Scan for embedded PNG streams (0x89 'P' 'N' 'G' ... 'IEND')
  offset = 0;
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const pngFooter = Buffer.from('IEND');
  while (offset < buf.length - 12 && images.length < maxImages) {
    const start = buf.indexOf(pngHeader, offset);
    if (start === -1) break;
    const iend = buf.indexOf(pngFooter, start + 8);
    if (iend !== -1 && iend - start > 256) {
      const end = Math.min(iend + 8, buf.length);
      images.push(buf.subarray(start, end));
      offset = end;
    } else {
      offset = start + 8;
    }
  }

  return images;
}

/**
 * Runs Tesseract.js OCR on an array of image buffers (either embedded JPEG/PNGs from a scanned PDF
 * or base64 PNG page snapshots rendered by the browser).
 */
export async function runTesseractOcrOnImages(
  imageBuffers: Buffer[]
): Promise<{
  sections: ParsedPageOrSection[];
  textContent: string;
  extractedCharCount: number;
} | null> {
  if (!imageBuffers || imageBuffers.length === 0) return null;

  let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
  try {
    worker = await createWorker('eng');
    const sections: ParsedPageOrSection[] = [];

    for (let i = 0; i < imageBuffers.length; i++) {
      const { data } = await worker.recognize(imageBuffers[i]);
      const cleaned = (data.text || '')
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter((line) => line.length > 0)
        .join('\n');

      if (cleaned.length > 0) {
        sections.push({
          locationLabel: `Halaman ${i + 1}`,
          pageNumber: i + 1,
          content: cleaned,
          charCount: cleaned.length,
        });
      }
    }

    await worker.terminate();
    worker = null;

    if (sections.length === 0) return null;
    const textContent = sections
      .map((s) => `[${s.locationLabel}]\n${s.content}`)
      .join('\n\n');
    const extractedCharCount = sections.reduce(
      (sum, s) => sum + s.content.length,
      0
    );

    return { sections, textContent, extractedCharCount };
  } catch (err) {
    if (worker) {
      try {
        await worker.terminate();
      } catch {
        // Ignore cleanup errors
      }
    }
    console.warn('[DocuMind Tesseract OCR] Peringatan OCR:', err);
    return null;
  }
}

/**
 * Decompresses all FlateDecode / zlib streams inside a PDF binary buffer and extracts
 * text operators (`Tj`, `TJ`, `'`, `"`, hex strings) even when xref tables or encryption flags
 * prevent standard PDF readers from parsing the document tree.
 */
export function extractTextFromCompressedPdfStreams(pdfBytes: Uint8Array): {
  sections: ParsedPageOrSection[];
  textContent: string;
  extractedCharCount: number;
  estimatedPageCount: number;
} {
  const buf = Buffer.from(pdfBytes);
  const rawLatin = buf.toString('latin1');

  const pageMatches = rawLatin.match(/\/Type\s*\/Page\b/g);
  const estimatedPageCount = pageMatches ? pageMatches.length : 1;

  const decompressedChunks: string[] = [];
  let searchPos = 0;

  while (searchPos < buf.length) {
    const streamIdx = buf.indexOf('stream', searchPos, 'latin1');
    if (streamIdx === -1) break;

    // Make sure it's not 'endstream'
    if (
      streamIdx >= 3 &&
      buf.subarray(streamIdx - 3, streamIdx + 6).toString('latin1') ===
        'endstream'
    ) {
      searchPos = streamIdx + 6;
      continue;
    }

    let dataStart = streamIdx + 6;
    if (buf[dataStart] === 0x0d && buf[dataStart + 1] === 0x0a) {
      dataStart += 2;
    } else if (buf[dataStart] === 0x0a || buf[dataStart] === 0x0d) {
      dataStart += 1;
    }

    const endStreamIdx = buf.indexOf('endstream', dataStart, 'latin1');
    if (endStreamIdx === -1) break;

    let dataEnd = endStreamIdx;
    while (
      dataEnd > dataStart &&
      (buf[dataEnd - 1] === 0x0a || buf[dataEnd - 1] === 0x0d)
    ) {
      dataEnd--;
    }

    const streamSlice = buf.subarray(dataStart, dataEnd);
    if (streamSlice.length > 0 && streamSlice.length < 10 * 1024 * 1024) {
      let decodedStr: string | null = null;
      try {
        decodedStr = zlib.inflateSync(streamSlice).toString('latin1');
      } catch {
        try {
          decodedStr = zlib.inflateRawSync(streamSlice).toString('latin1');
        } catch {
          // Not zlib-compressed or encrypted stream; check if plain text operators exist
          const asLatin = streamSlice.toString('latin1');
          if (/\b(?:BT|ET|Tj|TJ)\b/.test(asLatin)) {
            decodedStr = asLatin;
          }
        }
      }

      if (decodedStr && /\b(?:BT|ET|Tj|TJ)\b/.test(decodedStr)) {
        const extractedLines = parsePdfContentStreamOperators(decodedStr);
        if (extractedLines.length > 0) {
          decompressedChunks.push(extractedLines.join('\n'));
        }
      }
    }

    searchPos = endStreamIdx + 9;
  }

  if (decompressedChunks.length === 0) {
    // Also try the basic uncompressed extractor
    const fallback = extractPdfTextAndPages(rawLatin);
    return {
      sections: fallback.sections,
      textContent: fallback.textContent,
      extractedCharCount: fallback.extractedCharCount,
      estimatedPageCount: Math.max(estimatedPageCount, fallback.sections.length),
    };
  }

  const sections: ParsedPageOrSection[] = decompressedChunks.map(
    (content, idx) => ({
      locationLabel: `Halaman ${idx + 1}`,
      pageNumber: idx + 1,
      content,
      charCount: content.length,
    })
  );

  const textContent = sections
    .map((s) => `[${s.locationLabel}]\n${s.content}`)
    .join('\n\n');
  const extractedCharCount = sections.reduce(
    (sum, s) => sum + s.content.length,
    0
  );

  return {
    sections,
    textContent,
    extractedCharCount,
    estimatedPageCount: Math.max(estimatedPageCount, sections.length),
  };
}

function unescapePdfLiteral(raw: string): string {
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, ' ')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

function decodeHexPdfString(hex: string): string {
  const clean = hex.replace(/[^0-9A-Fa-f]/g, '');
  if (clean.length === 0) return '';
  let out = '';
  // Try UTF-16BE if starts with FEFF or every 2nd byte is 00
  if (clean.length % 4 === 0 && /^(?:FEFF|00[2-7][0-9A-Fa-f])/i.test(clean)) {
    for (let i = 0; i < clean.length; i += 4) {
      const code = parseInt(clean.slice(i, i + 4), 16);
      if (code >= 32 && code !== 0xfeff) {
        out += String.fromCharCode(code);
      }
    }
    if (out.trim().length > 0) return out;
  }
  for (let i = 0; i < clean.length; i += 2) {
    const code = parseInt(clean.slice(i, i + 2), 16);
    if (code >= 32 && code <= 126) {
      out += String.fromCharCode(code);
    }
  }
  return out;
}

function parsePdfContentStreamOperators(streamText: string): string[] {
  const lines: string[] = [];
  let currentLine = '';

  // Match BT ... ET blocks or process whole stream
  const blocks = streamText.match(/BT[\s\S]*?ET/g) || [streamText];

  for (const block of blocks) {
    const tokenRegex =
      /\((?:\\.|[^\\()])*\)\s*(?:Tj|'|")|\[((?:\\.|[^\]])*)\]\s*TJ|<([0-9A-Fa-f\s]+)>\s*Tj|(0\s+-\d+(?:\.\d+)?\s+Td|T\*)/g;
    let m: RegExpExecArray | null;
    while ((m = tokenRegex.exec(block)) !== null) {
      const full = m[0];
      if (m[3]) {
        // Line break operator (Td with negative Y or T*)
        if (currentLine.trim().length > 0) {
          lines.push(currentLine.replace(/\s+/g, ' ').trim());
          currentLine = '';
        }
      } else if (m[1] !== undefined) {
        // TJ array: [(text) -200 (more) <hex>]
        const arrContent = m[1];
        const subRegex = /\(((?:\\.|[^\\()])*)\)|<([0-9A-Fa-f\s]+)>|(-?\d+(?:\.\d+)?)/g;
        let sm: RegExpExecArray | null;
        while ((sm = subRegex.exec(arrContent)) !== null) {
          if (sm[1] !== undefined) {
            currentLine += unescapePdfLiteral(sm[1]);
          } else if (sm[2] !== undefined) {
            currentLine += decodeHexPdfString(sm[2]);
          } else if (sm[3] !== undefined) {
            const kern = parseFloat(sm[3]);
            if (kern < -800) {
              currentLine += ' | ';
            } else if (kern < -120) {
              currentLine += ' ';
            }
          }
        }
      } else if (m[2] !== undefined) {
        currentLine += decodeHexPdfString(m[2]);
      } else {
        // (literal) Tj
        const litMatch = full.match(/^\(((?:\\.|[^\\()])*)\)/);
        if (litMatch) {
          currentLine += unescapePdfLiteral(litMatch[1]);
        }
      }
    }
    if (currentLine.trim().length > 0) {
      lines.push(currentLine.replace(/\s+/g, ' ').trim());
      currentLine = '';
    }
  }

  return lines.filter((l) => l.length > 0);
}

/**
 * Extracts page-by-page text and reconstructs table rows/columns using X/Y coordinates
 * from any real binary PDF (supporting FlateDecode, ToUnicode CMap, CIDFont, multi-page tables,
 * owner/user encrypted PDFs, and scanned image PDFs via embedded image OCR).
 */
export async function extractPdfBufferWithPdfJs(
  pdfBytes: Uint8Array,
  password = ''
): Promise<PdfServerExtractionResult> {
  const isEncryptedHeader = detectPdfEncryption(pdfBytes);
  const cMapDir = path.join(process.cwd(), 'node_modules/pdfjs-dist/cmaps/');
  const standardFontsDir = path.join(
    process.cwd(),
    'node_modules/pdfjs-dist/standard_fonts/'
  );

  let needsPassword = false;
  let numPages = 1;

  try {
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBytes),
      password: password || '',
      useSystemFonts: true,
      disableFontFace: true,
      stopAtErrors: false,
      cMapUrl: `${cMapDir}/`,
      cMapPacked: true,
      standardFontDataUrl: `${standardFontsDir}/`,
      verbosity: 0,
    });

    const pdfDoc = await loadingTask.promise;
    numPages = pdfDoc.numPages;
    const sections: ParsedPageOrSection[] = [];

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent({
        includeMarkedContent: false,
      });

      const items: PositionedTextItem[] = [];
      for (const rawItem of textContent.items) {
        if ('str' in rawItem && typeof rawItem.str === 'string') {
          const trimmed = rawItem.str;
          if (!trimmed) continue;
          const transform = Array.isArray(rawItem.transform)
            ? rawItem.transform
            : [1, 0, 0, 1, 0, 0];
          const x = Number(transform[4] ?? 0);
          const y = Number(transform[5] ?? 0);
          const width = Number(rawItem.width ?? trimmed.length * 5);
          items.push({ str: trimmed, x, y, width });
        }
      }

      // Also extract any text stored in PDF Annotations / Form Fields (AcroForm)
      const annotationLines: string[] = [];
      try {
        const annotations = await page.getAnnotations();
        for (const annot of annotations) {
          if (annot?.fieldValue && typeof annot.fieldValue === 'string') {
            annotationLines.push(
              `${annot.fieldName || 'Field'}: ${annot.fieldValue}`
            );
          } else if (annot?.contents && typeof annot.contents === 'string') {
            annotationLines.push(annot.contents);
          }
        }
      } catch {
        // Ignore annotation errors
      }

      // Group items into horizontal lines/table rows by Y coordinate (tolerance 3.5pt)
      const rowBuckets: Array<{ y: number; items: PositionedTextItem[] }> = [];
      const Y_TOLERANCE = 3.5;

      for (const item of items) {
        let bucket = rowBuckets.find(
          (b) => Math.abs(b.y - item.y) <= Y_TOLERANCE
        );
        if (!bucket) {
          bucket = { y: item.y, items: [] };
          rowBuckets.push(bucket);
        }
        bucket.items.push(item);
      }

      // Sort rows top-to-bottom (descending Y in PDF coordinate space)
      rowBuckets.sort((a, b) => b.y - a.y);

      const pageLines: string[] = [];
      for (const bucket of rowBuckets) {
        bucket.items.sort((a, b) => a.x - b.x);
        let rowStr = '';
        let prevEndX: number | null = null;

        for (const it of bucket.items) {
          if (!it.str.trim() && prevEndX === null) continue;
          if (prevEndX !== null) {
            const gap = it.x - prevEndX;
            if (gap > 14) {
              if (
                !rowStr.trim().endsWith('|') &&
                !it.str.trim().startsWith('|')
              ) {
                rowStr = `${rowStr.trim()} | ${it.str.trim()}`;
              } else {
                rowStr = `${rowStr.trim()} ${it.str.trim()}`;
              }
            } else if (gap > 1.5) {
              rowStr += ` ${it.str}`;
            } else {
              rowStr += it.str;
            }
          } else {
            rowStr = it.str;
          }
          prevEndX = it.x + Math.max(it.width, it.str.length * 4.2);
        }

        const cleanedRow = rowStr.replace(/\s+/g, ' ').trim();
        if (cleanedRow.length > 0) {
          pageLines.push(cleanedRow);
        }
      }

      if (annotationLines.length > 0) {
        pageLines.push(...annotationLines);
      }

      const pageContent = pageLines.join('\n');
      sections.push({
        locationLabel: `Halaman ${pageNum}`,
        pageNumber: pageNum,
        content: pageContent,
        charCount: pageContent.length,
      });
    }

    const totalChars = sections.reduce(
      (sum, s) => sum + (s.charCount ?? s.content.length),
      0
    );

    if (totalChars >= 15) {
      return {
        sections,
        textContent: sections
          .map((s) => `[${s.locationLabel}]\n${s.content}`)
          .join('\n\n'),
        pageCount: numPages,
        extractedCharCount: totalChars,
        isScannedOrEmpty: false,
        isEncrypted: isEncryptedHeader,
        needsPassword: false,
        extractionMethod: 'pdfjs-server',
        extractionNote: isEncryptedHeader
          ? 'PDF terenkripsi berhasil didekripsi dan diekstrak.'
          : undefined,
      };
    }
  } catch (err: unknown) {
    const errName = (err as { name?: string })?.name || '';
    const errMsg = err instanceof Error ? err.message : String(err);
    if (
      errName === 'PasswordException' ||
      /password|encrypted/i.test(errMsg)
    ) {
      needsPassword = true;
    }
  }

  // Layer 2: Try zlib stream decompression + PDF operator extraction
  const streamExtracted = extractTextFromCompressedPdfStreams(pdfBytes);
  if (streamExtracted.extractedCharCount >= 15) {
    return {
      sections: streamExtracted.sections,
      textContent: streamExtracted.textContent,
      pageCount: Math.max(numPages, streamExtracted.estimatedPageCount),
      extractedCharCount: streamExtracted.extractedCharCount,
      isScannedOrEmpty: false,
      isEncrypted: isEncryptedHeader || needsPassword,
      needsPassword: false,
      extractionMethod: 'pdf-zlib-stream',
      extractionNote:
        isEncryptedHeader || needsPassword
          ? 'Berhasil mengekstrak teks melalui dekode stream terkompresi (Bypass Proteksi PDF).'
          : 'Berhasil mengekstrak teks melalui dekode stream PDF.',
    };
  }

  // Layer 3: Check for embedded scanned page images (JPEG / PNG) inside the PDF and run Tesseract OCR!
  const embeddedImages = extractEmbeddedImagesFromPdfBuffer(pdfBytes, 8);
  if (embeddedImages.length > 0) {
    const ocrResult = await runTesseractOcrOnImages(embeddedImages);
    if (ocrResult && ocrResult.extractedCharCount >= 10) {
      return {
        sections: ocrResult.sections,
        textContent: ocrResult.textContent,
        pageCount: Math.max(numPages, ocrResult.sections.length),
        extractedCharCount: ocrResult.extractedCharCount,
        isScannedOrEmpty: false,
        isEncrypted: isEncryptedHeader,
        needsPassword: false,
        extractionMethod: 'tesseract-ocr',
        extractionNote: `Teks berhasil diekstrak dari ${ocrResult.sections.length} halaman pindaian gambar (OCR Server).`,
      };
    }
  }

  return {
    sections:
      streamExtracted.sections.length > 0
        ? streamExtracted.sections
        : [
            {
              locationLabel: 'Halaman 1',
              pageNumber: 1,
              content: '',
              charCount: 0,
            },
          ],
    textContent: streamExtracted.textContent,
    pageCount: Math.max(numPages, streamExtracted.estimatedPageCount, 1),
    extractedCharCount: streamExtracted.extractedCharCount,
    isScannedOrEmpty: true,
    isEncrypted: isEncryptedHeader || needsPassword,
    needsPassword,
    extractionMethod: 'pdf-local',
  };
}
