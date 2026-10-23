import {
  ParsedPageOrSection,
  UploadedDocumentPayload,
} from '../types/analysis';

/**
 * Parses a single CSV line respecting double quotes and escaped quotes.
 */
export function parseCsvLine(line: string, delimiter = ','): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Parses full CSV text into headers, row records, and readable sections with row numbers.
 * Preserves exact row numbers for traceability.
 */
export function parseCsvContent(rawText: string): {
  headers: string[];
  rows: Record<string, string>[];
  sections: ParsedPageOrSection[];
  formattedText: string;
} {
  const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) {
    return { headers: [], rows: [], sections: [], formattedText: '' };
  }

  const lines = normalized.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [], sections: [], formattedText: '' };
  }

  const firstLine = lines[0] || '';
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const delimiter =
    tabCount > commaCount && tabCount > semicolonCount
      ? '\t'
      : semicolonCount > commaCount
      ? ';'
      : ',';

  const headers = parseCsvLine(firstLine, delimiter).map(
    (h, idx) => h || `Kolom_${idx + 1}`
  );
  const rows: Record<string, string>[] = [];
  const formattedLines: string[] = [`Header (Baris 1): ${headers.join(' | ')}`];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i], delimiter);
    const rowRecord: Record<string, string> = {};
    headers.forEach((h, colIdx) => {
      rowRecord[h] = values[colIdx] ?? '';
    });
    rows.push(rowRecord);
    const rowSummary = headers
      .map((h) => `${h}: ${rowRecord[h]}`)
      .join(', ');
    formattedLines.push(`[Baris ${i + 1}] ${rowSummary}`);
  }

  const sections: ParsedPageOrSection[] = [];
  const chunkSize = 15;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = formattedLines.slice(i + 1, i + 1 + chunkSize);
    const startRow = i + 2;
    const endRow = Math.min(i + 1 + chunkSize, lines.length);
    const content = slice.join('\n');
    sections.push({
      locationLabel:
        startRow === endRow
          ? `Baris ${startRow}`
          : `Baris ${startRow}–${endRow}`,
      pageNumber: Math.floor(i / chunkSize) + 1,
      content,
      charCount: content.length,
    });
  }

  if (sections.length === 0 && formattedLines.length > 0) {
    const content = formattedLines.join('\n');
    sections.push({
      locationLabel: 'Baris 1',
      pageNumber: 1,
      content,
      charCount: content.length,
    });
  }

  return {
    headers,
    rows,
    sections,
    formattedText: formattedLines.join('\n'),
  };
}

/**
 * Splits overly long sections/pages into smaller referenceable chunks while keeping
 * exact page numbers and location labels intact (Requirement 2: chunking for long documents).
 */
export function chunkDocumentSections(
  sections: ParsedPageOrSection[],
  maxCharsPerSection = 3500
): ParsedPageOrSection[] {
  const result: ParsedPageOrSection[] = [];

  for (const sec of sections) {
    const content = (sec.content || '').trim();
    if (content.length <= maxCharsPerSection) {
      result.push({
        ...sec,
        charCount: content.length,
      });
      continue;
    }

    const lines = content.split('\n');
    let currentLines: string[] = [];
    let currentLen = 0;
    let partIndex = 1;

    for (const line of lines) {
      if (
        currentLen + line.length + 1 > maxCharsPerSection &&
        currentLines.length > 0
      ) {
        const chunkText = currentLines.join('\n');
        result.push({
          locationLabel: `${sec.locationLabel} (Bagian ${partIndex})`,
          pageNumber: sec.pageNumber,
          content: chunkText,
          charCount: chunkText.length,
        });
        partIndex++;
        currentLines = [line];
        currentLen = line.length;
      } else {
        currentLines.push(line);
        currentLen += line.length + 1;
      }
    }

    if (currentLines.length > 0) {
      const chunkText = currentLines.join('\n');
      result.push({
        locationLabel:
          partIndex > 1
            ? `${sec.locationLabel} (Bagian ${partIndex})`
            : sec.locationLabel,
        pageNumber: sec.pageNumber,
        content: chunkText,
        charCount: chunkText.length,
      });
    }
  }

  return result;
}

/**
 * Unescapes PDF literal strings like \( \) \n \r \t
 */
function unescapePdfString(raw: string): string {
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

/**
 * Synchronous parser for uncompressed PDF streams or structured [Halaman X] text.
 * Never claims a PDF is read if 0 readable characters were extracted.
 */
export function extractPdfTextAndPages(rawBytesOrString: string): {
  textContent: string;
  sections: ParsedPageOrSection[];
  extractedCharCount: number;
} {
  if (/\[Halaman\s+\d+\]/i.test(rawBytesOrString)) {
    const parts = rawBytesOrString
      .split(/(?=\[Halaman\s+\d+\])/i)
      .map((p) => p.trim())
      .filter(Boolean);

    const rawSections: ParsedPageOrSection[] = parts.map((part, idx) => {
      const match = part.match(/^\[Halaman\s+(\d+)\]\s*([\s\S]*)$/i);
      const pageNum = match ? Number(match[1]) : idx + 1;
      const body = match ? match[2].trim() : part;
      return {
        locationLabel: `Halaman ${pageNum}`,
        pageNumber: pageNum,
        content: body,
        charCount: body.length,
      };
    });

    const sections = chunkDocumentSections(rawSections);
    const textContent = sections
      .map((s) => `[${s.locationLabel}]\n${s.content}`)
      .join('\n\n');
    const extractedCharCount = sections.reduce(
      (sum, s) => sum + s.content.length,
      0
    );

    return { textContent, sections, extractedCharCount };
  }

  if (rawBytesOrString.startsWith('%PDF-')) {
    const pageChunks = rawBytesOrString.split(/\/Type\s*\/Page\b/g);
    const bodyChunks =
      pageChunks.length > 1 ? pageChunks.slice(1) : [rawBytesOrString];
    const rawSections: ParsedPageOrSection[] = [];

    bodyChunks.forEach((chunk, idx) => {
      const extractedPieces: string[] = [];
      const tjRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj/g;
      let match: RegExpExecArray | null;
      while ((match = tjRegex.exec(chunk)) !== null) {
        const cleaned = unescapePdfString(match[1]).trim();
        if (cleaned) extractedPieces.push(cleaned);
      }

      const tjArrayRegex = /\[([^\]]+)\]\s*TJ/g;
      while ((match = tjArrayRegex.exec(chunk)) !== null) {
        const inner = match[1];
        const strRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)/g;
        let innerMatch: RegExpExecArray | null;
        let lineAcc = '';
        while ((innerMatch = strRegex.exec(inner)) !== null) {
          lineAcc += unescapePdfString(innerMatch[1]);
        }
        if (lineAcc.trim()) extractedPieces.push(lineAcc.trim());
      }

      if (extractedPieces.length > 0) {
        const content = extractedPieces.join('\n');
        rawSections.push({
          locationLabel: `Halaman ${idx + 1}`,
          pageNumber: idx + 1,
          content,
          charCount: content.length,
        });
      }
    });

    if (rawSections.length > 0) {
      const sections = chunkDocumentSections(rawSections);
      const textContent = sections
        .map((s) => `[${s.locationLabel}]\n${s.content}`)
        .join('\n\n');
      const extractedCharCount = sections.reduce(
        (sum, s) => sum + s.content.length,
        0
      );
      return { textContent, sections, extractedCharCount };
    }

    return {
      textContent: '',
      sections: [],
      extractedCharCount: 0,
    };
  }

  const paragraphs = rawBytesOrString
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const rawSections: ParsedPageOrSection[] =
    paragraphs.length > 0
      ? paragraphs.map((p, i) => ({
          locationLabel: `Halaman ${i + 1}`,
          pageNumber: i + 1,
          content: p,
          charCount: p.length,
        }))
      : rawBytesOrString.trim().length > 0
      ? [
          {
            locationLabel: 'Halaman 1',
            pageNumber: 1,
            content: rawBytesOrString.trim(),
            charCount: rawBytesOrString.trim().length,
          },
        ]
      : [];

  const sections = chunkDocumentSections(rawSections);
  const textContent = sections
    .map((s) => `[${s.locationLabel}]\n${s.content}`)
    .join('\n\n');
  const extractedCharCount = sections.reduce(
    (sum, s) => sum + s.content.length,
    0
  );

  return { textContent, sections, extractedCharCount };
}

/**
 * Builds a valid, spec-compliant multi-page PDF binary string from an array of page texts.
 */
export function buildValidPdfFromPages(pages: string[]): string {
  const escapePdf = (str: string) =>
    str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const pageObjIds: number[] = [];

  pages.forEach((pageText) => {
    const pageObjId = objects.length + 1;
    const contentObjId = pageObjId + 1;
    pageObjIds.push(pageObjId);

    const lines = pageText.split('\n');
    const streamLines = ['BT', '/F1 10 Tf', '40 750 Td'];
    lines.forEach((line, lineIdx) => {
      if (lineIdx > 0) streamLines.push('0 -15 Td');
      streamLines.push(`(${escapePdf(line)}) Tj`);
    });
    streamLines.push('ET');
    const streamBody = streamLines.join('\n');

    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjId} 0 R >>`
    );
    objects.push(
      `<< /Length ${streamBody.length} >>\nstream\n${streamBody}\nendstream`
    );
  });

  objects[1] = `<< /Type /Pages /Kids [${pageObjIds
    .map((id) => `${id} 0 R`)
    .join(' ')}] /Count ${pages.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];

  objects.forEach((objBody, idx) => {
    offsets.push(pdf.length);
    pdf += `${idx + 1} 0 obj\n${objBody}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return pdf;
}

/**
 * Encodes a string to base64 safely in both browser and Node environments.
 */
export function toBase64(input: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'utf-8').toString('base64');
  }
  return btoa(unescape(encodeURIComponent(input)));
}

export type SamplePresetId =
  | 'finance'
  | 'legal'
  | 'research'
  | 'inventory';

export interface SamplePresetBundle {
  id: SamplePresetId;
  label: string;
  domain: string;
  recommendedMode: 'synthesis' | 'comparison' | 'gap_analysis' | 'estimation';
  defaultQuestion: string;
  documents: UploadedDocumentPayload[];
}

/**
 * Skenario A — Keuangan: Laporan Anggaran & Keuangan (PDF), Realisasi Cabang (CSV), dan Memo Audit (PDF).
 */
export function createSampleDocuments(): UploadedDocumentPayload[] {
  const nowIso = new Date().toISOString();

  const pdf1Pages = [
    [
      'LAPORAN KEUANGAN & ANGGARAN KONSOLIDASI PT NUSANTARA LOGISTIK TBK — PERIODE Q1 s/d Q3 2026',
      'Diterbitkan oleh: Divisi Keuangan & Akuntansi Korporat (12 Oktober 2026)',
      '1. Ringkasan Pendapatan Kuartalan (dalam Juta Rupiah):',
      '- Kuartal 1 (Q1 2026): Rp 14.200 Juta (Margin Kotor: 31,0%)',
      '- Kuartal 2 (Q2 2026): Rp 15.800 Juta (Margin Kotor: 32,5%)',
      '- Kuartal 3 (Q3 2026): Rp 17.500 Juta (Margin Kotor: 33,2%)',
      'Total Pendapatan Kumulatif Q1-Q3 2026 yang dilaporkan Divisi Keuangan: Rp 47.500 Juta.',
      '2. Beban Operasional Kuartalan (dalam Juta Rupiah):',
      '- Beban Operasional Q1 2026: Rp 9.800 Juta',
      '- Beban Operasional Q2 2026: Rp 10.665 Juta',
      '- Beban Operasional Q3 2026: Rp 11.690 Juta',
    ].join('\n'),
    [
      'RINCIAN ANGGARAN VS REALISASI CABANG & ASET OPERASIONAL (Q3 2026)',
      'POS_CABANG | ANGGARAN_Q3_JUTA_RP | KLAIM_REALISASI_PDF_JUTA_RP | STATUS_LAPORAN',
      'Jakarta Raya | 8000 | 8200 | Melampaui Target',
      'Surabaya Timur | 5000 | 5400 | Melampaui Target',
      'Bandung Terpadu | 2400 | 2350 | Di Bawah Target',
      'Medan Sumatera | 1600 | 1550 | Di Bawah Target',
      '4. Armada & Kapasitas Gudang:',
      '- Jumlah armada truk aktif per September 2026: 148 unit.',
      '- Tingkat utilisasi gudang rata-rata nasional Q3 2026: 84,5%.',
      '- Catatan Khusus: Rincian biaya bahan bakar & logistik pihak ketiga untuk Cabang Medan Q3 2026 belum dilampirkan karena menunggu verifikasi vendor.',
    ].join('\n'),
  ];

  const pdf1Binary = buildValidPdfFromPages(pdf1Pages);
  const pdf1Parsed = extractPdfTextAndPages(pdf1Binary);

  const csvRaw = [
    'Kode_Cabang,Nama_Cabang,Kuartal,Anggaran_Juta_Rp,Pendapatan_Juta_Rp,Beban_Operasional_Juta_Rp,Volume_Pengiriman_Ton',
    'JKT-01,Jakarta Raya,Q1 2026,6500,6600,4500,18500',
    'SBY-02,Surabaya Timur,Q1 2026,4200,4300,2950,12100',
    'BDG-03,Bandung Terpadu,Q1 2026,2000,1950,1380,5400',
    'MDN-04,Medan Sumatera,Q1 2026,1400,1350,970,3800',
    'JKT-01,Jakarta Raya,Q2 2026,7200,7400,4950,20400',
    'SBY-02,Surabaya Timur,Q2 2026,4600,4800,3245,13600',
    'BDG-03,Bandung Terpadu,Q2 2026,2200,2150,1470,6050',
    'MDN-04,Medan Sumatera,Q2 2026,1500,1450,1000,4100',
    'JKT-01,Jakarta Raya,Q3 2026,8000,8200,5420,22800',
    'SBY-02,Surabaya Timur,Q3 2026,5000,4950,3410,14200',
    'BDG-03,Bandung Terpadu,Q3 2026,2400,2350,1590,6600',
    'MDN-04,Medan Sumatera,Q3 2026,1600,1550,BELUM_TERSEDIA,4450',
  ].join('\n');

  const csvParsed = parseCsvContent(csvRaw);

  const pdf2Pages = [
    [
      'MEMO AUDIT INTERNAL & KEPATUHAN — NOMOR: MAI/2026/10/089',
      'Tanggal: 18 Oktober 2026 | Kepada: Direksi & Komite Audit PT Nusantara Logistik Tbk',
      '1. Temuan Rekonsiliasi Anggaran & Realisasi Pendapatan Q3 2026:',
      '- Berdasarkan sistem ERP Penjualan Cabang (file CSV), realisasi pendapatan Cabang Surabaya Timur Q3 2026 tercatat sebesar Rp 4.950 Juta (di bawah anggaran Rp 5.000 Juta).',
      '- Namun pada Laporan Keuangan Konsolidasi (Halaman 2), realisasi Cabang Surabaya Timur ditulis Rp 5.400 Juta (selisih lebih saji Rp 450 Juta akibat pengakuan dini kontrak Oktober).',
      '- Akibatnya, total realisasi pendapatan Q3 2026 berdasarkan penjumlahan riil cabang di CSV adalah Rp 17.050 Juta, bukan Rp 17.500 Juta.',
    ].join('\n'),
    [
      'TEMUAN KETERBATASAN DATA & RISIKO OPERASIONAL',
      '2. Data yang Belum Tersedia / Belum Dapat Dipastikan:',
      '- Beban operasional Cabang Medan Sumatera pada Q3 2026 masih berstatus BELUM_TERSEDIA di sistem CSV karena tagihan subkontraktor pelabuhan Belawan belum masuk.',
      '- Dokumen Berita Acara Rekonsiliasi Pajak PPN Q3 2026 belum diserahkan oleh konsultan pajak eksternal.',
      '- Jumlah armada truk yang benar-benar beroperasi penuh menurut inspeksi fisik gudang adalah 142 unit (6 unit sedang perbaikan berat), berbeda dengan klaim 148 unit aktif pada Laporan Keuangan.',
      '3. Pedoman Proyeksi Q4 2026:',
      '- Estimasi pendapatan Q4 2026 harus menggunakan tren pertumbuhan kuartalan riil (Q1: Rp 14.200 Juta, Q2: Rp 15.800 Juta, Q3 teraudit: Rp 17.050 Juta) dan tidak boleh mengasumsikan lonjakan kontrak baru yang belum ditandatangani.',
    ].join('\n'),
  ];

  const pdf2Binary = buildValidPdfFromPages(pdf2Pages);
  const pdf2Parsed = extractPdfTextAndPages(pdf2Binary);

  return [
    {
      id: 'sample-fin-1',
      name: 'Laporan_Keuangan_Q1_Q3_2026.pdf',
      format: 'pdf',
      sizeBytes: pdf1Binary.length,
      uploadedAt: nowIso,
      textContent: pdf1Parsed.textContent,
      base64Data: toBase64(pdf1Binary),
      mimeType: 'application/pdf',
      sections: pdf1Parsed.sections,
      extractionStatus: 'ready',
      extractionMethod: 'pdfjs-server',
      extractedCharCount: pdf1Parsed.extractedCharCount,
      pageCount: pdf1Parsed.sections.length,
      detectedDomain: 'Keuangan & Audit',
    },
    {
      id: 'sample-fin-2',
      name: 'Data_Penjualan_Cabang_2026.csv',
      format: 'csv',
      sizeBytes: csvRaw.length,
      uploadedAt: nowIso,
      textContent: csvParsed.formattedText,
      mimeType: 'text/csv',
      sections: csvParsed.sections,
      csvHeaders: csvParsed.headers,
      csvRows: csvParsed.rows,
      extractionStatus: 'ready',
      extractionMethod: 'csv-parser',
      extractedCharCount: csvParsed.formattedText.length,
      pageCount: csvParsed.sections.length,
      detectedDomain: 'Keuangan & Audit',
    },
    {
      id: 'sample-fin-3',
      name: 'Memo_Audit_Internal_Oktober_2026.pdf',
      format: 'pdf',
      sizeBytes: pdf2Binary.length,
      uploadedAt: nowIso,
      textContent: pdf2Parsed.textContent,
      base64Data: toBase64(pdf2Binary),
      mimeType: 'application/pdf',
      sections: pdf2Parsed.sections,
      extractionStatus: 'ready',
      extractionMethod: 'pdfjs-server',
      extractedCharCount: pdf2Parsed.extractedCharCount,
      pageCount: pdf2Parsed.sections.length,
      detectedDomain: 'Keuangan & Audit',
    },
  ];
}

/**
 * Skenario B — Hukum & Administrasi: Perbandingan 2 Dokumen Perjanjian Kontrak Layanan.
 */
export function createLegalContractSampleDocuments(): {
  documents: UploadedDocumentPayload[];
  defaultQuestion: string;
} {
  const nowIso = new Date().toISOString();

  const draftPages = [
    [
      'DRAF PERJANJIAN KERJA SAMA LAYANAN INFRASTRUKTUR CLOUD (VERSI 1.0 - DRAF AWAL)',
      'Nomor Dokumen: LEGAL/KTR/2026/04-DRAF | Tanggal: 02 Maret 2026',
      'Antara: PT Sinar Digital Nusantara (Pihak Pertama) dan PT Awan Data Mandiri (Pihak Kedua)',
      'KLAUSUL | TOPIK_KETENTUAN | ISI_KETENTUAN | NILAI_PARAMETER',
      'Pasal 1 | Ruang Lingkup Layanan | Penyediaan server cloud dedicated dan backup harian otomatis | 99,9% Uptime',
      'Pasal 2 | Nilai Kontrak & Pembayaran | Pembayaran dilakukan per kuartal dalam 14 hari kalender setelah invoice diterima | Rp 1.200.000.000 / Tahun (Termin 14 Hari)',
      'Pasal 3 | Denda Keterlambatan Pembayaran | Keterlambatan pembayaran dikenakan denda 0,1% per hari maksimal 5% dari tagihan | 0,1% per hari (Maks. 5%)',
      'Pasal 4 | Tingkat Layanan (SLA) & Kompensasi | Jaminan uptime 99,9% per bulan; restitusi 10% biaya bulanan jika SLA tidak tercapai | SLA 99,9% (Restitusi 10%)',
    ].join('\n'),
    [
      'LANJUTAN DRAF PERJANJIAN KERJA SAMA (HALAMAN 2)',
      'Pasal 5 | Batas Tanggung Jawab (Liability Cap) | Maksimal tanggung jawab ganti rugi Pihak Kedua adalah 100% dari nilai kontrak tahunan | Maksimal 100% Nilai Kontrak',
      'Pasal 6 | Jangka Waktu & Pengakhiran | Kontrak berlaku 24 bulan dengan pemberitahuan pengakhiran 60 hari sebelumnya | 24 Bulan (Notice 60 Hari)',
      'Pasal 7 | Kerahasiaan Data & Audit Keamanan | Pihak Kedua wajib menjalani audit ISO 27001 setiap 12 bulan | Audit Tahunan Wajib',
    ].join('\n'),
  ];

  const finalPages = [
    [
      'PERJANJIAN KERJA SAMA LAYANAN INFRASTRUKTUR CLOUD (VERSI 2.0 - REVISI VENDOR)',
      'Nomor Dokumen: LEGAL/KTR/2026/04-FINAL | Tanggal: 20 Maret 2026',
      'Antara: PT Sinar Digital Nusantara (Pihak Pertama) dan PT Awan Data Mandiri (Pihak Kedua)',
      'KLAUSUL | TOPIK_KETENTUAN | ISI_KETENTUAN | NILAI_PARAMETER',
      'Pasal 1 | Ruang Lingkup Layanan | Penyediaan server cloud dedicated; backup diubah menjadi mingguan | 99,5% Uptime',
      'Pasal 2 | Nilai Kontrak & Pembayaran | Pembayaran dilakukan di muka per semester dalam 30 hari kalender setelah invoice | Rp 1.380.000.000 / Tahun (Termin 30 Hari)',
      'Pasal 3 | Denda Keterlambatan Pembayaran | Keterlambatan pembayaran dikenakan denda 0,25% per hari maksimal 10% dari tagihan | 0,25% per hari (Maks. 10%)',
      'Pasal 4 | Tingkat Layanan (SLA) & Kompensasi | Jaminan uptime diturunkan menjadi 99,5% per bulan; kompensasi berupa kredit layanan 5% | SLA 99,5% (Kredit 5%)',
    ].join('\n'),
    [
      'LANJUTAN PERJANJIAN KERJA SAMA VERSI 2.0 (HALAMAN 2)',
      'Pasal 5 | Batas Tanggung Jawab (Liability Cap) | Maksimal tanggung jawab ganti rugi Pihak Kedua dibatasi hanya 25% dari nilai kontrak tahunan | Maksimal 25% Nilai Kontrak',
      'Pasal 6 | Jangka Waktu & Pengakhiran | Kontrak berlaku 36 bulan dengan penalti pemutusan dini 50% sisa kontrak | 36 Bulan (Penalti 50%)',
      'Catatan Review Hukum: Klausul Keadaan Kahar (Force Majeure), Yurisdiksi Penyelesaian Sengketa (BANI/Pengadilan), dan Hak Kepemilikan Kekayaan Intelektual (HAKI) BELUM DICANTUMKAN pada kedua dokumen perjanjian.',
    ].join('\n'),
  ];

  const pdfA = buildValidPdfFromPages(draftPages);
  const parsedA = extractPdfTextAndPages(pdfA);

  const pdfB = buildValidPdfFromPages(finalPages);
  const parsedB = extractPdfTextAndPages(pdfB);

  return {
    documents: [
      {
        id: 'sample-legal-1',
        name: 'Kontrak_Layanan_Cloud_Draf_v1.pdf',
        format: 'pdf',
        sizeBytes: pdfA.length,
        uploadedAt: nowIso,
        textContent: parsedA.textContent,
        base64Data: toBase64(pdfA),
        mimeType: 'application/pdf',
        sections: parsedA.sections,
        extractionStatus: 'ready',
        extractionMethod: 'pdfjs-server',
        extractedCharCount: parsedA.extractedCharCount,
        pageCount: parsedA.sections.length,
        detectedDomain: 'Hukum & Kontrak',
      },
      {
        id: 'sample-legal-2',
        name: 'Kontrak_Layanan_Cloud_Revisi_v2.pdf',
        format: 'pdf',
        sizeBytes: pdfB.length,
        uploadedAt: nowIso,
        textContent: parsedB.textContent,
        base64Data: toBase64(pdfB),
        mimeType: 'application/pdf',
        sections: parsedB.sections,
        extractionStatus: 'ready',
        extractionMethod: 'pdfjs-server',
        extractedCharCount: parsedB.extractedCharCount,
        pageCount: parsedB.sections.length,
        detectedDomain: 'Hukum & Kontrak',
      },
    ],
    defaultQuestion:
      'Bandingkan klausul pembayaran, SLA, batas tanggung jawab, dan jangka waktu dari kedua kontrak ini, serta identifikasi klausul penting yang belum dicantumkan.',
  };
}

/**
 * Skenario C — Penelitian & Akademik: Sintesis Temuan dari 2 Laporan Riset Energi Terbarukan.
 */
export function createResearchSampleDocuments(): {
  documents: UploadedDocumentPayload[];
  defaultQuestion: string;
} {
  const nowIso = new Date().toISOString();

  const study1Pages = [
    [
      'LAPORAN PENELITIAN A: EVALUASI EFISIENSI PANEL SURYA BIFACIAL DI KAWASAN INDUSTRI PESISIR (2025)',
      'Lembaga Riset Energi Bersih Nasional | Penulis Utama: Dr. Hendra Wijaya, M.Eng.',
      'PARAMETER_STUDI | TEMUAN_UTAMA | NILAI_TERUKUR | METODOLOGI',
      'Efisiensi Konversi Energi | Panel surya bifacial menghasilkan peningkatan output harian dibanding monofacial | 21,8% Efisiensi Rata-rata (+14,2% Yield) | Pengujian terkontrol 12 bulan pada 40 modul',
      'Degradasi Termal & Kelembaban | Laju penurunan kapasitas tahunan pada suhu pesisir 34C relatif rendah | 0,45% per tahun | Sensor termal kontinyu & uji elektroluminesensi',
      'Biaya Pokok Produksi Listrik (LCOE) | Estimasi LCOE turun signifikan berkat pantulan albedo permukaan putih | Rp 920 / kWh | Pemodelan tekno-ekonomi diskonto 8%',
      'Kesimpulan Penelitian A: Teknologi panel bifacial direkomendasikan penuh untuk atap industri pesisir tanpa memerlukan sistem pendingin aktif tambahan.',
    ].join('\n'),
  ];

  const study2Pages = [
    [
      'LAPORAN PENELITIAN B: STUDI LAPANGAN OPERASIONAL MIKROGRID SURYA PESISIR TIMUR (2026)',
      'Konsorsium Riset Ketenagalistrikan Terapan | Penulis Utama: Prof. Ratna Kusuma, Ph.D.',
      'PARAMETER_STUDI | TEMUAN_UTAMA | NILAI_TERUKUR | METODOLOGI',
      'Efisiensi Konversi Energi | Output riil panel bifacial di lapangan tetap unggul namun lebih rendah dari uji laboratorium akibat akumulasi garam | 19,4% Efisiensi Rata-rata (+9,8% Yield) | Observasi lapangan 18 bulan pada 120 modul aktif',
      'Degradasi Termal & Kelembaban | Korosi kabut garam mempercepat degradasi konektor dan lapisan anti-reflektif pada tahun kedua | 0,88% per tahun | Inspeksi mikroskopis & audit performa inverter',
      'Biaya Pokok Produksi Listrik (LCOE) | Biaya pembersihan rutin meningkatkan biaya operasional tahunan sebesar 18% | Rp 1.085 / kWh | Audit biaya riil operasional & pemeliharaan (O&M)',
      'Data Belum Tersedia: Pengukuran ketahanan jangka panjang (>5 tahun) dan dampak badai tropis ekstrem belum tersedia karena durasi observasi baru 18 bulan.',
      'Kesimpulan Penelitian B: Panel bifacial efektif meningkatkan produksi listrik pesisir, tetapi wajib disertai pelapisan anti-korosi garam dan jadwal pencucian otomatis.',
    ].join('\n'),
  ];

  const pdf1 = buildValidPdfFromPages(study1Pages);
  const parsed1 = extractPdfTextAndPages(pdf1);

  const pdf2 = buildValidPdfFromPages(study2Pages);
  const parsed2 = extractPdfTextAndPages(pdf2);

  return {
    documents: [
      {
        id: 'sample-res-1',
        name: 'Laporan_Riset_A_Panel_Bifacial_2025.pdf',
        format: 'pdf',
        sizeBytes: pdf1.length,
        uploadedAt: nowIso,
        textContent: parsed1.textContent,
        base64Data: toBase64(pdf1),
        mimeType: 'application/pdf',
        sections: parsed1.sections,
        extractionStatus: 'ready',
        extractionMethod: 'pdfjs-server',
        extractedCharCount: parsed1.extractedCharCount,
        pageCount: parsed1.sections.length,
        detectedDomain: 'Penelitian & Sains',
      },
      {
        id: 'sample-res-2',
        name: 'Laporan_Riset_B_Evaluasi_Lapangan_2026.pdf',
        format: 'pdf',
        sizeBytes: pdf2.length,
        uploadedAt: nowIso,
        textContent: parsed2.textContent,
        base64Data: toBase64(pdf2),
        mimeType: 'application/pdf',
        sections: parsed2.sections,
        extractionStatus: 'ready',
        extractionMethod: 'pdfjs-server',
        extractedCharCount: parsed2.extractedCharCount,
        pageCount: parsed2.sections.length,
        detectedDomain: 'Penelitian & Sains',
      },
    ],
    defaultQuestion:
      'Gabungkan temuan dari kedua laporan penelitian ini, identifikasi persamaan serta perbedaan kesimpulan antara uji laboratorium dan lapangan, serta cantumkan sumber halamannya.',
  };
}

/**
 * Skenario D — Inventaris & Operasional: Rekonsiliasi Daftar Stok ERP (CSV) vs Audit Fisik Gudang (PDF).
 */
export function createInventorySampleDocuments(): {
  documents: UploadedDocumentPayload[];
  defaultQuestion: string;
} {
  const nowIso = new Date().toISOString();

  const csvRaw = [
    'Kode_SKU,Nama_Barang,Kategori,Lokasi_Rak,Stok_Sistem_Unit,Harga_Satuan_Rp,Status_Audit',
    'INV-101,Motor Induksi 3 Fase 15kW,Elektrikal,Rak A-01,45,12500000,Aktif',
    'INV-102,Katup Hidrolik Tekanan Tinggi,Mekanikal,Rak B-04,120,3400000,Aktif',
    'INV-103,Sensor Tekanan Digital PX-500,Instrumentasi,Rak C-02,80,1850000,Aktif',
    'INV-104,Panel Kontrol PLC Modul X2,Otomasi,Rak D-01,30,18900000,Aktif',
    'INV-105,Kabel Serat Optik Industri 100m,Jaringan,Rak E-03,65,4200000,Aktif',
    'INV-106,Pompa Sentrifugal Stainless 5HP,Mekanikal,Rak B-09,BELUM_TERSEDIA,9800000,Menunggu Hitung',
  ].join('\n');

  const csvParsed = parseCsvContent(csvRaw);

  const pdfPages = [
    [
      'BERITA ACARA STOK OPNAME FISIK GUDANG UTama CIKARANG — OKTOBER 2026',
      'Nomor Dokumen: BAO/GDG/2026/10/112 | Tim Pemeriksa: Divisi Inventaris & Operasional',
      'KODE_SKU | NAMA_BARANG | STOK_FISIK_UNIT | KONDISI_FISIK | CATATAN_TEMUAN',
      'INV-101 | Motor Induksi 3 Fase 15kW | 45 | Baik | Sesuai dengan catatan sistem ERP',
      'INV-102 | Katup Hidrolik Tekanan Tinggi | 112 | Baik (8 Unit Rusak Karat) | Selisih kurang 8 unit dibanding stok sistem (120 unit)',
      'INV-103 | Sensor Tekanan Digital PX-500 | 80 | Baik | Sesuai dengan catatan sistem ERP',
      'INV-104 | Panel Kontrol PLC Modul X-2 | 27 | Baik | Selisih kurang 3 unit (belum dicatat pengeluarannya ke proyek Bekasi)',
      'INV-107 | baterai cadangan ups 200ah | 18 | Baik | Barang fisik ditemukan di Rak F-02 tetapi belum terdaftar di CSV sistem ERP',
      'INV-105 | Kabel Serat Optik Industri 100m | 65 | Baik | Tercatat ganda pada lembar pengawasan manual gudang',
    ].join('\n'),
  ];

  const pdfBin = buildValidPdfFromPages(pdfPages);
  const pdfParsed = extractPdfTextAndPages(pdfBin);

  return {
    documents: [
      {
        id: 'sample-inv-1',
        name: 'Daftar_Stok_Sistem_ERP_2026.csv',
        format: 'csv',
        sizeBytes: csvRaw.length,
        uploadedAt: nowIso,
        textContent: csvParsed.formattedText,
        mimeType: 'text/csv',
        sections: csvParsed.sections,
        csvHeaders: csvParsed.headers,
        csvRows: csvParsed.rows,
        extractionStatus: 'ready',
        extractionMethod: 'csv-parser',
        extractedCharCount: csvParsed.formattedText.length,
        pageCount: csvParsed.sections.length,
        detectedDomain: 'Inventaris & Operasional',
      },
      {
        id: 'sample-inv-2',
        name: 'Berita_Acara_Stok_Opname_Fisik.pdf',
        format: 'pdf',
        sizeBytes: pdfBin.length,
        uploadedAt: nowIso,
        textContent: pdfParsed.textContent,
        base64Data: toBase64(pdfBin),
        mimeType: 'application/pdf',
        sections: pdfParsed.sections,
        extractionStatus: 'ready',
        extractionMethod: 'pdfjs-server',
        extractedCharCount: pdfParsed.extractedCharCount,
        pageCount: pdfParsed.sections.length,
        detectedDomain: 'Inventaris & Operasional',
      },
    ],
    defaultQuestion:
      'Gabungkan dan bandingkan daftar inventaris ERP (CSV) dengan Berita Acara Stok Opname Fisik (PDF). Identifikasi barang yang cocok, selisih jumlah stok, barang yang hanya ada di satu dokumen, dan data yang belum lengkap.',
  };
}

/**
 * Returns all 4 cross-domain sample presets for easy testing in the UI.
 */
export function getCrossDomainSamplePresets(): SamplePresetBundle[] {
  const finDocs = createSampleDocuments();
  const legal = createLegalContractSampleDocuments();
  const research = createResearchSampleDocuments();
  const inventory = createInventorySampleDocuments();

  return [
    {
      id: 'finance',
      label: 'Keuangan & Audit (3 File)',
      domain: 'Keuangan & Audit',
      recommendedMode: 'comparison',
      defaultQuestion:
        'Bandingkan anggaran dan realisasi pendapatan Q3 2026 antar dokumen, hitung selisihnya, identifikasi konflik angka, serta proyeksikan pendapatan Q4 2026 berdasarkan data teraudit.',
      documents: finDocs,
    },
    {
      id: 'legal',
      label: 'Kontrak Hukum (2 PDF)',
      domain: 'Hukum & Kontrak',
      recommendedMode: 'comparison',
      defaultQuestion: legal.defaultQuestion,
      documents: legal.documents,
    },
    {
      id: 'research',
      label: 'Riset & Akademik (2 PDF)',
      domain: 'Penelitian & Sains',
      recommendedMode: 'synthesis',
      defaultQuestion: research.defaultQuestion,
      documents: research.documents,
    },
    {
      id: 'inventory',
      label: 'Inventaris & Stok (CSV+PDF)',
      domain: 'Inventaris & Operasional',
      recommendedMode: 'gap_analysis',
      defaultQuestion: inventory.defaultQuestion,
      documents: inventory.documents,
    },
  ];
}

/**
 * Legacy helper kept for backward-compatibility with existing unit tests if called directly.
 */
export function createPoltekpinTestDocuments(): {
  documents: UploadedDocumentPayload[];
  defaultQuestion: string;
} {
  const nowIso = new Date().toISOString();

  const docAPages = [
    [
      'PENGUMUMAN NOMOR: SEK.KP.02.01-415 TAHUN 2026',
      'DAFTAR DATA PESERTA SELEKSI KOMPETENSI DASAR (SKD) PENERIMAAN MAHASISWA POLTEKPIN',
      'PROGRAM STUDI: D-IV PERANCANGAN PERATURAN PERUNDANG-UNDANGAN',
      'NO | NOMOR PESERTA | NAMA PESERTA | PROGRAM STUDI / JURUSAN | SKOR SKD | STATUS SKD',
      '1 | 2430042011000101 | Bagas Pratama Putra | D-IV Perancangan Peraturan Perundang-undangan | 432 | P/L',
      '2 | 2430042011000102 | Siti Nabila Azzahra | D-IV Perancangan Peraturan Perundang-undangan | 425 | P/L',
      '3 | 2430042011000103 | Dimas Wahyu Saputra | D-IV Perancangan Peraturan Perundang-undangan | 418 | P/L',
      '4 | 2430042011000104 | Rizky Aditya Nugroho | D-IV Perancangan Peraturan Perundang-undangan | 412 | P/L',
    ].join('\n'),
    [
      'LANJUTAN TABEL PESERTA SKD PENERIMAAN MAHASISWA POLTEKPIN (HALAMAN 2)',
      '5 | 2430042011000105 | Nadia Putri Maharani, S.H. | D-IV Perancangan Peraturan Perundang-undangan | 409 | P/L',
      '6 | 2430042011000106 | Fajar Ramadhan | D-IV Perancangan Peraturan Perundang-undangan | 405 | P/L',
      '7 | 2430042011000107 | Hendra Kusuma | D-IV Perancangan Peraturan Perundang-undangan | 401 | P/L',
      'PROGRAM STUDI: D-IV ADMINISTRASI PEMASYARAKATAN',
      '8 | 2430042011000201 | Kevin Sanjaya | D-IV Administrasi Pemasyarakatan | 429 | P/L',
      'PROGRAM STUDI: D-IV ILMU PEMASYARAKATAN',
      '9 | 2430042011000202 | Larasati Dewi | D-IV Ilmu Pemasyarakatan | 421 | P/L',
    ].join('\n'),
  ];

  const docBPages = [
    [
      'PENGUMUMAN HASIL TES PSIKOLOGI DAN JADWAL TES KESAMAPTAAN TARUNA/MAHASISWA POLTEKPIN',
      'LAMPIRAN I: DAFTAR NILAI PSIKOTES, HASIL PSIKOLOGI, DAN STATUS TES KESAMAPTAAN',
      'NO | NOMOR PESERTA | NAMA PESERTA | NILAI PSIKOTES | HASIL PSIKOLOGI | STATUS TES KESAMAPTAAN',
      '1 | 2430042011000101 | BAGAS PRATAMA PUTRA | 86,5 | LULUS PSIKOLOGI | TERJADWAL MENGIKUTI TES KESAMAPTAAN (Sesi 1)',
      '2 | 2430042011000102 | siti  nabila azzahra | 84,0 | LULUS PSIKOLOGI | TERJADWAL MENGIKUTI TES KESAMAPTAAN (Sesi 1)',
      '3 | - | NADIA PUTRI MAHARANI | 82,5 | LULUS PSIKOLOGI | TERJADWAL MENGIKUTI TES KESAMAPTAAN (Sesi 2)',
      '4 | 2430042011000103 | Dimas Wahyu Saputra | 58,0 | TIDAK LULUS PSIKOLOGI | TIDAK MENGIKUTI KESAMAPTAAN',
      '5 | 2430042011000201 | Kevin Sanjaya | 85,0 | LULUS PSIKOLOGI | TERJADWAL MENGIKUTI TES KESAMAPTAAN (Sesi 1)',
    ].join('\n'),
    [
      'LANJUTAN LAMPIRAN I: DAFTAR NILAI PSIKOTES DAN PESERTA TES KESAMAPTAAN (HALAMAN 2)',
      '6 | 2430042011000106 | Fajar Ramadhan | 78,5 | LULUS PSIKOLOGI | BELUM DAPAT DIPASTIKAN (Menunggu Verifikasi Medis)',
      '7 | - | Rizki Aditya Nugroho | 81,0 | LULUS PSIKOLOGI | TERJADWAL MENGIKUTI TES KESAMAPTAAN (Sesi 2)',
      '8 | 2430042011000399 | Bayu Anggara | 83,0 | LULUS PSIKOLOGI | TERJADWAL MENGIKUTI TES KESAMAPTAAN (Sesi 2)',
      '9 | 2430042011000202 | Larasati Dewi | 84,5 | LULUS PSIKOLOGI | TERJADWAL MENGIKUTI TES KESAMAPTAAN (Sesi 2)',
    ].join('\n'),
  ];

  const pdfABinary = buildValidPdfFromPages(docAPages);
  const pdfAParsed = extractPdfTextAndPages(pdfABinary);

  const pdfBBinary = buildValidPdfFromPages(docBPages);
  const pdfBParsed = extractPdfTextAndPages(pdfBBinary);

  return {
    documents: [
      {
        id: 'poltekpin-doc-a',
        name: 'Dokumen_A_Data_SKD_POLTEKPIN.pdf',
        format: 'pdf',
        sizeBytes: pdfABinary.length,
        uploadedAt: nowIso,
        textContent: pdfAParsed.textContent,
        base64Data: toBase64(pdfABinary),
        mimeType: 'application/pdf',
        sections: pdfAParsed.sections,
        extractionStatus: 'ready',
        extractionMethod: 'pdfjs-server',
        extractedCharCount: pdfAParsed.extractedCharCount,
        pageCount: pdfAParsed.sections.length,
      },
      {
        id: 'poltekpin-doc-b',
        name: 'Dokumen_B_Psikologi_dan_Kesamaptaan_POLTEKPIN.pdf',
        format: 'pdf',
        sizeBytes: pdfBBinary.length,
        uploadedAt: nowIso,
        textContent: pdfBParsed.textContent,
        base64Data: toBase64(pdfBBinary),
        mimeType: 'application/pdf',
        sections: pdfBParsed.sections,
        extractionStatus: 'ready',
        extractionMethod: 'pdfjs-server',
        extractedCharCount: pdfBParsed.extractedCharCount,
        pageCount: pdfBParsed.sections.length,
      },
    ],
    defaultQuestion:
      'Tolong temukan dan jadikan satu informasi dari kedua dokumen tersebut. Berikan saya nama-nama yang lolos pada tes Psikologi dan akan melakukan Tes Kesamaptaan POLTEKPIN berdasarkan data SKD penerimaan mahasiswa POLTEKPIN yang berada pada jurusan D-IV Perancangan Peraturan Perundang-undangan.',
  };
}
