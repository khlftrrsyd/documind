export type AnalysisModeId =
  | 'synthesis'
  | 'comparison'
  | 'gap_analysis'
  | 'estimation';

export type DocumentFormat = 'pdf' | 'csv';

export type DocumentExtractionStatus =
  | 'extracting'
  | 'ready'
  | 'success'
  | 'ocr_completed'
  | 'ocr_fallback'
  | 'empty_or_unreadable'
  | 'failed_scanned_or_empty'
  | 'error';

export interface ParsedPageOrSection {
  locationLabel: string; // e.g., "Halaman 1", "Baris 2–11"
  pageNumber?: number;
  content: string;
  charCount?: number;
}

/**
 * Generic extracted entity, table row, clause, or metric record from any PDF or CSV document.
 */
export interface ExtractedEntityRecord {
  id: string;
  documentName: string;
  pageNumber: number;
  locationLabel: string;
  rawRowText: string;
  entityKey: string; // Normalized key for matching across documents
  displayName: string; // Human-readable name (e.g., item name, budget line, clause title, entity name)
  category?: string; // Section, category, department, or group
  entityCode?: string; // Optional SKU, code, ID, or clause number
  maskedCode?: string; // Optional masked ID if sensitive long identity number
  attributes: Record<string, string>; // Flexible key-value attributes extracted from columns or text
  numericMetrics: Record<string, { value: number; unit: string; raw: string }>;
  statusOrClauseText?: string;
}

/**
 * Legacy-compatible alias so existing history or external imports do not break
 */
export interface ExtractedParticipantRecord {
  id: string;
  documentName: string;
  pageNumber: number;
  locationLabel: string;
  rawRowText: string;
  participantNumber?: string;
  maskedParticipantNumber?: string;
  rawName: string;
  normalizedName: string;
  major?: string;
  skdScore?: string;
  psikologiScore?: string;
  skdStatus: string;
  psikologiStatus: string;
  kesamaptaanStatus: string;
  notes?: string;
}

export interface UploadedDocumentPayload {
  id: string;
  name: string;
  format: DocumentFormat;
  sizeBytes: number;
  uploadedAt?: string;
  /** Extracted readable text or formatted CSV text */
  textContent: string;
  /** Optional base64-encoded file bytes for native PDF analysis via server pdfjs & Gemini inlineData */
  base64Data?: string;
  mimeType?: string;
  /** Structured pages or CSV row groups for source inspection */
  sections?: ParsedPageOrSection[];
  parsedSections?: ParsedPageOrSection[];
  /** Optional parsed CSV rows if format === 'csv' */
  csvHeaders?: string[];
  csvRows?: Record<string, string>[];
  /** Audit & extraction diagnostics */
  extractionStatus?: DocumentExtractionStatus;
  extractionMethod?:
    | 'pdfjs-server'
    | 'pdf-zlib-stream'
    | 'tesseract-ocr'
    | 'gemini-ocr'
    | 'csv-parser'
    | 'pdf-local';
  extractedCharCount?: number;
  pageCount?: number;
  pageOrRowCount?: number;
  isScannedOrEmpty?: boolean;
  detectedDomain?: string;
  detectedTableHeaders?: string[];
  detectedEntitiesCount?: number;
  detectedParticipantCount?: number;
  documentSummary?: string;
  extractionWarning?: string;
  diagnosticNote?: string;
  isEncrypted?: boolean;
  needsPassword?: boolean;
}

export interface SourceCitation {
  documentName: string;
  location: string; // e.g., "Halaman 2" or "Baris 4, Kolom Realisasi"
  excerpt?: string;
}

export type FactClassification =
  | 'Fakta Eksplisit'
  | 'Interpretasi'
  | 'Kesimpulan Turunan';

export interface ExplicitFact {
  id: string;
  category: string;
  factType?: FactClassification;
  statement: string;
  value: string;
  verificationStatus?:
    | 'Terverifikasi dari Sumber'
    | 'Diturunkan dari Bukti'
    | 'Perlu Verifikasi';
  /** Optional legacy field for older saved history reports */
  confidence?: 'Tinggi' | 'Sedang';
  citation: SourceCitation;
}

export interface DerivedCalculation {
  id: string;
  metricName: string;
  formula: string;
  inputsUsed: string[];
  resultValue: string;
  unit?: string;
  period?: string;
  interpretation: string;
  citations: SourceCitation[];
}

export interface DataConflict {
  id: string;
  topic: string;
  severity: 'Tinggi' | 'Sedang' | 'Rendah';
  documentA: {
    documentName: string;
    location: string;
    reportedValue: string;
  };
  documentB: {
    documentName: string;
    location: string;
    reportedValue: string;
  };
  discrepancyExplanation: string;
  recommendedResolution: string;
}

export interface EvidenceEstimation {
  id: string;
  targetMetric: string;
  estimatedValue: string;
  hasSufficientEvidence: boolean;
  method: string;
  uncertaintyRange?: string;
  assumptions: string[];
  supportingData: string[];
  limitations: string[];
  citations: SourceCitation[];
}

export interface MissingOrUncertainInfo {
  id: string;
  topic: string;
  status:
    | 'Belum Tercantum di Dokumen'
    | 'Gagal Diekstrak / Tidak Terbaca'
    | 'Tidak Dapat Dipastikan'
    | 'Bukti Tidak Cukup'
    | 'Belum Tersedia';
  gapCategory?: 'Data Hilang / Kosong' | 'Ekstraksi / OCR' | 'Konflik Belum Terkonfirmasi' | 'Kriteria Pengguna';
  whyNeeded: string;
  missingFromDocuments: string[];
  impactOnConclusion: string;
  recommendedVerification?: string;
}

export interface SummaryTableRow {
  indicator: string;
  category:
    | 'Fakta Eksplisit'
    | 'Interpretasi & Sintesis'
    | 'Perhitungan Turunan'
    | 'Perbandingan Data'
    | 'Konflik Data'
    | 'Estimasi'
    | 'Kesenjangan Data';
  valueOrFinding: string;
  verificationStatus:
    | 'Terbukti dari Sumber'
    | 'Dihitung dari Bukti'
    | 'Terdapat Perbedaan'
    | 'Terdapat Konflik'
    | 'Estimasi Bersyarat'
    | 'Belum Terbukti';
  primarySource: string;
}

/**
 * Universal Cross-Document Comparison & Entity Matching Matrix
 * Works for Financial Budgets, Legal Clauses, Research Findings, Inventory Lists, or Entity Records.
 */
export interface ComparisonMatrixRow {
  id: string;
  entityName: string;
  category: string;
  docValues: Record<string, string>; // Keyed by documentName or column label
  differenceOrRelation: string;
  status:
    | 'Konsisten'
    | 'Berbeda / Berubah'
    | 'Konflik Material'
    | 'Kecocokan Ambigu'
    | 'Hanya di 1 Dokumen'
    | 'Data Belum Lengkap';
  sourceCitation: string;
}

export interface ComparisonMatrix {
  isApplicable: boolean;
  title: string;
  subtitle: string;
  entityLabel: string; // e.g., "Pos Anggaran", "Klausul Kontrak", "Item Inventaris", "Topik Penelitian", "Entitas"
  documentColumns: string[]; // Document names or comparison column headers
  rows: ComparisonMatrixRow[];
  ambiguousMatches: Array<{
    pairLabel: string;
    reason: string;
    sources: string;
  }>;
  unmatchedEntities: Array<{
    entityName: string;
    documentName: string;
    location: string;
    valueSummary: string;
    reason: string;
  }>;
  limitations: string[];
}

/**
 * Legacy-compatible Cross-Document Match Report structure
 */
export interface MatchedParticipantRow {
  rowNumber: number;
  participantName: string;
  maskedId?: string;
  matchedBy: string;
  skdScore: string;
  psikologiScore: string;
  majorCompatibility: string;
  psikologiStatus: string;
  kesamaptaanStatus: string;
  sourceTraceability: string;
  sourceShort?: string;
  matchBadge?: string;
  meetsAllTargetCriteria: boolean;
}

export interface SingleDocumentOnlyItem {
  participantName: string;
  maskedId?: string;
  major?: string;
  skdScore?: string;
  psikologiScore?: string;
  statusInDocument: string;
  documentName: string;
  location: string;
  reasonNotMatched: string;
}

export interface UncertainParticipantItem {
  participantName: string;
  maskedId?: string;
  skdScore?: string;
  psikologiScore?: string;
  issueDescription: string;
  documentName: string;
  location: string;
}

export interface DuplicateOrMismatchItem {
  participantNameOrPair: string;
  issueType: string;
  details: string;
  sources: string;
}

export interface CrossDocumentMatchReport {
  isApplicable: boolean;
  targetMajorFilter: string;
  documentAName: string;
  documentBName: string;
  totalExtractedDocA: number;
  totalExtractedDocB: number;
  totalTargetMajorInDocA: number;
  qualifiedMatchedRows: MatchedParticipantRow[];
  allEvaluatedRows: MatchedParticipantRow[];
  matchedCount: number;
  matchingMethodSummary: string;
  singleDocumentOnly: SingleDocumentOnlyItem[];
  uncertainStatusParticipants: UncertainParticipantItem[];
  duplicatesOrMismatches: DuplicateOrMismatchItem[];
  analysisLimitations: string[];
  zeroMatchExplanation?: string;
}

export interface PerDocumentSummary {
  documentName: string;
  format: DocumentFormat;
  pageOrSectionCount: number;
  extractedCharCount: number;
  detectedStructure: string;
  keyTopics: string[];
  headlineSummary: string;
}

export interface AnalysisReport {
  id: string;
  createdAt: string;
  analysisMode: AnalysisModeId;
  customQuestion: string;
  documentNames: string[];
  detectedDomain?: string;
  engineUsed: 'gemini-3.8-flash' | 'deterministic-engine';
  engineNote?: string;
  executiveSummary: string;
  directAnswerToQuestion: string;
  conclusionValidityNote: string;
  methodologyNote?: string;
  limitationsAndAssumptions?: string[];
  perDocumentSummaries?: PerDocumentSummary[];
  comparisonMatrix?: ComparisonMatrix;
  explicitFacts: ExplicitFact[];
  calculations: DerivedCalculation[];
  conflicts: DataConflict[];
  estimations: EvidenceEstimation[];
  uncertainties: MissingOrUncertainInfo[];
  summaryTable: SummaryTableRow[];
  crossDocumentMatch?: CrossDocumentMatchReport;
}

export interface ServerHealthStatus {
  status: 'ok';
  geminiConfigured: boolean;
  modelName: string;
  storageMode: string;
}
