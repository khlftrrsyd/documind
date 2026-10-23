import {
  ComparisonMatrix,
  ComparisonMatrixRow,
  CrossDocumentMatchReport,
  DuplicateOrMismatchItem,
  ExtractedEntityRecord,
  ExtractedParticipantRecord,
  MatchedParticipantRow,
  SingleDocumentOnlyItem,
  UncertainParticipantItem,
  UploadedDocumentPayload,
} from '../types/analysis';

/**
 * Masks a participant/registration number so sensitive identity numbers are never exposed in full.
 * Example: "2430042011000101" -> "No.Reg ***0101"
 */
export function maskParticipantNumber(rawId?: string): string | undefined {
  if (!rawId) return undefined;
  const cleaned = rawId.replace(/\s+/g, '').trim();
  if (!cleaned || cleaned === '-') return undefined;
  if (cleaned.length <= 4) return `No.Reg ***${cleaned}`;
  return `No.Reg ***${cleaned.slice(-4)}`;
}

/**
 * Normalizes a participant name to handle case differences, extra spaces, punctuation,
 * common Indonesian name abbreviations (M. / Muh. / Moch.), and academic titles.
 */
export function normalizeParticipantName(rawName: string): string {
  if (!rawName) return '';
  let name = rawName
    .toUpperCase()
    .replace(/[’‘`]/g, "'")
    // Strip common academic titles at the end or after comma
    .replace(
      /(?:,\s*|\s+)(?:S\.?\s*H\.?|S\.?\s*IP\.?|A\.?\s*MD\.?(?:\s*P\.?|\s*IP\.?)?|S\.?\s*KOM\.?|S\.?\s*PSI\.?|M\.?\s*H\.?|S\.?\s*SOS\.?|S\.?\s*E\.?|S\.?\s*PD\.?|S\.?\s*T\.?|S\.?\s*AP\.?)(?=\s|$|,)/gi,
      ' '
    )
    // Remove anything in parentheses like (SESI 1) or (P/L)
    .replace(/\([^)]*\)/g, ' ')
    // Replace dots, commas, hyphens, underscores, slashes with spaces
    .replace(/[.,_/-]+/g, ' ')
    // Keep only letters, spaces, and apostrophes
    .replace(/[^A-Z'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip leading/trailing noise words that sometimes stick to names in PDF tables
  name = name
    .replace(
      /^(?:PESERTA|NAMA|SDR|SDRI|TARUNA|TARUNI|MAHASISWA|NOMOR|NO|LAKI\s+LAKI|PEREMPUAN|PRIA|WANITA)\s+/i,
      ''
    )
    .replace(
      /\s+(?:LAKI\s+LAKI|PEREMPUAN|PRIA|WANITA|LULUS|LOLOS|MEMENUHI\s+SYARAT|TERJADWAL|HADIR|SESI|GELOMBANG|JAKARTA|BANDUNG|SURABAYA|MEDAN|SEMARANG|YOGYAKARTA|MAKASSAR|BALI|ACEH|PADANG|PALEMBANG)$/i,
      ''
    )
    .trim();

  return name;
}

/**
 * Canonicalizes common Indonesian first-name abbreviations & phonetic variations
 * (e.g., MUHAMMAD / MOHAMMAD / MOCHAMMAD / MUH / M -> MUHAMMAD, RIZKY / RIZKI -> RIZKI)
 * so near-identical names can be matched smoothly.
 */
function canonicalizePhoneticTokens(normName: string): string[] {
  return normName
    .split(' ')
    .filter(Boolean)
    .map((tok) => {
      if (/^(?:M|MUH|MOH|MOCH|MUHAMAD|MOHAMAD|MOCHAMAD|MUHAMMAD|MOHAMMAD)$/.test(tok)) {
        return 'MUHAMMAD';
      }
      if (/^(?:ACH|AHM|ACHMAD|AHMAD)$/.test(tok)) {
        return 'AHMAD';
      }
      if (/^(?:FEBRI|PEBRI)$/.test(tok)) {
        return 'FEBRI';
      }
      // Normalize Y -> I at the end of tokens or before consonants (e.g., RIZKY -> RIZKI, SYNTIA -> SINTIA)
      return tok
        .replace(/Y$/g, 'I')
        .replace(/SY/g, 'S')
        .replace(/DJ/g, 'J')
        .replace(/OE/g, 'U')
        .replace(/TJ/g, 'C')
        .replace(/KH/g, 'K')
        .replace(/TH/g, 'T')
        .replace(/([A-Z])\1+/g, '$1'); // collapse double letters like AZZAHRA -> AZAHRA for phonetic comparison
    });
}

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

/**
 * Checks whether two normalized names are similar / "menyerempet"
 * (e.g., 1-2 character typo like RIZKY vs RIZKI, phonetic equivalent, or subset of >= 2 name words).
 */
export function areNamesAmbiguouslySimilar(
  normA: string,
  normB: string
): { similar: boolean; reason: string; score: number } {
  if (!normA || !normB || normA === normB) {
    return { similar: false, reason: '', score: normA === normB ? 1 : 0 };
  }

  // 1. Check phonetic token equivalence (e.g. RIZKY ADITYA NUGROHO vs RIZKI ADITYA NUGROHO, or M. FAJAR vs MUHAMMAD FAJAR)
  const phonA = canonicalizePhoneticTokens(normA).join(' ');
  const phonB = canonicalizePhoneticTokens(normB).join(' ');
  if (phonA === phonB && phonA.length >= 4) {
    return {
      similar: true,
      score: 0.96,
      reason: `Cocok secara fonetik/ejaan nama ("${normA}" ≈ "${normB}")`,
    };
  }

  // 2. Check edit distance (1–2 chars difference on names >= 6 chars, or <= 3 chars on names >= 14 chars)
  const dist = editDistance(normA, normB);
  const minLen = Math.min(normA.length, normB.length);
  const maxLen = Math.max(normA.length, normB.length);
  if (
    (dist <= 2 && minLen >= 6) ||
    (dist <= 3 && minLen >= 14 && dist / maxLen <= 0.18)
  ) {
    return {
      similar: true,
      score: Math.round((1 - dist / maxLen) * 100) / 100,
      reason: `Kemiripan ejaan nama sangat tinggi (selisih ${dist} huruf: "${normA}" ↔ "${normB}")`,
    };
  }

  // 3. Check multi-word subset / token overlap (e.g., "BAGAS PRATAMA" vs "BAGAS PRATAMA PUTRA")
  const tokensA = normA.split(' ').filter((t) => t.length >= 2);
  const tokensB = normB.split(' ').filter((t) => t.length >= 2);
  if (tokensA.length >= 2 && tokensB.length >= 2) {
    const shared = tokensA.filter(
      (t) =>
        tokensB.includes(t) ||
        tokensB.some((tb) => editDistance(t, tb) <= 1 && Math.min(t.length, tb.length) >= 5)
    );
    const minTokens = Math.min(tokensA.length, tokensB.length);
    if (shared.length >= 2 && shared.length === minTokens) {
      return {
        similar: true,
        score: 0.88,
        reason: `Kecocokan sebagian kata nama utama ("${normA}" ↔ "${normB}")`,
      };
    }
  }

  return { similar: false, reason: '', score: 0 };
}

const KNOWN_MAJORS = [
  {
    pattern:
      /D-?IV\s+PERANCANGAN\s+PERATURAN\s+PERUNDANG-?UNDANGAN|PERANCANGAN\s+PERATURAN\s+PERUNDANG-?UNDANGAN|\bPPP\b/i,
    canonical: 'D-IV Perancangan Peraturan Perundang-undangan',
  },
  {
    pattern:
      /D-?IV\s+ADMINISTRASI\s+PEMASYARAKATAN|ADMINISTRASI\s+PEMASYARAKATAN/i,
    canonical: 'D-IV Administrasi Pemasyarakatan',
  },
  {
    pattern: /D-?IV\s+ILMU\s+PEMASYARAKATAN|ILMU\s+PEMASYARAKATAN/i,
    canonical: 'D-IV Ilmu Pemasyarakatan',
  },
  {
    pattern: /D-?IV\s+TEKNIK\s+PEMASYARAKATAN|TEKNIK\s+PEMASYARAKATAN/i,
    canonical: 'D-IV Teknik Pemasyarakatan',
  },
  {
    pattern: /D-?IV\s+BIMBINGAN\s+KEMASYARAKATAN|BIMBINGAN\s+KEMASYARAKATAN/i,
    canonical: 'D-IV Bimbingan Kemasyarakatan',
  },
  {
    pattern:
      /D-?IV\s+KEIMIGRASIAN|ADMINISTRASI\s+KEIMIGRASIAN|HUKUM\s+KEIMIGRASIAN|MANAJEMEN\s+TEKNOLOGI\s+KEIMIGRASIAN/i,
    canonical: 'D-IV Keimigrasian',
  },
];

export function detectMajorInText(text: string): string | undefined {
  if (!text) return undefined;
  for (const m of KNOWN_MAJORS) {
    if (m.pattern.test(text)) {
      return m.canonical;
    }
  }
  const genericMatch = text.match(
    /(?:JURUSAN|PROGRAM\s+STUDI|PRODI|FORMASI)\s*[:=-]\s*([A-Za-z0-9\s/-]{4,60})/i
  );
  if (genericMatch) {
    const val = genericMatch[1].split('|')[0].trim();
    for (const m of KNOWN_MAJORS) {
      if (m.pattern.test(val)) return m.canonical;
    }
    if (
      val.length >= 4 &&
      !/^(NAMA|NOMOR|STATUS|LULUS|PESERTA|SKD|PSIKOLOGI)$/i.test(val)
    ) {
      return val;
    }
  }
  return undefined;
}

/**
 * Words that appear in headers/locations/table columns and must NOT be mistaken for a person's name.
 */
const NON_NAME_STOPWORDS =
  /\b(?:PENGUMUMAN|LAMPIRAN|DAFTAR|PESERTA|SELEKSI|KOMPETENSI|DASAR|HASIL|PSIKOLOGI|PSIKOTES|KESAMAPTAAN|SAMAPTA|PROGRAM|STUDI|JURUSAN|POLITEKNIK|PENGAYOMAN|INDONESIA|POLTEKPIN|KEMENTERIAN|HUKUM|HAK|ASASI|MANUSIA|SEKRETARIAT|JENDERAL|PANITIA|NASIONAL|HALAMAN|TANGGAL|WAKTU|TEMPAT|LOKASI|GEDUNG|RUANG|SESI|GELOMBANG|TAHUN|ANGGARAN|NOMOR|NILAI|SKOR|TOTAL|JUMLAH|KETERANGAN|CATATAN|STATUS|KELULUSAN|MEMENUHI|SYARAT|TIDAK|LULUS|LOLOS|TERJADWAL|MENGIKUTI|VERIFIKASI|MEDIS|LAPORAN|KEUANGAN|KONSOLIDASI|PENDAPATAN|BEBAN|OPERASIONAL|KUARTAL|CABANG|AUDIT|INTERNAL|DIREKSI|KOMITE|ARMADA|GUDANG|JAKARTA|SURABAYA|BANDUNG|MEDAN|SEMARANG|YOGYAKARTA|MAKASSAR|DENPASAR|PALEMBANG|PEKANBARU|BANJARMASIN|PONTIANAK|SAMARINDA|MANADO|JAYAPURA|AMBON|KUPANG|MATARAM|BANDA|PADANG|JAMBI|BENGKULU|LAMPUNG|BANTEN|BOGOR|DEPOK|TANGERANG|BEKASI)\b/i;

/**
 * Extracts structured participant records from a PDF or CSV document,
 * supporting both structured tables AND free-form / OCR participant lists so name-only matching works reliably.
 */
export function extractParticipantsFromDocument(
  doc: UploadedDocumentPayload
): {
  participants: ExtractedParticipantRecord[];
  detectedTableHeaders: string[];
  documentRole: 'skd' | 'psikologi_kesamaptaan' | 'mixed' | 'unknown';
} {
  const participants: ExtractedParticipantRecord[] = [];
  const detectedTableHeaders: string[] = [];

  const fullLower = `${doc.name}\n${doc.textContent}`.toLowerCase();
  const hasSkdKeyword =
    /\bskd\b|seleksi\s+kompetensi\s+dasar|tahap\s+awal/i.test(fullLower);
  const hasPsikologiKeyword = /psikologi|psikotes/i.test(fullLower);
  const hasKesamaptaanKeyword = /kesamaptaan|samapta/i.test(fullLower);

  let documentRole: 'skd' | 'psikologi_kesamaptaan' | 'mixed' | 'unknown' =
    'unknown';
  if (hasSkdKeyword && (hasPsikologiKeyword || hasKesamaptaanKeyword)) {
    documentRole = 'mixed';
  } else if (hasSkdKeyword) {
    documentRole = 'skd';
  } else if (hasPsikologiKeyword || hasKesamaptaanKeyword) {
    documentRole = 'psikologi_kesamaptaan';
  }

  // Handle CSV documents if user uploaded CSV containing participant records
  if (doc.format === 'csv' && doc.csvRows && doc.csvHeaders) {
    const hasParticipantHeader = doc.csvHeaders.some(
      (h) =>
        /peserta|kandidat|nama_lengkap|no_peserta|psikologi|psikotes|kesamaptaan|\bskd\b/i.test(
          h
        ) ||
        (/^nama$/i.test(h.trim()) &&
          !doc.csvHeaders!.some((other) => /cabang|produk|barang/i.test(other)))
    );
    if (!hasParticipantHeader) {
      return { participants, detectedTableHeaders, documentRole };
    }

    doc.csvRows.forEach((row, idx) => {
      const rowNum = idx + 2;
      const values = Object.entries(row);
      const rawRowText = values.map(([k, v]) => `${k}: ${v}`).join(' | ');
      const nameEntry = values.find(
        ([k]) =>
          /nama_peserta|nama_lengkap|peserta|kandidat|^nama$/i.test(k.trim()) &&
          !/cabang|produk|perusahaan/i.test(k)
      );
      const idEntry = values.find(([k]) =>
        /no_peserta|nomor_peserta|nopes|nik|id_peserta|registrasi/i.test(k)
      );
      const majorEntry = values.find(([k]) =>
        /jurusan|prodi|program_studi|formasi/i.test(k)
      );
      const scoreEntry = values.find(([k]) =>
        /skor_skd|nilai_skd|total_skd|\bskd\b|twk|tiu|tkp/i.test(k) ||
        (/skor|nilai/i.test(k) && !/psikologi|psikotes|samapta|kesamaptaan/i.test(k))
      );
      const psikotesScoreEntry = values.find(([k]) =>
        /nilai_psikotes|skor_psikotes|nilai_psikologi|skor_psikologi|psikotes|psikologi|\biq\b/i.test(
          k
        )
      );

      if (nameEntry && nameEntry[1]?.trim()) {
        const rawName = nameEntry[1].trim();
        const normName = normalizeParticipantName(rawName);
        if (normName.length >= 3) {
          const partId = idEntry?.[1]?.trim() || undefined;
          const major =
            detectMajorInText(majorEntry?.[1] || rawRowText) ||
            majorEntry?.[1]?.trim();
          const parsedStatuses = parseStatusesFromRowText(
            rawRowText,
            documentRole
          );
          const extractedScore =
            scoreEntry?.[1]?.trim() ||
            extractSkdScoreFromText(rawRowText).skdScore;
          const extractedPsikologiScore =
            psikotesScoreEntry?.[1]?.trim() ||
            extractPsikologiScoreFromText(rawRowText, documentRole);
          participants.push({
            id: `${doc.id}-row-${rowNum}`,
            documentName: doc.name,
            pageNumber: rowNum,
            locationLabel: `Baris ${rowNum}`,
            rawRowText,
            participantNumber:
              partId && partId !== '-'
                ? partId.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
                : undefined,
            maskedParticipantNumber: maskParticipantNumber(partId),
            rawName,
            normalizedName: normName,
            major,
            skdScore: extractedScore,
            psikologiScore: extractedPsikologiScore,
            ...parsedStatuses,
          });
        }
      }
    });

    return { participants, detectedTableHeaders, documentRole };
  }

  // Carry-over state across pages for multi-page continuation tables
  let activeMajorContext: string | undefined = undefined;
  let activeSectionRole:
    | 'skd'
    | 'psikologi'
    | 'kesamaptaan'
    | 'psikologi_kesamaptaan'
    | 'general' =
    documentRole === 'skd'
      ? 'skd'
      : documentRole === 'psikologi_kesamaptaan'
      ? 'psikologi_kesamaptaan'
      : 'general';

  const seenOnPage = new Set<string>();

  doc.sections.forEach((section, secIdx) => {
    const pageMatch = section.locationLabel.match(/(\d+)/);
    const pageNumber = pageMatch ? Number(pageMatch[1]) : secIdx + 1;
    const lines = section.content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const looksLikeParticipantRow = isLikelyParticipantRow(line);

      if (!looksLikeParticipantRow) {
        const headerMajor = detectMajorInText(line);
        if (headerMajor) {
          activeMajorContext = headerMajor;
          if (!detectedTableHeaders.includes(line)) {
            detectedTableHeaders.push(line);
          }
        }

        if (
          /DAFTAR\s+PESERTA|LAMPIRAN|HASIL\s+TES|HASIL\s+SELEKSI|PENGUMUMAN|JADWAL\s+TES|REKAPITULASI|PSIKOTES|PSIKOLOGI|KESAMAPTAAN/i.test(
            line
          )
        ) {
          if (!detectedTableHeaders.includes(line)) {
            detectedTableHeaders.push(line);
          }
          if (/PSIKOLOGI|PSIKOTES/i.test(line) && /KESAMAPTAAN|SAMAPTA/i.test(line)) {
            activeSectionRole = 'psikologi_kesamaptaan';
          } else if (/PSIKOLOGI|PSIKOTES/i.test(line)) {
            activeSectionRole = 'psikologi';
          } else if (/KESAMAPTAAN|SAMAPTA/i.test(line)) {
            activeSectionRole = 'kesamaptaan';
          } else if (/\bSKD\b|KOMPETENSI\s+DASAR/i.test(line)) {
            activeSectionRole = 'skd';
          }
        }
        continue;
      }

      // Support wrapped continuation lines (up to 2 lines ahead) if major, SKD/Psikotes score, or status wrapped onto the next line
      let combinedLine = line;
      let lookahead = 0;
      while (
        lookahead < 2 &&
        i + 1 < lines.length &&
        !isLikelyParticipantRow(lines[i + 1]) &&
        !/^(DAFTAR|LAMPIRAN|HALAMAN|CATATAN|KETERANGAN|NO\b|NOMOR\b|PROGRAM\s+STUDI\s*:|JURUSAN\s*:)/i.test(
          lines[i + 1]
        ) &&
        (detectMajorInText(lines[i + 1]) ||
          /\b(LULUS|TIDAK\s+LULUS|TERJADWAL|KESAMAPTAAN|MEMENUHI\s+SYARAT|P\/L|R?P\/L|TL|TMS|MS|TWK|TIU|TKP|PSIKOTES|PSIKOLOGI|\d{2,3}(?:[.,]\d{1,2})?)\b/i.test(
            lines[i + 1]
          ))
      ) {
        combinedLine = `${combinedLine} | ${lines[i + 1]}`;
        i++;
        lookahead++;
      }

      const parsedRow = parseSingleParticipantLine(
        combinedLine,
        doc.id,
        doc.name,
        pageNumber,
        activeMajorContext,
        activeSectionRole
      );

      if (parsedRow) {
        // If skdScore or psikologiScore wasn't on the exact line, also check adjacent non-participant line
        if (i + 1 < lines.length && !isLikelyParticipantRow(lines[i + 1])) {
          if (!parsedRow.skdScore) {
            const nextScore = extractSkdScoreFromText(lines[i + 1]);
            if (nextScore.skdScore) {
              parsedRow.skdScore = nextScore.skdCode
                ? `${nextScore.skdScore} (${nextScore.skdCode})`
                : nextScore.skdScore;
            }
          }
          if (!parsedRow.psikologiScore) {
            const nextPsi = extractPsikologiScoreFromText(
              lines[i + 1],
              activeSectionRole
            );
            if (nextPsi) {
              parsedRow.psikologiScore = nextPsi;
            }
          }
        }

        const dedupKey = `${pageNumber}__${parsedRow.normalizedName}__${parsedRow.participantNumber || ''}`;
        if (!seenOnPage.has(dedupKey)) {
          seenOnPage.add(dedupKey);
          participants.push(parsedRow);
        }
      }
    }
  });

  return { participants, detectedTableHeaders, documentRole };
}

/**
 * Extracts SKD score (total score and optional TWK/TIU/TKP breakdown + P/L status code)
 * and Kesamaptaan session from a raw participant row.
 */
export function extractSkdScoreFromText(rawLine: string): {
  skdScore?: string;
  skdCode?: string;
  kesamaptaanSession?: string;
} {
  const sessionMatch = rawLine.match(/\b((?:Sesi|Gelombang|Batch)\s*\d+)\b/i);
  const kesamaptaanSession = sessionMatch ? sessionMatch[1] : undefined;

  const codeMatch = rawLine.match(
    /\b(R?P\/L(?:-E\d)?|PA\/L|P\/L|TL|TMS|MS)\b/i
  );
  const skdCode = codeMatch ? codeMatch[1].toUpperCase() : undefined;

  // 1. Check explicit labeled score: e.g. "Skor SKD: 432" or "Nilai SKD: 432" or "Total: 432"
  const explicitTotalMatch = rawLine.match(
    /\b(?:SKOR\s+SKD|NILAI\s+SKD|TOTAL\s+SKD|TOTAL\s+NILAI|TOTAL\s+SKOR|SKOR|NILAI)\s*[:=-]?\s*(\d{3}(?:[.,]\d{1,2})?)\b/i
  );
  if (explicitTotalMatch) {
    return {
      skdScore: explicitTotalMatch[1],
      skdCode,
      kesamaptaanSession,
    };
  }

  // 2. Check explicit TWK / TIU / TKP labels
  const twkMatch = rawLine.match(/\bTWK\s*[:=-]?\s*(\d{2,3})\b/i);
  const tiuMatch = rawLine.match(/\bTIU\s*[:=-]?\s*(\d{2,3})\b/i);
  const tkpMatch = rawLine.match(/\bTKP\s*[:=-]?\s*(\d{2,3})\b/i);
  if (twkMatch && tiuMatch && tkpMatch) {
    const sum =
      Number(twkMatch[1]) + Number(tiuMatch[1]) + Number(tkpMatch[1]);
    return {
      skdScore: `${sum} (${twkMatch[1]}/${tiuMatch[1]}/${tkpMatch[1]})`,
      skdCode,
      kesamaptaanSession,
    };
  }

  // 3. Strip leading row index, long registration IDs, years, and session numbers
  const cleaned = rawLine
    .replace(/^\s*\d{1,4}\s*(?:\||[.)]\s+|\s+)/, ' ')
    .replace(
      /\b(?:\d{8,20}|S\d{10,18}|POL[-/]?\d{3,12}|SKD[-/]?\d{3,12}|\d{2}-\d{4}-\d{4})\b/gi,
      ' '
    )
    .replace(
      /\b(?:TAHUN|THN|HALAMAN|HAL|SESI|GELOMBANG|BATCH|TINGKAT|KELAS|NO|NOMOR)\s*\d+\b/gi,
      ' '
    )
    .replace(/\b(?:202[0-9]|19[7-9]\d)\b/g, ' ');

  const candidateNums = Array.from(
    cleaned.matchAll(/\b(\d{2,3}(?:[.,]\d{1,2})?)\b/g)
  ).map((m) => ({
    raw: m[1],
    val: parseFloat(m[1].replace(',', '.')),
  }));

  // Check if there is a 4-number BKN CAT SKD sequence: TWK, TIU, TKP, Total (where a + b + c == d)
  if (candidateNums.length >= 4) {
    for (let i = 0; i <= candidateNums.length - 4; i++) {
      const a = candidateNums[i].val;
      const b = candidateNums[i + 1].val;
      const c = candidateNums[i + 2].val;
      const d = candidateNums[i + 3].val;
      if (
        a >= 25 &&
        a <= 200 &&
        b >= 25 &&
        b <= 200 &&
        c >= 100 &&
        c <= 250 &&
        Math.abs(a + b + c - d) <= 1.5
      ) {
        return {
          skdScore: `${candidateNums[i + 3].raw} (${candidateNums[i].raw}/${candidateNums[i + 1].raw}/${candidateNums[i + 2].raw})`,
          skdCode,
          kesamaptaanSession,
        };
      }
    }
  }

  // Otherwise check for a standalone 3-digit SKD total score (150..600)
  const validTotalScores = candidateNums.filter(
    (n) => n.val >= 150 && n.val <= 600
  );
  if (validTotalScores.length > 0) {
    const total = validTotalScores[validTotalScores.length - 1].raw;
    return {
      skdScore: total,
      skdCode,
      kesamaptaanSession,
    };
  }

  return { skdScore: undefined, skdCode, kesamaptaanSession };
}

/**
 * Extracts Psikotes / Psikologi score from a raw participant row.
 * Supports explicit labels (e.g., "Nilai Psikotes: 86,5", "Skor Psikologi: 84", "IQ: 112")
 * as well as numeric columns in Psikotes / Psikologi documents (e.g., "86,5", "84.0", "82").
 */
export function extractPsikologiScoreFromText(
  rawLine: string,
  activeSectionRole = 'general'
): string | undefined {
  if (!rawLine) return undefined;

  // 1. Check explicit Psikotes / Psikologi score labels
  const explicitMatch = rawLine.match(
    /\b(?:NILAI\s+PSIKOTES|SKOR\s+PSIKOTES|NILAI\s+PSIKOLOGI|SKOR\s+PSIKOLOGI|TOTAL\s+PSIKOTES|TOTAL\s+PSIKOLOGI|INDEKS\s+PSIKOLOGI|SKOR\s+TES\s+PSIKOLOGI|NILAI\s+TES\s+PSIKOLOGI|PSIKOTES|PSIKOLOGI|\bIQ\b)\s*[:=-]?\s*(\d{2,3}(?:[.,]\d{1,2})?)\b/i
  );
  if (explicitMatch) {
    return explicitMatch[1];
  }

  const isPsikologiContext =
    activeSectionRole === 'psikologi' ||
    activeSectionRole === 'psikologi_kesamaptaan' ||
    activeSectionRole === 'kesamaptaan' ||
    /\b(?:PSIKOLOGI|PSIKOTES)\b/i.test(rawLine);

  if (!isPsikologiContext) {
    return undefined;
  }

  // 2. In Psikologi/Psikotes context, check generic "Nilai / Skor / Poin: XX" (excluding SKD/TWK/TIU/TKP)
  const genericLabeledMatch = rawLine.match(
    /\b(?:NILAI|SKOR|POIN)\s*[:=-]?\s*(\d{2,3}(?:[.,]\d{1,2})?)\b/i
  );
  if (genericLabeledMatch) {
    const val = parseFloat(genericLabeledMatch[1].replace(',', '.'));
    if (val >= 20 && val <= 200) {
      return genericLabeledMatch[1];
    }
  }

  // 3. Strip leading row index, long registration IDs, years, and session/gelombang/ruang numbers
  const cleaned = rawLine
    .replace(/^\s*\d{1,4}\s*(?:\||[.)]\s+|\s+)/, ' ')
    .replace(
      /\b(?:\d{8,20}|S\d{10,18}|POL[-/]?\d{3,12}|SKD[-/]?\d{3,12}|\d{2}-\d{4}-\d{4})\b/gi,
      ' '
    )
    .replace(
      /\b(?:TAHUN|THN|HALAMAN|HAL|SESI|GELOMBANG|BATCH|TINGKAT|KELAS|RUANG|LOKET|MEJA|NO|NOMOR)\s*\d+\b/gi,
      ' '
    )
    .replace(/\b(?:SKD|TWK|TIU|TKP)\s*[:=-]?\s*\d{2,3}(?:[.,]\d{1,2})?\b/gi, ' ')
    .replace(/\b(?:202[0-9]|19[7-9]\d)\b/g, ' ');

  const candidateNums = Array.from(
    cleaned.matchAll(/\b(\d{2,3}(?:[.,]\d{1,2})?)\b/g)
  ).map((m) => ({
    raw: m[1],
    val: parseFloat(m[1].replace(',', '.')),
  }));

  // Psikotes scores on 0-100 scale (e.g. 58,0 / 78,5 / 86,5) or IQ scale (70-149)
  const validPsikotesScores = candidateNums.filter(
    (n) => n.val >= 25 && n.val < 150
  );
  if (validPsikotesScores.length > 0) {
    return validPsikotesScores[0].raw;
  }

  return undefined;
}

/**
 * Determines whether a line in a PDF page represents a participant data row.
 * Ensures pure score continuation lines (like "110 | 140 | 182 | 432 | P/L") are NOT mistaken for new participant rows.
 */
function isLikelyParticipantRow(line: string): boolean {
  // Reject table column header rows
  if (
    /^(NO\.?|NOMOR|URUT)\s*[|\t\s]+\s*(NO\.?\s*PESERTA|NOMOR\s+PESERTA|NAMA\s+PESERTA|NAMA\s+LENGKAP|PROGRAM\s+STUDI)/i.test(
      line
    )
  ) {
    return false;
  }
  if (
    /^(HALAMAN|PAGE|TOTAL\s+PESERTA|JUMLAH\s+PESERTA|CATATAN|KETERANGAN|DITETAPKAN\s+DI|PANITIA\s+SELEKSI|PENGUMUMAN\s+NOMOR|LAMPIRAN\s+[IVX0-9]|DAFTAR\s+DATA|DAFTAR\s+PESERTA|PROGRAM\s+STUDI\s*:|JURUSAN\s*:)/i.test(
      line
    )
  ) {
    return false;
  }

  // Must contain at least one alphabetic word of length >= 3 that is not just a status/score code
  const withoutCodes = line
    .replace(
      /\b(?:P\/L|R?P\/L|PA\/L|TL|TMS|MS|LULUS|LOLOS|TIDAK|TERJADWAL|KESAMAPTAAN|PSIKOLOGI|PSIKOTES|SESI|GELOMBANG|TWK|TIU|TKP|TOTAL|SKD)\b/gi,
      ' '
    )
    .replace(/[^A-Za-z\s]/g, ' ')
    .trim();
  if (!/[A-Za-z]{3,}/.test(withoutCodes)) {
    return false;
  }

  // Case 1: Pipe-separated row starting with a row number, dash, or participant ID
  if (
    line.includes('|') &&
    /^\s*(?:\d{1,4}|\d{8,20}|[A-Z]{1,4}[-/]?\d{4,16}|-)\s*\|/i.test(line)
  ) {
    return true;
  }

  // Case 2: Line containing an 8-20 digit or formatted registration/participant number
  if (
    /\b(?:\d{8,20}|S\d{10,18}|POL[-/]?\d{3,12}|SKD[-/]?\d{3,12}|\d{2}-\d{4}-\d{4})\b/i.test(
      line
    )
  ) {
    return true;
  }

  // Case 3: Numbered row (e.g. "1 Bagas Pratama Putra" or "12. Siti Nabila Azzahra") where the text is a person's name!
  const numberedNameMatch = line.match(
    /^\s*\d{1,4}[.)\s|-]+\s*([A-Z][A-Za-z'.\s,]{3,55})/
  );
  if (numberedNameMatch) {
    const candidatePart = numberedNameMatch[1].split('|')[0].trim();
    const norm = normalizeParticipantName(candidatePart);
    const words = norm.split(' ').filter(Boolean);
    if (
      words.length >= 1 &&
      words.length <= 6 &&
      norm.length >= 4 &&
      !NON_NAME_STOPWORDS.test(norm)
    ) {
      return true;
    }
  }

  return false;
}

function parseSingleParticipantLine(
  line: string,
  docId: string,
  docName: string,
  pageNumber: number,
  activeMajorContext: string | undefined,
  activeSectionRole: string
): ExtractedParticipantRecord | null {
  const idMatch = line.match(
    /\b(\d{8,20}|S\d{10,18}|POL[-/]?\d{3,12}|SKD[-/]?\d{3,12}|\d{2}-\d{4}-\d{4})\b/i
  );
  const rawParticipantNumber = idMatch
    ? idMatch[1].replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    : undefined;

  const rowMajor = detectMajorInText(line) || activeMajorContext;
  const scoreInfo = extractSkdScoreFromText(line);
  const formattedSkdScore =
    activeSectionRole === 'psikologi' ||
    activeSectionRole === 'psikologi_kesamaptaan'
      ? /\b(?:SKD|TWK|TIU|TKP)\b/i.test(line)
        ? scoreInfo.skdScore
        : undefined
      : scoreInfo.skdScore
      ? scoreInfo.skdCode
        ? `${scoreInfo.skdScore} (${scoreInfo.skdCode})`
        : scoreInfo.skdScore
      : undefined;

  const extractedPsikologiScore = extractPsikologiScoreFromText(
    line,
    activeSectionRole
  );

  let rawName = '';
  if (line.includes('|')) {
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);

    for (const cell of cells) {
      if (/^(?:\d{1,4}[.)]?|-)$/.test(cell)) continue;
      if (
        rawParticipantNumber &&
        cell.replace(/[^A-Za-z0-9]/g, '').toUpperCase() ===
          rawParticipantNumber
      ) {
        continue;
      }
      if (detectMajorInText(cell)) continue;
      if (/^(?:\d{2,3}(?:[.,]\d+)?|TWK.*|TIU.*|TKP.*|NILAI.*|SKOR.*)$/i.test(cell)) continue;
      if (
        /^(?:R?P\/L.*|P|TL|PA|MS|TMS|LULUS.*|TIDAK\s+LULUS.*|LOLOS.*|TIDAK\s+LOLOS.*|MEMENUHI\s+SYARAT.*|TIDAK\s+MEMENUHI.*|TERJADWAL.*|MENGIKUTI.*|BELUM.*|HADIR|TIDAK\s+HADIR|SESI\s+\d+.*|GELOMBANG\s+\d+.*|LAKI-?LAKI|PEREMPUAN|PRIA|WANITA)$/i.test(
          cell
        )
      ) {
        continue;
      }
      const cleanedCandidate = cell
        .replace(/^(?:NAMA(?:\s+PESERTA)?\s*[:=-]\s*)/i, '')
        .trim();
      if (
        /[A-Za-z]{2,}/.test(cleanedCandidate) &&
        cleanedCandidate.length >= 3 &&
        cleanedCandidate.length <= 65 &&
        !NON_NAME_STOPWORDS.test(cleanedCandidate)
      ) {
        rawName = cleanedCandidate;
        break;
      }
    }
  }

  if (!rawName) {
    let working = line;
    working = working.replace(/^\s*\d{1,4}[.)]?\s+/, '');
    if (idMatch) {
      working = working.replace(idMatch[0], ' | ');
    }
    for (const m of KNOWN_MAJORS) {
      working = working.replace(m.pattern, ' | ');
    }
    working = working.replace(
      /\b(?:R?P\/L|TIDAK\s+MEMENUHI\s+SYARAT|MEMENUHI\s+SYARAT|TIDAK\s+LULUS|LULUS\s+PSIKOLOGI|LULUS\s+PSIKOTES|LULUS\s+SKD|LULUS|TIDAK\s+LOLOS|LOLOS|TERJADWAL\s+KESAMAPTAAN|TERJADWAL|MENGIKUTI\s+TES\s+KESAMAPTAAN|TMS|MS|TL|SESI\s+\d+|GELOMBANG\s+\d+|\d{2,3}(?:[.,]\d{1,2})?)\b.*$/i,
      ''
    );

    const segments = working
      .split('|')
      .map((s) => s.replace(/^[-:\s]+|[-:\s]+$/g, '').trim())
      .filter(
        (s) =>
          s.length >= 3 &&
          /[A-Za-z]{2,}/.test(s) &&
          !NON_NAME_STOPWORDS.test(s)
      );

    if (segments.length > 0) {
      rawName = segments[0];
    }
  }

  const normalizedName = normalizeParticipantName(rawName);
  if (
    !normalizedName ||
    normalizedName.length < 3 ||
    NON_NAME_STOPWORDS.test(normalizedName)
  ) {
    return null;
  }

  const statuses = parseStatusesFromRowText(line, activeSectionRole);

  return {
    id: `${docId}-p${pageNumber}-${normalizedName.replace(/\s+/g, '_')}-${
      rawParticipantNumber || 'noid'
    }`,
    documentName: docName,
    pageNumber,
    locationLabel: `Halaman ${pageNumber}`,
    rawRowText: line,
    participantNumber: rawParticipantNumber,
    maskedParticipantNumber: maskParticipantNumber(rawParticipantNumber),
    rawName: rawName.trim(),
    normalizedName,
    major: rowMajor,
    skdScore: formattedSkdScore,
    psikologiScore: extractedPsikologiScore,
    notes: scoreInfo.kesamaptaanSession,
    ...statuses,
  };
}

/**
 * Parses SKD, Psikologi/Psikotes, and Kesamaptaan statuses from a row.
 */
function parseStatusesFromRowText(
  rowText: string,
  activeSectionRole: string
): {
  skdStatus: ExtractedParticipantRecord['skdStatus'];
  psikologiStatus: ExtractedParticipantRecord['psikologiStatus'];
  kesamaptaanStatus: ExtractedParticipantRecord['kesamaptaanStatus'];
} {
  let skdStatus: ExtractedParticipantRecord['skdStatus'] = 'Tidak Tercantum';
  let psikologiStatus: ExtractedParticipantRecord['psikologiStatus'] =
    'Tidak Tercantum';
  let kesamaptaanStatus: ExtractedParticipantRecord['kesamaptaanStatus'] =
    'Tidak Tercantum';

  const text = rowText.toUpperCase();

  // 1. Check SKD status
  if (
    activeSectionRole === 'skd' ||
    /\bSKD\b/.test(text) ||
    activeSectionRole === 'general'
  ) {
    if (
      /\b(?:TIDAK\s+LULUS|TL|TMS|TIDAK\s+MEMENUHI\s+SYARAT|GUGUR)\b/.test(text)
    ) {
      skdStatus = 'Tidak Lulus';
    } else if (
      /\b(?:R?P\/L|LULUS|LOLOS|MS|MEMENUHI\s+SYARAT)\b/.test(text)
    ) {
      skdStatus = 'Lulus / Memenuhi Syarat';
    } else {
      skdStatus = 'Tercatat Peserta SKD';
    }
  }

  // 2. Check Psikologi / Psikotes status
  const hasExplicitPsikologiFail =
    /PSIKOLOGI\s*[:=-]?\s*(?:TIDAK\s+LULUS|TMS|TIDAK\s+MEMENUHI\s+SYARAT|GUGUR|TL|TIDAK\s+DIREKOMENDASIKAN)/i.test(
      rowText
    ) ||
    /\b(?:TIDAK\s+LULUS\s+PSIKOLOGI|TIDAK\s+LULUS\s+PSIKOTES|TMS\s+PSIKOLOGI)\b/i.test(
      rowText
    ) ||
    ((activeSectionRole === 'psikologi' ||
      activeSectionRole === 'psikologi_kesamaptaan') &&
      /\b(?:TIDAK\s+LULUS|TMS|TIDAK\s+MEMENUHI\s+SYARAT|TIDAK\s+LOLOS|GUGUR)\b/i.test(
        rowText
      ) &&
      !/LULUS\s+PSIKOLOGI|LOLOS\s+PSIKOLOGI/i.test(rowText));

  const hasExplicitPsikologiUncertain =
    /PSIKOLOGI\s*[:=-]?\s*(?:BELUM|TUNDA|VERIFIKASI|\?)/i.test(rowText);

  if (hasExplicitPsikologiFail) {
    psikologiStatus = 'Tidak Lulus';
  } else if (hasExplicitPsikologiUncertain) {
    psikologiStatus = 'Belum Dapat Dipastikan';
  } else if (
    activeSectionRole === 'psikologi' ||
    activeSectionRole === 'psikologi_kesamaptaan' ||
    activeSectionRole === 'kesamaptaan' ||
    /\b(?:LULUS\s+PSIKOLOGI|LOLOS\s+PSIKOLOGI|LULUS\s+PSIKOTES|LOLOS\s+PSIKOTES|PSIKOLOGI\s*[:=-]?\s*(?:LULUS|LOLOS|MS))\b/i.test(
      rowText
    )
  ) {
    psikologiStatus = 'Lulus';
  }

  // 3. Check Kesamaptaan status
  const hasExplicitKesamaptaanFail =
    /KESAMAPTAAN\s*[:=-]?\s*(?:TIDAK\s+BERHAK|TIDAK\s+MENGIKUTI|TIDAK\s+TERJADWAL|GUGUR|TMS|TL)/i.test(
      rowText
    ) ||
    /\b(?:TIDAK\s+MENGIKUTI\s+(?:TES\s+)?KESAMAPTAAN|TIDAK\s+BERHAK\s+KESAMAPTAAN|GUGUR\s+SEBELUM\s+KESAMAPTAAN)\b/i.test(
      rowText
    ) ||
    hasExplicitPsikologiFail;

  const hasExplicitKesamaptaanUncertain =
    /KESAMAPTAAN\s*[:=-]?\s*(?:BELUM|TUNDA|MENUNGGU)/i.test(rowText) ||
    /\b(?:BELUM\s+DAPAT\s+DIPASTIKAN|MENUNGGU\s+VERIFIKASI\s+MEDIS|JADWAL\s+KESAMAPTAAN\s+BELUM\s+TERSEDIA)\b/i.test(
      rowText
    );

  if (hasExplicitKesamaptaanFail) {
    kesamaptaanStatus = 'Tidak Mengikuti / Gugur';
  } else if (hasExplicitKesamaptaanUncertain) {
    kesamaptaanStatus = 'Belum Dapat Dipastikan';
  } else if (
    /KESAMAPTAAN|SAMAPTA|SESI\s+\d+|GELOMBANG\s+\d+/i.test(rowText) ||
    activeSectionRole === 'kesamaptaan' ||
    activeSectionRole === 'psikologi_kesamaptaan' ||
    psikologiStatus === 'Lulus'
  ) {
    kesamaptaanStatus = 'Terjadwal Mengikuti';
  }

  return { skdStatus, psikologiStatus, kesamaptaanStatus };
}

/**
 * Fallback Cross-Document Name Scanner:
 * Scans all lines in Document A and Document B for 2-to-4 word person names
 * that appear in BOTH documents (exact or near-match) and also extracts any SKD score on or near that line.
 */
function scanCrossDocumentSharedNames(
  docA: UploadedDocumentPayload,
  docB: UploadedDocumentPayload,
  existingA: ExtractedParticipantRecord[],
  existingB: ExtractedParticipantRecord[]
): {
  extraA: ExtractedParticipantRecord[];
  extraB: ExtractedParticipantRecord[];
} {
  const extraA: ExtractedParticipantRecord[] = [];
  const extraB: ExtractedParticipantRecord[] = [];

  const extractCandidateLines = (doc: UploadedDocumentPayload) => {
    const candidates: Array<{
      rawName: string;
      normName: string;
      pageNumber: number;
      line: string;
      contextWindow: string;
      major?: string;
    }> = [];
    let currentMajor: string | undefined = undefined;

    doc.sections.forEach((sec, idx) => {
      const pageNum = sec.pageNumber || idx + 1;
      const lines = sec.content.split('\n');
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx].trim();
        if (!line) continue;
        const maj = detectMajorInText(line);
        if (maj) currentMajor = maj;

        const nextLine = lines[lineIdx + 1]?.trim() || '';
        const contextWindow = nextLine ? `${line} | ${nextLine}` : line;

        const parts = (
          line.includes('|')
            ? line.split(/\s*\|\s*/)
            : line.split(/\t+|\s{2,}/)
        )
          .map((p) => p.replace(/^\d{1,4}[.)]\s*/, '').trim())
          .filter(Boolean);

        for (const part of parts) {
          if (part.length < 4 || part.length > 50) continue;
          if (/\d/.test(part)) continue;
          if (NON_NAME_STOPWORDS.test(part)) continue;
          const norm = normalizeParticipantName(part);
          const words = norm.split(' ').filter((w) => w.length >= 2);
          if (
            words.length >= 2 &&
            words.length <= 5 &&
            !NON_NAME_STOPWORDS.test(norm)
          ) {
            candidates.push({
              rawName: part,
              normName: norm,
              pageNumber: pageNum,
              line,
              contextWindow,
              major: currentMajor,
            });
          }
        }
      }
    });
    return candidates;
  };

  const candA = extractCandidateLines(docA);
  const candB = extractCandidateLines(docB);

  const hasNameOrSimilar = (
    list: ExtractedParticipantRecord[],
    norm: string
  ) =>
    list.some(
      (r) =>
        r.normalizedName === norm ||
        areNamesAmbiguouslySimilar(r.normalizedName, norm).similar
    );

  for (const a of candA) {
    const matchInB = candB.find(
      (b) =>
        b.normName === a.normName ||
        areNamesAmbiguouslySimilar(a.normName, b.normName).similar
    );
    if (matchInB) {
      const scoreFromA = extractSkdScoreFromText(a.contextWindow);
      const formattedScoreA = scoreFromA.skdScore
        ? scoreFromA.skdCode
          ? `${scoreFromA.skdScore} (${scoreFromA.skdCode})`
          : scoreFromA.skdScore
        : undefined;
      const psiScoreFromB = extractPsikologiScoreFromText(
        matchInB.contextWindow,
        'psikologi_kesamaptaan'
      );

      // If existing record in A was missing skdScore, enrich it
      const existingRecA = existingA.find((r) => r.normalizedName === a.normName);
      if (existingRecA && !existingRecA.skdScore && formattedScoreA) {
        existingRecA.skdScore = formattedScoreA;
      }

      // If existing record in B was missing psikologiScore, enrich it
      const existingRecB = existingB.find(
        (r) => r.normalizedName === matchInB.normName
      );
      if (existingRecB && !existingRecB.psikologiScore && psiScoreFromB) {
        existingRecB.psikologiScore = psiScoreFromB;
      }

      if (!hasNameOrSimilar(existingA, a.normName) && !hasNameOrSimilar(extraA, a.normName)) {
        extraA.push({
          id: `${docA.id}-scan-p${a.pageNumber}-${a.normName.replace(/\s+/g, '_')}`,
          documentName: docA.name,
          pageNumber: a.pageNumber,
          locationLabel: `Halaman ${a.pageNumber}`,
          rawRowText: a.line,
          rawName: a.rawName,
          normalizedName: a.normName,
          major: a.major,
          skdScore: formattedScoreA,
          skdStatus: /TIDAK\s+LULUS|\bTL\b|\bTMS\b/i.test(a.line)
            ? 'Tidak Lulus'
            : 'Lulus / Memenuhi Syarat',
          psikologiStatus: 'Tidak Tercantum',
          kesamaptaanStatus: 'Tidak Tercantum',
        });
      }
      if (!hasNameOrSimilar(existingB, matchInB.normName) && !hasNameOrSimilar(extraB, matchInB.normName)) {
        const isFail = /TIDAK\s+LULUS|\bTMS\b|GUGUR/i.test(matchInB.line);
        const isUncertain = /BELUM\s+DAPAT\s+DIPASTIKAN|MENUNGGU/i.test(
          matchInB.line
        );
        const scoreFromB = extractSkdScoreFromText(matchInB.contextWindow);
        extraB.push({
          id: `${docB.id}-scan-p${matchInB.pageNumber}-${matchInB.normName.replace(/\s+/g, '_')}`,
          documentName: docB.name,
          pageNumber: matchInB.pageNumber,
          locationLabel: `Halaman ${matchInB.pageNumber}`,
          rawRowText: matchInB.line,
          rawName: matchInB.rawName,
          normalizedName: matchInB.normName,
          major: matchInB.major,
          skdScore: scoreFromB.skdScore,
          psikologiScore: psiScoreFromB,
          notes: scoreFromB.kesamaptaanSession,
          skdStatus: 'Tidak Tercantum',
          psikologiStatus: isFail ? 'Tidak Lulus' : 'Lulus',
          kesamaptaanStatus: isFail
            ? 'Tidak Mengikuti / Gugur'
            : isUncertain
            ? 'Belum Dapat Dipastikan'
            : 'Terjadwal Mengikuti',
        });
      }
    }
  }

  return { extraA, extraB };
}

/**
 * Context-Focused, Minimalist Cross-Document Participant Matcher.
 * Includes Nilai SKD and presents concise, high-signal table fields without wordy sentences.
 */
export function matchParticipantsAcrossDocuments(
  documents: UploadedDocumentPayload[],
  customQuestion = ''
): CrossDocumentMatchReport {
  const explicitMajorInQuestion = detectMajorInText(customQuestion);
  const userAskedForSpecificMajor = Boolean(explicitMajorInQuestion);
  const targetMajorFilter =
    explicitMajorInQuestion || 'Semua Jurusan';

  if (documents.length < 2) {
    const singleDoc = documents[0];
    const singleExtraction = singleDoc
      ? extractParticipantsFromDocument(singleDoc)
      : { participants: [], detectedTableHeaders: [], documentRole: 'unknown' };

    return {
      isApplicable: singleExtraction.participants.length > 0,
      targetMajorFilter,
      documentAName: singleDoc?.name || 'Dokumen A',
      documentBName: 'Dokumen B (Belum Diunggah)',
      totalExtractedDocA: singleExtraction.participants.length,
      totalExtractedDocB: 0,
      totalTargetMajorInDocA: singleExtraction.participants.length,
      qualifiedMatchedRows: [],
      allEvaluatedRows: [],
      matchedCount: 0,
      matchingMethodSummary:
        'Unggah minimal 2 dokumen (Dokumen A SKD dan Dokumen B Psikotes/Kesamaptaan).',
      singleDocumentOnly: singleExtraction.participants.map((p) => ({
        participantName: p.rawName,
        maskedId: p.maskedParticipantNumber,
        major: p.major,
        skdScore: p.skdScore,
        statusInDocument: p.skdScore
          ? `SKD: ${p.skdScore}`
          : `SKD: ${p.skdStatus}`,
        documentName: p.documentName,
        location: p.locationLabel,
        reasonNotMatched: 'Dokumen kedua belum diunggah.',
      })),
      uncertainStatusParticipants: [],
      duplicatesOrMismatches: [],
      analysisLimitations: [
        'Baru 1 dokumen yang diunggah.',
      ],
      zeroMatchExplanation:
        'Baru 1 dokumen yang diunggah. Unggah dokumen kedua untuk mencocokkan nama peserta.',
    };
  }

  const perDocExtractions = documents.map((doc) => ({
    doc,
    ...extractParticipantsFromDocument(doc),
  }));

  let docAEntry =
    perDocExtractions.find((e) => e.documentRole === 'skd') ||
    perDocExtractions.find((e) =>
      e.participants.some((p) => p.major !== undefined || p.skdScore !== undefined)
    ) ||
    perDocExtractions[0];

  let docBEntry =
    perDocExtractions.find(
      (e) =>
        e.doc.id !== docAEntry.doc.id &&
        (e.documentRole === 'psikologi_kesamaptaan' ||
          e.documentRole === 'mixed')
    ) ||
    perDocExtractions.find((e) => e.doc.id !== docAEntry.doc.id) ||
    perDocExtractions[1];

  const docARecords = [...docAEntry.participants];
  const docBRecords: ExtractedParticipantRecord[] = [];
  perDocExtractions.forEach((entry) => {
    if (entry.doc.id !== docAEntry.doc.id) {
      docBRecords.push(...entry.participants);
    }
  });

  const allDocsAndQuestionText = [
    customQuestion,
    ...documents.map((d) => `${d.name}\n${d.textContent.slice(0, 4000)}`),
  ].join('\n');
  const hasParticipantContext =
    /poltekpin|psikologi|psikotes|kesamaptaan|\bskd\b|perancangan\s+peraturan|peserta|seleksi|kelulusan|lulus|lolos|lanjut|tahap|taruna|mahasiswa|jurusan|program\s+studi/i.test(
      allDocsAndQuestionText
    );

  if (hasParticipantContext) {
    const scannedExtras = scanCrossDocumentSharedNames(
      docAEntry.doc,
      docBEntry.doc,
      docARecords,
      docBRecords
    );
    docARecords.push(...scannedExtras.extraA);
    docBRecords.push(...scannedExtras.extraB);
  }

  const duplicatesOrMismatches: DuplicateOrMismatchItem[] = [];
  const uncertainStatusParticipants: UncertainParticipantItem[] = [];
  const singleDocumentOnly: SingleDocumentOnlyItem[] = [];
  const analysisLimitations: string[] = [];

  const docAHasAnyMajors = docARecords.some((r) => Boolean(r.major));

  const docATargetMajorRecords = docARecords.filter((rec) => {
    if (!userAskedForSpecificMajor || !docAHasAnyMajors) return true;
    if (!rec.major) return true;
    return isMajorMatch(rec.major, explicitMajorInQuestion!);
  });

  const matchedDocBIds = new Set<string>();
  const qualifiedMatchedRows: MatchedParticipantRow[] = [];
  const nearMatchRows: MatchedParticipantRow[] = [];
  const allEvaluatedRows: MatchedParticipantRow[] = [];

  docARecords.forEach((recA) => {
    const isTargetMajor =
      !userAskedForSpecificMajor ||
      !docAHasAnyMajors ||
      !recA.major ||
      isMajorMatch(recA.major, explicitMajorInQuestion!);

    let matchedB: ExtractedParticipantRecord | undefined = undefined;
    let matchMethod: 'Nomor Peserta & Nama' | 'Nama Terstandarisasi' =
      'Nama Terstandarisasi';
    let isFuzzyNameMatch = false;

    // 1. Exact Participant Number Match
    if (recA.participantNumber) {
      const idMatches = docBRecords.filter(
        (b) =>
          b.participantNumber &&
          b.participantNumber === recA.participantNumber
      );
      if (idMatches.length >= 1) {
        matchedB = idMatches[0];
        matchMethod = 'Nomor Peserta & Nama';
      }
    }

    // 2. Exact Normalized Name Match
    if (!matchedB) {
      const nameMatches = docBRecords.filter(
        (b) => b.normalizedName === recA.normalizedName
      );
      if (nameMatches.length >= 1) {
        matchedB = nameMatches[0];
        matchMethod =
          recA.participantNumber && matchedB.participantNumber
            ? 'Nomor Peserta & Nama'
            : 'Nama Terstandarisasi';
      }
    }

    // 3. Near / Fuzzy Name Match ("Menyerempet")
    if (!matchedB) {
      let bestSimScore = 0;
      let bestCandidate: ExtractedParticipantRecord | undefined = undefined;
      let bestReason = '';

      for (const b of docBRecords) {
        if (matchedDocBIds.has(b.id)) continue;
        const sim = areNamesAmbiguouslySimilar(
          recA.normalizedName,
          b.normalizedName
        );
        if (sim.similar && sim.score > bestSimScore) {
          bestSimScore = sim.score;
          bestCandidate = b;
          bestReason = sim.reason;
        }
      }

      if (bestCandidate) {
        matchedB = bestCandidate;
        matchMethod = 'Nama Terstandarisasi';
        isFuzzyNameMatch = true;

        duplicatesOrMismatches.push({
          participantNameOrPair: `${recA.rawName} ≈ ${bestCandidate.rawName}`,
          issueType: 'Kemiripan Nama Ambigu (Bukan Orang yang Sama)',
          details: `Ejaan mirip (${bestReason})${recA.skdScore ? ` · SKD: ${recA.skdScore}` : ''}${bestCandidate.psikologiScore ? ` · Psikotes: ${bestCandidate.psikologiScore}` : ''}`,
          sources: `Dok. A (${recA.locationLabel}) · Dok. B (${bestCandidate.locationLabel})`,
        });
      }
    }

    if (!matchedB) {
      if (isTargetMajor) {
        singleDocumentOnly.push({
          participantName: recA.rawName,
          maskedId: recA.maskedParticipantNumber,
          major: recA.major || '-',
          skdScore: recA.skdScore,
          psikologiScore: recA.psikologiScore,
          statusInDocument: recA.skdScore
            ? `SKD: ${recA.skdScore}`
            : `SKD: ${recA.skdStatus}`,
          documentName: recA.documentName,
          location: recA.locationLabel,
          reasonNotMatched: 'Hanya di Dok. A (Tidak ada di Dok. B)',
        });
      }
      return;
    }

    matchedDocBIds.add(matchedB.id);

    const resolvedSkdScore =
      recA.skdScore ||
      matchedB.skdScore ||
      extractSkdScoreFromText(recA.rawRowText).skdScore ||
      extractSkdScoreFromText(matchedB.rawRowText).skdScore ||
      'Lulus SKD';

    const resolvedPsikologiScore =
      matchedB.psikologiScore ||
      recA.psikologiScore ||
      extractPsikologiScoreFromText(
        matchedB.rawRowText,
        'psikologi_kesamaptaan'
      ) ||
      extractPsikologiScoreFromText(recA.rawRowText, 'general') ||
      '-';

    if (
      matchedB.psikologiStatus === 'Belum Dapat Dipastikan' ||
      matchedB.kesamaptaanStatus === 'Belum Dapat Dipastikan'
    ) {
      uncertainStatusParticipants.push({
        participantName: recA.rawName,
        maskedId:
          recA.maskedParticipantNumber || matchedB.maskedParticipantNumber,
        skdScore: resolvedSkdScore,
        psikologiScore:
          resolvedPsikologiScore !== '-' ? resolvedPsikologiScore : undefined,
        issueDescription: `SKD: ${resolvedSkdScore} · Psikotes: ${resolvedPsikologiScore !== '-' ? `${resolvedPsikologiScore} (Lulus)` : 'Lulus'} · Kesamaptaan: Menunggu Verifikasi`,
        documentName: matchedB.documentName,
        location: matchedB.locationLabel,
      });
    }

    const passedSkd = recA.skdStatus !== 'Tidak Lulus';
    const passedPsikologi = matchedB.psikologiStatus === 'Lulus';
    const scheduledKesamaptaan =
      matchedB.kesamaptaanStatus === 'Terjadwal Mengikuti';

    const meetsAllTargetCriteria =
      isTargetMajor &&
      !isFuzzyNameMatch &&
      passedSkd &&
      passedPsikologi &&
      scheduledKesamaptaan;

    const isNearMatch =
      !meetsAllTargetCriteria &&
      passedSkd &&
      passedPsikologi &&
      (isFuzzyNameMatch ||
        matchedB.kesamaptaanStatus === 'Belum Dapat Dipastikan' ||
        !isTargetMajor);

    const displayName =
      isFuzzyNameMatch &&
      normalizeParticipantName(recA.rawName) !==
        normalizeParticipantName(matchedB.rawName)
        ? `${recA.rawName} (≈ ${matchedB.rawName})`
        : recA.rawName;

    // Minimalist, clean labels without wordy sentences
    const majorCompatibilityLabel =
      recA.major || explicitMajorInQuestion || 'Sesuai Dok. A';

    const psikologiLabel =
      matchedB.psikologiStatus === 'Lulus'
        ? 'Lulus'
        : matchedB.psikologiStatus === 'Tidak Lulus'
        ? 'Tidak Lulus'
        : 'Verifikasi';

    const sessionSuffix = matchedB.notes ? ` (${matchedB.notes})` : '';
    const kesamaptaanLabel =
      matchedB.kesamaptaanStatus === 'Terjadwal Mengikuti'
        ? `Terjadwal${sessionSuffix}`
        : matchedB.kesamaptaanStatus === 'Tidak Mengikuti / Gugur'
        ? 'Gugur'
        : 'Menunggu Verifikasi';

    const matchBadge: MatchedParticipantRow['matchBadge'] =
      meetsAllTargetCriteria
        ? 'Cocok'
        : isFuzzyNameMatch
        ? 'Nama Mirip'
        : !isTargetMajor
        ? 'Prodi Lain'
        : 'Verifikasi';

    const shortPageA = recA.locationLabel.replace(/^Halaman\s+/i, 'Hal. ');
    const shortPageB = matchedB.locationLabel.replace(/^Halaman\s+/i, 'Hal. ');
    const sourceShort = `Dok. A (${shortPageA}) · Dok. B (${shortPageB})`;
    const sourceTraceability = `${recA.documentName} (${shortPageA}) & ${matchedB.documentName} (${shortPageB})`;

    const evaluatedRow: MatchedParticipantRow = {
      rowNumber: allEvaluatedRows.length + 1,
      participantName: displayName,
      maskedId:
        recA.maskedParticipantNumber || matchedB.maskedParticipantNumber,
      matchedBy: matchMethod,
      skdScore: resolvedSkdScore,
      psikologiScore: resolvedPsikologiScore,
      majorCompatibility: majorCompatibilityLabel,
      psikologiStatus: psikologiLabel,
      kesamaptaanStatus: kesamaptaanLabel,
      sourceTraceability,
      sourceShort,
      matchBadge,
      meetsAllTargetCriteria,
    };

    if (meetsAllTargetCriteria || isNearMatch) {
      allEvaluatedRows.push(evaluatedRow);
    } else if (!passedPsikologi && isTargetMajor) {
      // Participant was in Doc A and Doc B but explicitly failed Psikotes — record concisely in singleDocumentOnly/eliminated list
      singleDocumentOnly.push({
        participantName: recA.rawName,
        maskedId: recA.maskedParticipantNumber,
        major: recA.major,
        skdScore: resolvedSkdScore,
        psikologiScore:
          resolvedPsikologiScore !== '-' ? resolvedPsikologiScore : undefined,
        statusInDocument: `SKD: ${resolvedSkdScore} · Psikotes: ${resolvedPsikologiScore !== '-' ? `${resolvedPsikologiScore} (Tidak Lulus)` : 'Tidak Lulus'}`,
        documentName: matchedB.documentName,
        location: matchedB.locationLabel,
        reasonNotMatched: 'Tidak Lulus Psikotes',
      });
    }

    if (meetsAllTargetCriteria) {
      qualifiedMatchedRows.push({
        ...evaluatedRow,
        rowNumber: qualifiedMatchedRows.length + 1,
      });
    } else if (isNearMatch && isTargetMajor) {
      nearMatchRows.push(evaluatedRow);
    }
  });

  docBRecords.forEach((recB) => {
    if (!matchedDocBIds.has(recB.id)) {
      singleDocumentOnly.push({
        participantName: recB.rawName,
        maskedId: recB.maskedParticipantNumber,
        major: recB.major,
        skdScore: recB.skdScore,
        psikologiScore: recB.psikologiScore,
        statusInDocument: recB.psikologiScore
          ? `Psikotes: ${recB.psikologiScore} (${recB.psikologiStatus})`
          : `Psikotes: ${recB.psikologiStatus}`,
        documentName: recB.documentName,
        location: recB.locationLabel,
        reasonNotMatched: 'Hanya di Dok. B (Tidak ada di Dok. A)',
      });
    }
  });

  const finalPrimaryRows =
    qualifiedMatchedRows.length > 0
      ? qualifiedMatchedRows
      : nearMatchRows.map((r, i) => ({
          ...r,
          rowNumber: i + 1,
          meetsAllTargetCriteria: true,
        }));

  let zeroMatchExplanation: string | undefined = undefined;
  if (finalPrimaryRows.length === 0) {
    zeroMatchExplanation =
      'Belum ditemukan nama peserta yang cocok pada kedua dokumen.';
  }

  return {
    isApplicable:
      hasParticipantContext &&
      (docARecords.length > 0 || docBRecords.length > 0),
    targetMajorFilter,
    documentAName: docAEntry.doc.name,
    documentBName: docBEntry.doc.name,
    totalExtractedDocA: docARecords.length,
    totalExtractedDocB: docBRecords.length,
    totalTargetMajorInDocA: docATargetMajorRecords.length,
    qualifiedMatchedRows: finalPrimaryRows,
    allEvaluatedRows,
    matchedCount: finalPrimaryRows.length,
    matchingMethodSummary:
      'Pencocokan nama peserta lintas dokumen (Dok. A SKD → Dok. B Psikotes/Kesamaptaan) beserta Nilai SKD dan Nilai Psikotes.',
    singleDocumentOnly,
    uncertainStatusParticipants,
    duplicatesOrMismatches,
    analysisLimitations:
      analysisLimitations.length > 0
        ? analysisLimitations
        : [
            'Nomor peserta disamarkan (***XXXX). Kandidat nama mirip atau beda prodi diberi label penanda.',
          ],
    zeroMatchExplanation,
  };
}

function isMajorMatch(
  recordMajor: string | undefined,
  targetMajor: string
): boolean {
  if (!recordMajor) return false;
  const normRec = recordMajor
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const normTarget = targetMajor
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (normRec === normTarget) return true;
  if (
    normTarget.includes('PERANCANGAN PERATURAN') &&
    normRec.includes('PERANCANGAN PERATURAN')
  ) {
    return true;
  }
  return normRec.includes(normTarget) || normTarget.includes(normRec);
}

/**
 * Normalizes any generic entity identifier (clause title, product name, budget line, research topic)
 * for cross-document matching while preserving alphanumeric tokens.
 */
export function normalizeEntityKey(raw: string): string {
  if (!raw) return '';
  return raw
    .toUpperCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses numeric values and their units from a cell or text snippet without turning missing values into 0.
 */
export function parseNumericAndUnit(rawText: string): {
  value: number;
  unit: string;
  raw: string;
} | null {
  if (!rawText) return null;
  const trimmed = rawText.trim();
  if (
    !trimmed ||
    /^(?:belum_tersedia|belum\s+tersedia|n\/a|null|tbd|-|\?)$/i.test(trimmed)
  ) {
    return null;
  }

  // Avoid matching pure codes like INV-101, JKT-01, Pasal 1, Q1 2026
  if (/^(?:INV|JKT|SBY|BDG|MDN|SKU|PASAL|BAB|BAGIAN|Q[1-4])[-_\s]?\d+/i.test(trimmed)) {
    return null;
  }

  // Match currency or numeric with optional unit
  const numMatch = trimmed.match(
    /(?:(Rp|IDR|USD|\$)\s*)?(-?\d{1,3}(?:[.,]\d{3})+|-?\d+(?:[.,]\d+)?)\s*(Juta\s*Rp|Miliar\s*Rp|Juta|Miliar|%|Ton|Unit|Pcs|Kg|kWh|Hari|Bulan|Tahun|bps)?/i
  );
  if (!numMatch) return null;

  const prefixUnit = numMatch[1] || '';
  const numStr = numMatch[2];
  const suffixUnit = numMatch[3] || '';

  // Normalize Indonesian thousands vs decimal separator
  let normalizedNumStr = numStr;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(numStr)) {
    normalizedNumStr = numStr.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(numStr)) {
    normalizedNumStr = numStr.replace(/,/g, '');
  } else if (numStr.includes(',') && !numStr.includes('.')) {
    normalizedNumStr = numStr.replace(',', '.');
  }

  const val = parseFloat(normalizedNumStr);
  if (Number.isNaN(val)) return null;

  const unit = [prefixUnit, suffixUnit]
    .filter(Boolean)
    .join(' ')
    .trim();

  return {
    value: val,
    unit: unit || 'angka',
    raw: trimmed,
  };
}

/**
 * Extracts generic structured entities (table rows, clauses, research parameters, budget items, inventory SKUs)
 * from any PDF or CSV document without assuming a specific domain.
 */
export function extractGenericEntitiesFromDocument(
  doc: UploadedDocumentPayload
): {
  entities: ExtractedEntityRecord[];
  headers: string[];
  entityTypeLabel: string;
} {
  const entities: ExtractedEntityRecord[] = [];
  const headers: string[] = [];
  let entityTypeLabel = 'Entitas / Indikator';

  const fullLower = `${doc.name}\n${doc.textContent}`.toLowerCase();
  if (/klausul|pasal|perjanjian|kontrak|hukum/i.test(fullLower)) {
    entityTypeLabel = 'Klausul / Ketentuan';
  } else if (/sku|stok|inventaris|gudang|nama_barang|opname/i.test(fullLower)) {
    entityTypeLabel = 'Item Inventaris / Barang';
  } else if (/anggaran|pendapatan|beban|keuangan|cabang|kuartal/i.test(fullLower)) {
    entityTypeLabel = 'Pos Keuangan / Cabang';
  } else if (/penelitian|riset|parameter_studi|metodologi|efisiensi/i.test(fullLower)) {
    entityTypeLabel = 'Parameter / Temuan Studi';
  }

  if (doc.format === 'csv' && doc.csvRows && doc.csvHeaders) {
    headers.push(...doc.csvHeaders);
    const codeCol = doc.csvHeaders.find((h) =>
      /^(?:kode|sku|id|no|nomor)/i.test(h.trim())
    );
    const nameCol =
      doc.csvHeaders.find((h) =>
        /nama|item|barang|cabang|indikator|pos|topik|parameter|klausul|entitas/i.test(
          h
        )
      ) ||
      doc.csvHeaders.find((h) => h !== codeCol) ||
      doc.csvHeaders[0];
    const periodCol = doc.csvHeaders.find((h) =>
      /kuartal|periode|tahun|bulan|tanggal/i.test(h)
    );
    const categoryCol = doc.csvHeaders.find((h) =>
      /kategori|divisi|bagian|jurusan|lokasi/i.test(h)
    );

    doc.csvRows.forEach((row, idx) => {
      const rowNum = idx + 2;
      const rawName = (row[nameCol] || '').trim();
      const rawCode = codeCol ? (row[codeCol] || '').trim() : undefined;
      const periodVal = periodCol ? (row[periodCol] || '').trim() : '';
      if (!rawName && !rawCode) return;

      const displayName = periodVal
        ? `${rawName || rawCode} (${periodVal})`
        : rawName || rawCode || `Baris ${rowNum}`;
      const entityKey = normalizeEntityKey(
        periodVal ? `${rawName} ${periodVal}` : rawName || rawCode || ''
      );

      const attributes: Record<string, string> = {};
      const numericMetrics: Record<
        string,
        { value: number; unit: string; raw: string }
      > = {};

      doc.csvHeaders!.forEach((h) => {
        const cellVal = (row[h] ?? '').trim();
        attributes[h] = cellVal;
        if (h !== codeCol && h !== nameCol && h !== periodCol) {
          const parsedNum = parseNumericAndUnit(cellVal);
          if (parsedNum) {
            numericMetrics[h] = parsedNum;
          }
        }
      });

      const summaryParts = doc
        .csvHeaders!.filter((h) => h !== nameCol && row[h])
        .map((h) => `${h.replace(/_/g, ' ')}: ${row[h]}`);

      entities.push({
        id: `${doc.id}-ent-${rowNum}`,
        documentName: doc.name,
        pageNumber: rowNum,
        locationLabel: `Baris ${rowNum}`,
        rawRowText: Object.entries(row)
          .map(([k, v]) => `${k}: ${v}`)
          .join(' | '),
        entityKey,
        displayName,
        category: categoryCol ? row[categoryCol] : periodVal || undefined,
        entityCode:
          rawCode && rawCode !== '-' ? rawCode.toUpperCase() : undefined,
        attributes,
        numericMetrics,
        statusOrClauseText: summaryParts.join(' · '),
      });
    });

    return { entities, headers, entityTypeLabel };
  }

  // PDF extraction: scan pipe-delimited table rows AND structured bullet/clause lines
  let activePipeHeaders: string[] = [];

  doc.sections.forEach((sec, secIdx) => {
    const pageNum = sec.pageNumber || secIdx + 1;
    const lines = sec.content
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    lines.forEach((line, lineIdx) => {
      if (line.includes('|')) {
        const cells = line
          .split('|')
          .map((c) => c.trim())
          .filter(Boolean);
        if (cells.length >= 2) {
          // Check if this is a header row
          const isHeaderRow =
            cells.every((c) => !/\d{2,}/.test(c)) &&
            cells.some((c) =>
              /^(?:no|nomor|kode|klausul|pos|parameter|indikator|nama|topik|item|barang|cabang)/i.test(
                c
              )
            );
          if (isHeaderRow) {
            activePipeHeaders = cells;
            cells.forEach((h) => {
              if (!headers.includes(h)) headers.push(h);
            });
            return;
          }

          // Parse pipe data row
          const firstCell = cells[0];
          const secondCell = cells[1] || '';
          const isFirstCodeOrIndex =
            /^(?:\d{1,3}|[A-Z]{2,5}[-/]\d+|Pasal\s+\d+|Klausul\s+\d+)$/i.test(
              firstCell
            );

          const entityCode =
            /^(?:[A-Z]{2,5}[-/]\d+|Pasal\s+\d+|Klausul\s+\d+|\d{8,20})$/i.test(
              firstCell
            )
              ? firstCell.toUpperCase()
              : undefined;

          const displayName = isFirstCodeOrIndex
            ? /^Pasal\s+\d+/i.test(firstCell) && secondCell
              ? `${firstCell} — ${secondCell}`
              : secondCell || firstCell
            : firstCell;

          const keySource =
            /^Pasal\s+\d+/i.test(firstCell) && secondCell
              ? `${firstCell} ${secondCell}`
              : isFirstCodeOrIndex && secondCell
              ? secondCell
              : firstCell;

          const entityKey = normalizeEntityKey(keySource);
          if (!entityKey || entityKey.length < 2) return;

          const attributes: Record<string, string> = {};
          const numericMetrics: Record<
            string,
            { value: number; unit: string; raw: string }
          > = {};

          cells.forEach((cell, cIdx) => {
            const colName = activePipeHeaders[cIdx] || `Kolom_${cIdx + 1}`;
            attributes[colName] = cell;
            if (cIdx > 0) {
              const parsedNum = parseNumericAndUnit(cell);
              if (parsedNum) {
                numericMetrics[colName] = parsedNum;
              }
            }
          });

          const valueCells = isFirstCodeOrIndex ? cells.slice(2) : cells.slice(1);
          entities.push({
            id: `${doc.id}-p${pageNum}-l${lineIdx}`,
            documentName: doc.name,
            pageNumber: pageNum,
            locationLabel: `Halaman ${pageNum}`,
            rawRowText: line,
            entityKey,
            displayName,
            category: activePipeHeaders[0] || undefined,
            entityCode,
            attributes,
            numericMetrics,
            statusOrClauseText:
              valueCells.join(' | ') || cells.slice(1).join(' | '),
          });
          return;
        }
      }

      // Also check structured bullet/key-value lines: e.g. "- Kuartal 3 (Q3 2026): Rp 17.500 Juta" or "- Cabang Surabaya Timur: Rp 5.400 Juta"
      const kvMatch = line.match(
        /^(?:[-•*]|\d+[.)])\s*([^:]{3,65}):\s*(.+)$/
      );
      if (kvMatch) {
        const keyLabel = kvMatch[1].trim();
        const valText = kvMatch[2].trim();
        const entityKey = normalizeEntityKey(keyLabel);
        const parsedNum = parseNumericAndUnit(valText);
        const numericMetrics: Record<
          string,
          { value: number; unit: string; raw: string }
        > = {};
        if (parsedNum) {
          numericMetrics['Nilai'] = parsedNum;
        }
        entities.push({
          id: `${doc.id}-p${pageNum}-kv${lineIdx}`,
          documentName: doc.name,
          pageNumber: pageNum,
          locationLabel: `Halaman ${pageNum}`,
          rawRowText: line,
          entityKey,
          displayName: keyLabel,
          attributes: { Indikator: keyLabel, Nilai: valText },
          numericMetrics,
          statusOrClauseText: valText,
        });
      }
    });
  });

  return { entities, headers, entityTypeLabel };
}

/**
 * Builds a Universal Cross-Document Comparison Matrix for ANY domain (Finance, Legal, Research, Inventory, etc.).
 * Compares matching entities across documents, normalizes numbers/units, flags ambiguous similarity without forcing merges,
 * and records single-document or duplicate items.
 */
export function buildUniversalComparisonMatrix(
  documents: UploadedDocumentPayload[],
  customQuestion = ''
): ComparisonMatrix {
  if (documents.length === 0) {
    return {
      isApplicable: false,
      title: 'Tabel Perbandingan Lintas Dokumen',
      subtitle: 'Belum ada dokumen yang diunggah',
      entityLabel: 'Entitas / Indikator',
      documentColumns: [],
      rows: [],
      ambiguousMatches: [],
      unmatchedEntities: [],
      limitations: ['Unggah minimal 1 dokumen untuk melihat tabel analisis.'],
    };
  }

  const perDoc = documents.map((doc) => ({
    doc,
    ...extractGenericEntitiesFromDocument(doc),
  }));

  const primaryTypeLabel =
    perDoc.find((d) => d.entityTypeLabel !== 'Entitas / Indikator')
      ?.entityTypeLabel || 'Entitas / Indikator';

  const docNames = documents.map((d) => d.name);
  const rows: ComparisonMatrixRow[] = [];
  const ambiguousMatches: ComparisonMatrix['ambiguousMatches'] = [];
  const unmatchedEntities: ComparisonMatrix['unmatchedEntities'] = [];
  const limitations: string[] = [];

  // Check for intra-document duplicates
  perDoc.forEach(({ doc, entities }) => {
    const seenByCode = new Map<string, ExtractedEntityRecord>();
    const seenByKey = new Map<string, ExtractedEntityRecord>();
    entities.forEach((ent) => {
      if (ent.entityCode && seenByCode.has(ent.entityCode)) {
        const prev = seenByCode.get(ent.entityCode)!;
        ambiguousMatches.push({
          pairLabel: `Duplikat Kode ${ent.entityCode} (${ent.displayName})`,
          reason: `Ditemukan entri ganda pada dokumen yang sama (${doc.name})`,
          sources: `${doc.name} (${prev.locationLabel} & ${ent.locationLabel})`,
        });
      } else if (ent.entityCode) {
        seenByCode.set(ent.entityCode, ent);
      }

      if (
        ent.rawRowText.toLowerCase().includes('tercatat ganda') ||
        ent.rawRowText.toLowerCase().includes('duplikat')
      ) {
        ambiguousMatches.push({
          pairLabel: `${ent.displayName} (${ent.entityCode || 'Duplikat'})`,
          reason: `Catatan sumber menyebutkan indikasi pencatatan ganda: "${ent.statusOrClauseText}"`,
          sources: `${doc.name} (${ent.locationLabel})`,
        });
      }
      seenByKey.set(ent.entityKey, ent);
    });
  });

  if (documents.length === 1) {
    const single = perDoc[0];
    single.entities.slice(0, 20).forEach((ent, idx) => {
      rows.push({
        id: `row-single-${idx}`,
        entityName: ent.displayName,
        category: ent.category || single.entityTypeLabel,
        docValues: {
          [single.doc.name]: ent.statusOrClauseText || '-',
        },
        differenceOrRelation: 'Dokumen Tunggal',
        status:
          /belum_tersedia|belum\s+tersedia/i.test(ent.rawRowText)
            ? 'Data Belum Lengkap'
            : 'Konsisten',
        sourceCitation: `${single.doc.name} (${ent.locationLabel})`,
      });
    });

    return {
      isApplicable: rows.length > 0,
      title: `Tabel Ekstraksi Terstruktur (${primaryTypeLabel})`,
      subtitle: `Diekstrak dari ${single.doc.name}`,
      entityLabel: primaryTypeLabel,
      documentColumns: [single.doc.name],
      rows,
      ambiguousMatches,
      unmatchedEntities,
      limitations: [
        'Hanya 1 dokumen yang diunggah; unggah dokumen pembanding untuk melihat komparasi lintas dokumen.',
      ],
    };
  }

  // Multi-document comparison
  const docA = perDoc[0];
  const otherDocs = perDoc.slice(1);
  const matchedOtherIds = new Set<string>();

  // Check if schemas/headers differ across documents
  const headersA = docA.headers.join(', ');
  const headersB = otherDocs.map((d) => d.headers.join(', ')).join(' | ');
  if (headersA && headersB && headersA !== headersB) {
    limitations.push(
      `Struktur kolom antar dokumen tidak identik (${docA.doc.name}: [${headersA}] vs Dokumen Pembanding: [${headersB}]). Sistem menormalisasi atribut yang sepadan berdasarkan kode entitas dan topik.`
    );
  }

  docA.entities.forEach((entA) => {
    const docValues: Record<string, string> = {
      [docA.doc.name]: entA.statusOrClauseText || '-',
    };
    const citations: string[] = [`${docA.doc.name} (${entA.locationLabel})`];
    let matchedCount = 0;
    let isAmbiguous = false;
    const matchedEntities: ExtractedEntityRecord[] = [];

    otherDocs.forEach((other) => {
      // 1. Try exact entityCode match (SKU, Clause Number, Branch Code)
      let match = entA.entityCode
        ? other.entities.find(
            (e) =>
              !matchedOtherIds.has(e.id) &&
              e.entityCode &&
              e.entityCode === entA.entityCode
          )
        : undefined;

      // Check if code matched but display names have subtle differences (e.g. Modul X2 vs Modul X-2)
      if (match) {
        const cleanA = entA.displayName.replace(/\s+/g, ' ').trim();
        const cleanB = match.displayName.replace(/\s+/g, ' ').trim();
        if (cleanA.toLowerCase() !== cleanB.toLowerCase()) {
          isAmbiguous = true;
          ambiguousMatches.push({
            pairLabel: `${cleanA} ↔ ${cleanB}`,
            reason: `Kode identik (${entA.entityCode}) namun penulisan nama sedikit berbeda antar dokumen`,
            sources: `${docA.doc.name} (${entA.locationLabel}) & ${other.doc.name} (${match.locationLabel})`,
          });
        }
      }

      // 2. Try normalized entityKey match or substring match for branch/clause/parameter
      if (!match) {
        match = other.entities.find((e) => {
          if (matchedOtherIds.has(e.id)) return false;
          if (e.entityKey === entA.entityKey) return true;
          // Also match if one includes the other and length >= 6 (e.g. "Surabaya Timur Q3 2026" vs "Surabaya Timur")
          if (
            entA.entityKey.length >= 6 &&
            e.entityKey.length >= 6 &&
            (entA.entityKey.includes(e.entityKey) ||
              e.entityKey.includes(entA.entityKey))
          ) {
            return true;
          }
          return false;
        });
      }

      // 3. Try similarity check for ambiguous entity names
      if (!match) {
        for (const cand of other.entities) {
          if (matchedOtherIds.has(cand.id)) continue;
          const sim = areNamesAmbiguouslySimilar(
            entA.entityKey,
            cand.entityKey
          );
          if (sim.similar) {
            match = cand;
            isAmbiguous = true;
            ambiguousMatches.push({
              pairLabel: `${entA.displayName} ≈ ${cand.displayName}`,
              reason: `Kemiripan nama entitas yang ambigu (${sim.reason}) — ditandai untuk verifikasi agar tidak digabung secara buta`,
              sources: `${docA.doc.name} (${entA.locationLabel}) & ${other.doc.name} (${cand.locationLabel})`,
            });
            break;
          }
        }
      }

      if (match) {
        matchedOtherIds.add(match.id);
        matchedCount++;
        matchedEntities.push(match);
        docValues[other.doc.name] = match.statusOrClauseText || '-';
        citations.push(`${other.doc.name} (${match.locationLabel})`);
      } else {
        docValues[other.doc.name] = 'Tidak Tercantum';
      }
    });

    if (matchedCount === 0) {
      unmatchedEntities.push({
        entityName: entA.displayName,
        documentName: docA.doc.name,
        location: entA.locationLabel,
        valueSummary: entA.statusOrClauseText || '-',
        reason: `Hanya tercantum di ${docA.doc.name}`,
      });

      if (
        /belum_tersedia|belum\s+tersedia/i.test(entA.rawRowText) ||
        docA.entities.length <= 10
      ) {
        rows.push({
          id: `row-unmatched-a-${rows.length + 1}`,
          entityName: entA.displayName,
          category: entA.category || primaryTypeLabel,
          docValues,
          differenceOrRelation: `Hanya ada di ${docA.doc.name}`,
          status: /belum_tersedia|belum\s+tersedia/i.test(entA.rawRowText)
            ? 'Data Belum Lengkap'
            : 'Hanya di 1 Dokumen',
          sourceCitation: citations.join(' & '),
        });
      }
      return;
    }

    // Compare numeric values or text clauses between entA and matchedEntities[0]
    const entB = matchedEntities[0];
    const metricsA = Object.values(entA.numericMetrics);
    const metricsB = Object.values(entB.numericMetrics);

    let differenceOrRelation = 'Sesuai / Konsisten';
    let status: ComparisonMatrixRow['status'] = isAmbiguous
      ? 'Kecocokan Ambigu'
      : 'Konsisten';

    const hasMissingData =
      /belum_tersedia|belum\s+tersedia/i.test(entA.rawRowText) ||
      /belum_tersedia|belum\s+tersedia/i.test(entB.rawRowText);

    if (hasMissingData) {
      status = 'Data Belum Lengkap';
      differenceOrRelation = 'Terdapat atribut yang belum tersedia (BELUM_TERSEDIA)';
    } else if (metricsA.length > 0 && metricsB.length > 0) {
      // Find comparable metric pair
      const mA = metricsA[0];
      const mB =
        metricsB.find((m) => m.unit === mA.unit) || metricsB[0];
      const delta = Math.round((mB.value - mA.value) * 100) / 100;
      const absDelta = Math.abs(delta);

      if (absDelta > 0.001) {
        const pct =
          mA.value !== 0
            ? `${delta > 0 ? '+' : ''}${((delta / Math.abs(mA.value)) * 100).toFixed(1)}%`
            : '';
        const sign = delta > 0 ? '+' : '';
        differenceOrRelation = `Selisih: ${sign}${delta.toLocaleString('id-ID')} ${mA.unit !== 'angka' ? mA.unit : ''} ${pct ? `(${pct})` : ''}`.trim();
        status =
          /selisih|konflik|lebih\s+saji|rusak|kurang/i.test(
            `${entA.rawRowText} ${entB.rawRowText}`
          )
            ? 'Konflik Material'
            : 'Berbeda / Berubah';
      } else {
        differenceOrRelation = `Konsisten (${mA.raw})`;
      }
    } else if (
      (entA.statusOrClauseText || '').toLowerCase() !==
      (entB.statusOrClauseText || '').toLowerCase()
    ) {
      differenceOrRelation = 'Terdapat perubahan ketentuan / nilai antar dokumen';
      status = 'Berbeda / Berubah';
    }

    rows.push({
      id: `row-comp-${rows.length + 1}`,
      entityName: entA.displayName,
      category: entA.category || primaryTypeLabel,
      docValues,
      differenceOrRelation,
      status: isAmbiguous && status === 'Konsisten' ? 'Kecocokan Ambigu' : status,
      sourceCitation: citations.join(' & '),
    });
  });

  // Check remaining unmatched entities in otherDocs
  otherDocs.forEach((other) => {
    other.entities.forEach((entB) => {
      if (!matchedOtherIds.has(entB.id)) {
        unmatchedEntities.push({
          entityName: entB.displayName,
          documentName: other.doc.name,
          location: entB.locationLabel,
          valueSummary: entB.statusOrClauseText || '-',
          reason: `Hanya tercantum di ${other.doc.name} (Tidak ditemukan di ${docA.doc.name})`,
        });

        const docValues: Record<string, string> = {};
        docNames.forEach((dn) => {
          docValues[dn] =
            dn === other.doc.name
              ? entB.statusOrClauseText || '-'
              : 'Tidak Tercantum';
        });

        if (rows.length < 25) {
          rows.push({
            id: `row-unmatched-b-${rows.length + 1}`,
            entityName: entB.displayName,
            category: entB.category || primaryTypeLabel,
            docValues,
            differenceOrRelation: `Hanya ada di ${other.doc.name}`,
            status: 'Hanya di 1 Dokumen',
            sourceCitation: `${other.doc.name} (${entB.locationLabel})`,
          });
        }
      }
    });
  });

  return {
    isApplicable: rows.length > 0 || unmatchedEntities.length > 0,
    title: `Tabel Komparasi & Keterkaitan Lintas Dokumen (${primaryTypeLabel})`,
    subtitle: customQuestion
      ? `Fokus Instruksi: "${customQuestion}"`
      : `Membandingkan ${documents.length} dokumen (${docNames.join(' vs ')})`,
    entityLabel: primaryTypeLabel,
    documentColumns: docNames,
    rows,
    ambiguousMatches,
    unmatchedEntities,
    limitations:
      limitations.length > 0
        ? limitations
        : [
            'Entitas dicocokkan melalui normalisasi kode, nama atribut, dan kesamaan semantik tanpa menggabungkan kecocokan yang ambigu secara paksa.',
          ],
  };
}

