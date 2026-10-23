import React, { useRef, useState } from 'react';
import {
  Upload,
  FileText,
  FileSpreadsheet,
  Trash2,
  Play,
  Layers,
  GitCompare,
  AlertTriangle,
  TrendingUp,
  Plus,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Edit3,
  BarChart3,
  Database,
  Scale,
  Users,
  Briefcase,
  Sparkles,
  FileCheck2,
} from 'lucide-react';
import {
  AnalysisModeId,
  ParsedPageOrSection,
  UploadedDocumentPayload,
} from '../types/analysis';
import {
  extractPdfTextAndPages,
  parseCsvContent,
} from '../utils/documentParser';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

async function extractTextWithPdfJs(arrayBuffer: ArrayBuffer): Promise<{
  textContent: string;
  sections: ParsedPageOrSection[];
  extractedCharCount: number;
  pageCount: number;
}> {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
  });
  const pdf = await loadingTask.promise;
  const sections: ParsedPageOrSection[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContentObj = await page.getTextContent();
    const rawItems = textContentObj.items as Array<{
      str?: string;
      transform?: number[];
      hasEOL?: boolean;
    }>;

    const lineBuckets: Array<{
      y: number;
      items: Array<{ x: number; text: string }>;
    }> = [];
    const yTolerance = 4.5;

    for (const item of rawItems) {
      const str = (item.str || '').trim();
      if (!str) continue;
      const x =
        Array.isArray(item.transform) && typeof item.transform[4] === 'number'
          ? item.transform[4]
          : 0;
      const y =
        Array.isArray(item.transform) && typeof item.transform[5] === 'number'
          ? item.transform[5]
          : 0;

      let bucket = lineBuckets.find((b) => Math.abs(b.y - y) <= yTolerance);
      if (!bucket) {
        bucket = { y, items: [] };
        lineBuckets.push(bucket);
      }
      bucket.items.push({ x, text: str });
    }

    lineBuckets.sort((a, b) => b.y - a.y);

    const reconstructedLines = lineBuckets
      .map((bucket) => {
        bucket.items.sort((a, b) => a.x - b.x);
        return bucket.items.map((it) => it.text).join('  ');
      })
      .filter((line) => line.trim().length > 0);

    const pageText =
      reconstructedLines.length > 0
        ? reconstructedLines.join('\n')
        : rawItems
            .map((it) => it.str || '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();

    if (pageText.length > 0) {
      sections.push({
        locationLabel: `Halaman ${pageNum}`,
        pageNumber: pageNum,
        content: pageText,
        charCount: pageText.length,
      });
    }
  }

  const textContent = sections
    .map((s) => `[${s.locationLabel}]\n${s.content}`)
    .join('\n\n');
  const extractedCharCount = sections.reduce((sum, s) => sum + s.charCount, 0);

  return {
    textContent,
    sections,
    extractedCharCount,
    pageCount: pdf.numPages,
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function parseUploadedFile(file: File): Promise<UploadedDocumentPayload> {
  const isCsv =
    file.name.toLowerCase().endsWith('.csv') ||
    file.name.toLowerCase().endsWith('.tsv') ||
    file.type === 'text/csv';

  if (isCsv) {
    const rawText = await file.text();
    const parsedCsv = parseCsvContent(rawText);
    const charCount = parsedCsv.formattedText.trim().length;
    return {
      id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      format: 'csv',
      sizeBytes: file.size,
      pageOrRowCount: parsedCsv.rows.length,
      textContent: parsedCsv.formattedText,
      extractedCharCount: charCount,
      extractionStatus: charCount > 0 ? 'success' : 'failed_scanned_or_empty',
      parsedSections: parsedCsv.sections,
      csvHeaders: parsedCsv.headers,
      csvRows: parsedCsv.rows,
    };
  }

  const buffer = await file.arrayBuffer();
  try {
    const pdfJsResult = await extractTextWithPdfJs(buffer);
    if (pdfJsResult.extractedCharCount > 0) {
      return {
        id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        format: 'pdf',
        sizeBytes: file.size,
        pageOrRowCount: Math.max(
          1,
          pdfJsResult.pageCount || pdfJsResult.sections.length
        ),
        textContent: pdfJsResult.textContent,
        extractedCharCount: pdfJsResult.extractedCharCount,
        extractionStatus: 'success',
        parsedSections: pdfJsResult.sections,
      };
    }
  } catch {
    // Fallback to raw binary stream extraction below
  }

  const rawLatin1 = new TextDecoder('latin1').decode(buffer);
  const fallbackPdf = extractPdfTextAndPages(rawLatin1);
  if (fallbackPdf.extractedCharCount > 0) {
    return {
      id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      format: 'pdf',
      sizeBytes: file.size,
      pageOrRowCount: Math.max(1, fallbackPdf.sections.length),
      textContent: fallbackPdf.textContent,
      extractedCharCount: fallbackPdf.extractedCharCount,
      extractionStatus: 'success',
      parsedSections: fallbackPdf.sections,
    };
  }

  const canAttachMultimodal = file.size > 0 && file.size <= 12 * 1024 * 1024;
  return {
    id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: file.name,
    format: 'pdf',
    sizeBytes: file.size,
    pageOrRowCount: 1,
    textContent: '',
    extractedCharCount: 0,
    extractionStatus: canAttachMultimodal
      ? 'ocr_fallback'
      : 'failed_scanned_or_empty',
    base64Data: canAttachMultimodal ? arrayBufferToBase64(buffer) : undefined,
    mimeType: 'application/pdf',
  };
}

interface UploadWorkspaceProps {
  documents: UploadedDocumentPayload[];
  onAddDocuments: (docs: UploadedDocumentPayload[]) => void;
  onUpdateDocument: (
    id: string,
    updates: Partial<UploadedDocumentPayload>
  ) => void;
  onRemoveDocument: (id: string) => void;
  onClearDocuments: () => void;
  onLoadSamplePreset: (presetId: string) => void;
  activePresetId?: string | null;
  selectedMode: AnalysisModeId;
  onSelectMode: (mode: AnalysisModeId) => void;
  customQuestion: string;
  onChangeQuestion: (q: string) => void;
  storageConsent: boolean;
  onToggleStorageConsent: (consent: boolean) => void;
  onRunAnalysis: () => void;
  isAnalyzing: boolean;
  errorMessage: string | null;
  onDismissError: () => void;
}

interface ModeCardConfig {
  id: AnalysisModeId;
  title: string;
  shortDesc: string;
  outputs: string[];
  icon: React.ComponentType<{ className?: string }>;
}

interface ScenarioCardConfig {
  id: string;
  title: string;
  domain: string;
  fileSummary: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SCENARIO_PRESETS: ScenarioCardConfig[] = [
  {
    id: 'finance',
    title: 'Keuangan & Operasional',
    domain: 'Korporasi & Audit',
    fileSummary: '2 PDF + 1 CSV',
    description:
      'Laporan kinerja keuangan Q3, rekapitulasi penjualan cabang (CSV), dan memo audit internal.',
    icon: Briefcase,
  },
  {
    id: 'legal',
    title: 'Kontrak & Klausul Hukum',
    domain: 'Legal & Kepatuhan',
    fileSummary: '2 Dokumen PDF',
    description:
      'Perjanjian kerja sama induk (MSA) dan adendum perubahan termin pembayaran, SLA, serta batas penalti.',
    icon: Scale,
  },
  {
    id: 'research',
    title: 'Riset & Evaluasi Teknis',
    domain: 'Sains & Akademik',
    fileSummary: '2 Dokumen PDF',
    description:
      'Laporan uji efisiensi panel surya laboratorium dan hasil observasi performa lapangan.',
    icon: Sparkles,
  },
  {
    id: 'inventory',
    title: 'Inventaris & Stok Gudang',
    domain: 'Logistik & ERP',
    fileSummary: '1 CSV + 1 PDF',
    description:
      'Rekonsiliasi data stok sistem ERP (CSV) dengan berita acara stok opname fisik gudang (PDF).',
    icon: Users,
  },
];

const MODE_CARDS: ModeCardConfig[] = [
  {
    id: 'synthesis',
    title: 'Analisis & Sintesis',
    shortDesc: 'Gabungkan fakta dan temuan utama lintas dokumen.',
    outputs: ['Ringkasan Lintas File', 'Pemetaan Fakta', 'Jejak Sitasi'],
    icon: Layers,
  },
  {
    id: 'comparison',
    title: 'Perbandingan Data',
    shortDesc: 'Bandingkan angka, klausul, atau entitas antar file.',
    outputs: ['Matriks Komparasi', 'Normalisasi Satuan', 'Deteksi Konflik'],
    icon: GitCompare,
  },
  {
    id: 'gap_analysis',
    title: 'Kesenjangan Data',
    shortDesc: 'Temukan informasi hilang, belum lengkap, atau konflik.',
    outputs: ['Audit Kelengkapan', 'Peringatan Konflik', 'Saran Verifikasi'],
    icon: AlertTriangle,
  },
  {
    id: 'estimation',
    title: 'Estimasi & Tren',
    shortDesc: 'Hitung total, rasio, selisih, dan proyeksi tren.',
    outputs: ['Kalkulasi Deterministik', 'Analisis Tren', 'Rentang Bukti'],
    icon: TrendingUp,
  },
];

const PIPELINE_STEPS = [
  {
    step: '01',
    title: 'Ekstraksi & OCR',
    detail: 'Teks, tabel CSV, & PDF pindaian',
  },
  {
    step: '02',
    title: 'Pemetaan Struktur',
    detail: 'Penyelarasan halaman & kolom',
  },
  {
    step: '03',
    title: 'Sintesis Lintas File',
    detail: 'Komparasi entitas & kalkulasi',
  },
  {
    step: '04',
    title: 'Audit Keterlacakan',
    detail: 'Verifikasi sitasi sumber',
  },
];

export const UploadWorkspace: React.FC<UploadWorkspaceProps> = ({
  documents,
  onAddDocuments,
  onUpdateDocument,
  onRemoveDocument,
  onClearDocuments,
  onLoadSamplePreset,
  activePresetId,
  selectedMode,
  onSelectMode,
  customQuestion,
  onChangeQuestion,
  storageConsent,
  onToggleStorageConsent,
  onRunAnalysis,
  isAnalyzing,
  errorMessage,
  onDismissError,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsingFiles, setIsParsingFiles] = useState(false);
  const [localUploadNote, setLocalUploadNote] = useState<string | null>(null);
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);

  // Manual text entry state
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualFormat, setManualFormat] = useState<'pdf' | 'csv'>('pdf');
  const [manualContent, setManualContent] = useState('');

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setIsParsingFiles(true);
    setLocalUploadNote(null);
    onDismissError();

    const parsedDocs: UploadedDocumentPayload[] = [];
    const skippedFiles: string[] = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const lower = file.name.toLowerCase();
      const isSupported =
        lower.endsWith('.pdf') ||
        lower.endsWith('.csv') ||
        lower.endsWith('.txt') ||
        lower.endsWith('.tsv') ||
        file.type === 'application/pdf' ||
        file.type === 'text/csv' ||
        file.type === 'text/plain';

      if (!isSupported) {
        skippedFiles.push(
          `${file.name} (Format tidak didukung — gunakan PDF atau CSV)`
        );
        continue;
      }

      try {
        const parsed = await parseUploadedFile(file);
        parsedDocs.push(parsed);
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : 'Gagal membaca berkas.';
        skippedFiles.push(`${file.name} (${msg})`);
      }
    }

    if (parsedDocs.length > 0) {
      onAddDocuments(parsedDocs);
      const scannedDocs = parsedDocs.filter(
        (d) => d.extractionStatus === 'ocr_fallback'
      );
      const emptyDocs = parsedDocs.filter(
        (d) => d.extractionStatus === 'failed_scanned_or_empty'
      );
      if (scannedDocs.length > 0 && emptyDocs.length === 0) {
        setLocalUploadNote(
          `Info: "${scannedDocs.map((d) => d.name).join(', ')}" terdeteksi sebagai PDF hasil scan/gambar dan akan diproses melalui pembacaan visual multimodal.`
        );
      } else if (emptyDocs.length > 0) {
        setLocalUploadNote(
          `Perhatian: "${emptyDocs.map((d) => d.name).join(', ')}" tidak memiliki teks yang dapat diekstrak.`
        );
      }
    }

    if (skippedFiles.length > 0) {
      setLocalUploadNote(
        `Beberapa berkas dilewati: ${skippedFiles.join('; ')}`
      );
    }

    setIsParsingFiles(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    await handleFilesSelected(e.dataTransfer.files);
  };

  const handleAddManualDocument = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualName.trim() || !manualContent.trim()) return;

    const cleanName = manualName.trim().endsWith(`.${manualFormat}`)
      ? manualName.trim()
      : `${manualName.trim()}.${manualFormat}`;

    const trimmedText = manualContent.trim();
    const newDoc: UploadedDocumentPayload = {
      id: `manual-${Date.now()}`,
      name: cleanName,
      format: manualFormat,
      sizeBytes: new Blob([trimmedText]).size,
      pageOrRowCount:
        manualFormat === 'csv'
          ? Math.max(1, trimmedText.split(/\r?\n/).length - 1)
          : Math.max(1, (trimmedText.match(/\[Halaman\s+\d+\]/gi) || []).length),
      textContent: trimmedText,
      extractedCharCount: trimmedText.length,
      extractionStatus: 'success',
    };

    onAddDocuments([newDoc]);
    setManualName('');
    setManualContent('');
    setShowManualModal(false);
  };

  const activeModeConfig =
    MODE_CARDS.find((m) => m.id === selectedMode) || MODE_CARDS[0];

  const getDocUnitCount = (doc: UploadedDocumentPayload) =>
    doc.pageOrRowCount ||
    (doc.format === 'csv' ? doc.csvRows?.length : doc.pageCount) ||
    doc.sections?.length ||
    1;

  // Computed visual metrics for corpus visualization
  const totalChars = documents.reduce(
    (sum, doc) => sum + (doc.extractedCharCount ?? doc.textContent.length),
    0
  );
  const totalPagesOrRows = documents.reduce(
    (sum, doc) => sum + getDocUnitCount(doc),
    0
  );
  const pdfCount = documents.filter((d) => d.format === 'pdf').length;
  const csvCount = documents.filter((d) => d.format === 'csv').length;
  const maxDocChars = Math.max(
    1,
    ...documents.map((d) => d.extractedCharCount ?? d.textContent.length)
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 space-y-6">
      {/* Modern Hero Banner with Live Pipeline & Corpus Metrics (No Contoh Skenario here) */}
      <section className="relative overflow-hidden rounded-2xl border border-teal-800/40 bg-gradient-to-br from-[#081523]/95 via-[#071320]/95 to-[#050e18]/95 p-6 shadow-xl backdrop-blur-md">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-md border border-teal-500/30 bg-teal-950/50 px-2.5 py-1 text-[11px] font-semibold text-teal-300">
              <Sparkles className="h-3.5 w-3.5 text-teal-400" />
              <span>Mesin Inteligensi Dokumen Lintas Format</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Analisis Lintas Dokumen PDF & CSV
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              Ekstraksi struktur tabel, pencocokan entitas lintas berkas, audit kesenjangan bukti, dan kalkulasi numerik dengan sitasi sumber yang dapat diverifikasi.
            </p>
          </div>

          {/* Live Corpus Telemetry Counter Box */}
          <div className="grid grid-cols-3 gap-2.5 sm:gap-3 shrink-0">
            <div className="rounded-xl border border-slate-800/90 bg-[#050d16]/90 px-3.5 py-2.5 text-right">
              <p className="text-[11px] text-slate-400">Berkas Aktif</p>
              <p className="mt-0.5 font-mono text-xl font-bold text-white tabular-nums">
                {documents.length}
              </p>
              <p className="text-[10px] font-mono text-teal-400 tabular-nums">
                {pdfCount} PDF · {csvCount} CSV
              </p>
            </div>
            <div className="rounded-xl border border-slate-800/90 bg-[#050d16]/90 px-3.5 py-2.5 text-right">
              <p className="text-[11px] text-slate-400">Halaman / Baris</p>
              <p className="mt-0.5 font-mono text-xl font-bold text-sky-300 tabular-nums">
                {totalPagesOrRows}
              </p>
              <p className="text-[10px] font-mono text-slate-400">
                Unit Referensi
              </p>
            </div>
            <div className="rounded-xl border border-slate-800/90 bg-[#050d16]/90 px-3.5 py-2.5 text-right">
              <p className="text-[11px] text-slate-400">Volume Teks</p>
              <p className="mt-0.5 font-mono text-xl font-bold text-emerald-300 tabular-nums">
                {totalChars > 0
                  ? `${(totalChars / 1000).toFixed(1)}k`
                  : '0'}
              </p>
              <p className="text-[10px] font-mono text-slate-400">
                Karakter Terbaca
              </p>
            </div>
          </div>
        </div>

        {/* Visual 4-Stage Pipeline Indicator */}
        <div className="mt-5 pt-4 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {PIPELINE_STEPS.map((item, index) => {
            const isStageReady =
              index === 0
                ? documents.length > 0
                : index === 1
                ? totalChars > 0
                : index === 2
                ? Boolean(selectedMode)
                : documents.length > 0;
            return (
              <div
                key={item.step}
                className={`rounded-xl border px-3 py-2 transition-colors ${
                  isStageReady
                    ? 'border-teal-800/60 bg-teal-950/25'
                    : 'border-slate-800/80 bg-[#050d16]/60'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] font-bold text-teal-400">
                    TAHAP {item.step}
                  </span>
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      isStageReady ? 'bg-teal-400' : 'bg-slate-600'
                    }`}
                  />
                </div>
                <p className="mt-0.5 text-xs font-semibold text-white">
                  {item.title}
                </p>
                <p className="text-[11px] text-slate-400 truncate">
                  {item.detail}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Error / Warning Banner */}
      {(errorMessage || localUploadNote) && (
        <div
          role="alert"
          className="rounded-xl border border-amber-500/40 bg-amber-950/40 backdrop-blur-sm p-4 text-xs text-amber-200 flex items-start justify-between gap-3"
        >
          <div className="space-y-1">
            {errorMessage && <p className="font-semibold">{errorMessage}</p>}
            {localUploadNote && <p>{localUploadNote}</p>}
          </div>
          <button
            type="button"
            onClick={() => {
              onDismissError();
              setLocalUploadNote(null);
            }}
            className="shrink-0 rounded-lg border border-amber-500/30 px-2.5 py-1 text-xs font-medium text-amber-200 hover:bg-amber-900/50 cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Main 2-Column Workspace Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* LEFT COLUMN (7 cols): 1. Dokumen Sumber -> Contoh Skenario -> Visualisasi Korpus */}
        <div className="lg:col-span-7 space-y-5">
          {/* CARD 1: 1. Dokumen Sumber */}
          <div className="rounded-2xl border border-slate-800/90 bg-[#081523]/95 backdrop-blur-md p-5 space-y-4 shadow-lg">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileCheck2 className="h-4 w-4 text-teal-400 shrink-0" />
                <h2 className="text-base font-bold text-white">
                  1. Dokumen Sumber
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowManualModal(!showManualModal)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-teal-500/50 hover:text-teal-300 transition-colors cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Input Teks</span>
                </button>
                {documents.length > 0 && (
                  <button
                    type="button"
                    onClick={onClearDocuments}
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-800/50 bg-rose-950/30 px-2.5 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-900/40 transition-colors cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Hapus Semua</span>
                  </button>
                )}
              </div>
            </div>

            {/* Drag and Drop Area */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-all cursor-pointer ${
                isDragging
                  ? 'border-teal-400 bg-teal-950/30'
                  : 'border-slate-700/80 bg-[#050d16]/90 hover:border-teal-500/50 hover:bg-[#07121e]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.csv,.txt,.tsv,application/pdf,text/csv,text/plain"
                onChange={(e) => handleFilesSelected(e.target.files)}
                className="hidden"
                aria-label="Pilih berkas PDF atau CSV"
              />
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-teal-500/30 bg-teal-500/10 text-teal-300">
                <Upload className="h-5 w-5" />
              </div>
              <p className="mt-2.5 text-sm font-semibold text-white">
                {isParsingFiles
                  ? 'Mengekstrak teks dan struktur dokumen...'
                  : 'Klik atau seret berkas PDF & CSV ke sini'}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                Mendukung multi-dokumen untuk sintesis, komparasi, audit kesenjangan, dan analisis tren
              </p>
            </div>

            {/* Manual Text Modal / Drawer */}
            {showManualModal && (
              <form
                onSubmit={handleAddManualDocument}
                className="rounded-xl border border-teal-500/40 bg-[#050e18] p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-teal-300">
                    Tambah Teks Dokumen Manual
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowManualModal(false)}
                    className="text-xs text-slate-400 hover:text-white cursor-pointer"
                  >
                    Batal
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <input
                      type="text"
                      required
                      value={manualName}
                      onChange={(e) => setManualName(e.target.value)}
                      placeholder="Nama dokumen (mis. Laporan_Audit_2025)"
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white focus:border-teal-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <select
                      value={manualFormat}
                      onChange={(e) =>
                        setManualFormat(e.target.value as 'pdf' | 'csv')
                      }
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white focus:border-teal-400 focus:outline-none"
                    >
                      <option value="pdf">Teks / PDF</option>
                      <option value="csv">Tabel CSV</option>
                    </select>
                  </div>
                </div>

                <textarea
                  rows={4}
                  required
                  value={manualContent}
                  onChange={(e) => setManualContent(e.target.value)}
                  placeholder="Tempelkan isi dokumen atau tabel CSV di sini..."
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 font-mono text-xs text-slate-200 focus:border-teal-400 focus:outline-none"
                />

                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="rounded-lg bg-teal-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-teal-400 transition-colors cursor-pointer"
                  >
                    Tambahkan ke Daftar
                  </button>
                </div>
              </form>
            )}

            {/* Uploaded Document List */}
            {documents.length === 0 ? (
              <div className="rounded-xl border border-slate-800/80 bg-[#050d16]/70 p-4 text-center">
                <p className="text-xs text-slate-400">
                  Belum ada dokumen sumber yang dimuat. Unggah berkas PDF/CSV Anda di atas atau pilih salah satu <span className="font-semibold text-teal-300">Contoh Skenario</span> di bawah.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {documents.map((doc) => {
                  const isExpanded = expandedDocId === doc.id;
                  const isEditing = editingDocId === doc.id;
                  const charCount =
                    doc.extractedCharCount ?? doc.textContent.trim().length;
                  const unitCount = getDocUnitCount(doc);
                  const isOcrMultimodal =
                    doc.extractionStatus === 'ocr_completed' ||
                    (charCount === 0 && Boolean(doc.base64Data));
                  const isFailedOrEmpty =
                    !isOcrMultimodal &&
                    (doc.extractionStatus === 'failed_scanned_or_empty' ||
                      doc.extractionStatus === 'empty_or_unreadable' ||
                      charCount === 0);

                  return (
                    <div
                      key={doc.id}
                      className={`rounded-xl border transition-colors ${
                        isFailedOrEmpty
                          ? 'border-amber-500/50 bg-amber-950/15'
                          : isOcrMultimodal
                          ? 'border-sky-500/40 bg-sky-950/15'
                          : 'border-slate-800 bg-[#050e18]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3 p-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                              doc.format === 'pdf'
                                ? 'bg-teal-500/15 text-teal-300'
                                : 'bg-sky-500/15 text-sky-300'
                            }`}
                          >
                            {doc.format === 'pdf' ? (
                              <FileText className="h-4 w-4" />
                            ) : (
                              <FileSpreadsheet className="h-4 w-4" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="truncate text-xs font-bold text-white">
                                {doc.name}
                              </p>
                              {isFailedOrEmpty ? (
                                <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/20 text-amber-300">
                                  Kosong
                                </span>
                              ) : isOcrMultimodal ? (
                                <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-sky-500/20 text-sky-300">
                                  Mode OCR
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-500/15 text-emerald-300">
                                  <CheckCircle2 className="h-3 w-3" /> Siap
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-400 font-mono tabular-nums">
                              {doc.format.toUpperCase()} · {unitCount}{' '}
                              {doc.format === 'pdf'
                                ? 'Halaman/Bagian'
                                : 'Baris'}{' '}
                              ·{' '}
                              {isOcrMultimodal && charCount === 0
                                ? 'PDF Scan'
                                : `${charCount.toLocaleString('id-ID')} karakter`}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingDocId(isEditing ? null : doc.id);
                              setExpandedDocId(null);
                            }}
                            className="rounded-lg px-2 py-1 text-xs font-medium text-teal-300 hover:bg-slate-800 transition-colors cursor-pointer"
                            title="Isi atau perbaiki teks dokumen secara manual"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedDocId(isExpanded ? null : doc.id);
                              setEditingDocId(null);
                            }}
                            className="rounded-lg px-2 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
                          >
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => onRemoveDocument(doc.id)}
                            aria-label={`Hapus ${doc.name}`}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-950/50 hover:text-rose-300 transition-colors cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      {isEditing && (
                        <div className="border-t border-slate-800 bg-[#040a12] p-3 space-y-2">
                          <label className="block text-[11px] font-semibold text-teal-300">
                            Edit Teks {doc.name}:
                          </label>
                          <textarea
                            rows={5}
                            value={doc.textContent}
                            onChange={(e) => {
                              const val = e.target.value;
                              onUpdateDocument(doc.id, {
                                textContent: val,
                                extractedCharCount: val.trim().length,
                                extractionStatus:
                                  val.trim().length > 0
                                    ? 'ready'
                                    : 'failed_scanned_or_empty',
                                extractionWarning: undefined,
                              });
                            }}
                            placeholder="Tempelkan isi teks dokumen di sini..."
                            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 font-mono text-xs text-slate-200 focus:border-teal-400 focus:outline-none"
                          />
                        </div>
                      )}

                      {isExpanded && !isEditing && (
                        <div className="border-t border-slate-800 bg-[#040a12] p-3">
                          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] text-slate-300 leading-relaxed">
                            {doc.textContent || '(Teks kosong)'}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* CARD 2: Contoh Skenario (Placed directly below 1. Dokumen Sumber as requested) */}
          <div className="rounded-2xl border border-slate-800/90 bg-[#081523]/95 backdrop-blur-md p-5 space-y-3.5 shadow-lg">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <div>
                <h3 className="text-sm font-bold text-white">
                  Contoh Skenario Multi-Dokumen
                </h3>
                <p className="text-xs text-slate-400">
                  Muat korpus contoh lintas bidang ke dalam Dokumen Sumber di atas untuk menguji kemampuan sistem.
                </p>
              </div>
              {activePresetId && (
                <span className="self-start sm:self-auto rounded-md border border-teal-500/40 bg-teal-950/60 px-2 py-0.5 text-[11px] font-semibold text-teal-300">
                  Skenario Dimuat
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {SCENARIO_PRESETS.map((preset) => {
                const Icon = preset.icon;
                const isSelectedPreset = activePresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => onLoadSamplePreset(preset.id)}
                    className={`group flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                      isSelectedPreset
                        ? 'border-teal-400 bg-teal-950/35 shadow-md'
                        : 'border-slate-800 bg-[#050d16]/90 hover:border-teal-500/50 hover:bg-[#071320]'
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div
                          className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                            isSelectedPreset
                              ? 'bg-teal-500 text-slate-950'
                              : 'bg-slate-800/90 text-teal-300 group-hover:bg-teal-500/20'
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <span className="rounded border border-slate-700/80 bg-slate-900/90 px-2 py-0.5 font-mono text-[10px] font-semibold text-teal-300">
                          {preset.fileSummary}
                        </span>
                      </div>

                      <div>
                        <p className="text-xs font-bold text-white group-hover:text-teal-200 transition-colors">
                          {preset.title}
                        </p>
                        <p className="text-[10px] font-medium text-teal-400/90">
                          {preset.domain}
                        </p>
                      </div>

                      <p className="text-[11px] text-slate-400 leading-snug line-clamp-3">
                        {preset.description}
                      </p>
                    </div>

                    <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-semibold text-teal-300">
                      <span>
                        {isSelectedPreset ? 'Sedang Aktif' : 'Muat Dokumen'}
                      </span>
                      <span className="group-hover:translate-x-0.5 transition-transform">
                        →
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* CARD 3: Interactive Corpus & Structure Visualization (Makes workspace rich and informative) */}
          <div className="rounded-2xl border border-slate-800/90 bg-[#081523]/95 backdrop-blur-md p-5 space-y-4 shadow-lg">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-teal-400 shrink-0" />
                <h3 className="text-sm font-bold text-white">
                  {documents.length > 0
                    ? 'Visualisasi Komposisi & Kepadatan Korpus'
                    : 'Arsitektur Pemrosesan & Keterlacakan Data'}
                </h3>
              </div>
              <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                {documents.length > 0
                  ? `${documents.length} Berkas Terindeks`
                  : 'Multi-Format PDF & CSV'}
              </span>
            </div>

            {documents.length > 0 ? (
              <div className="space-y-4">
                {/* Format Ratio Stacked Progress Bar */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-300 font-medium">
                      Distribusi Format Dokumen
                    </span>
                    <span className="font-mono text-slate-400 tabular-nums">
                      PDF ({Math.round((pdfCount / documents.length) * 100)}%) ·
                      CSV ({Math.round((csvCount / documents.length) * 100)}%)
                    </span>
                  </div>
                  <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-900 p-0.5 gap-0.5">
                    {pdfCount > 0 && (
                      <div
                        style={{
                          width: `${(pdfCount / documents.length) * 100}%`,
                        }}
                        className="h-full rounded-l-full bg-teal-400 transition-all duration-500"
                      />
                    )}
                    {csvCount > 0 && (
                      <div
                        style={{
                          width: `${(csvCount / documents.length) * 100}%`,
                        }}
                        className="h-full rounded-r-full bg-sky-400 transition-all duration-500"
                      />
                    )}
                  </div>
                </div>

                {/* Per-Document Volume & Structure Bars */}
                <div className="space-y-2.5">
                  {documents.map((doc) => {
                    const chars =
                      doc.extractedCharCount ?? doc.textContent.trim().length;
                    const widthPct = Math.max(
                      8,
                      Math.min(100, Math.round((chars / maxDocChars) * 100))
                    );
                    const numericMatches = (
                      doc.textContent.match(/\b\d+([.,]\d+)?\b/g) || []
                    ).length;

                    return (
                      <div
                        key={`viz-${doc.id}`}
                        className="rounded-xl border border-slate-800/90 bg-[#050d16]/80 p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-white truncate">
                            {doc.name}
                          </span>
                          <div className="flex items-center gap-2 shrink-0 font-mono text-[11px]">
                            <span className="text-sky-300">
                              {numericMatches} token angka
                            </span>
                            <span className="text-slate-500">·</span>
                            <span className="text-teal-300">
                              {chars.toLocaleString('id-ID')} kar
                            </span>
                          </div>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-900">
                          <div
                            style={{ width: `${widthPct}%` }}
                            className={`h-full rounded-full transition-all duration-500 ${
                              doc.format === 'pdf'
                                ? 'bg-gradient-to-r from-teal-500 to-emerald-400'
                                : 'bg-gradient-to-r from-sky-500 to-teal-400'
                            }`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* Visual diagram when no files are uploaded yet so the page never feels empty */
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl border border-slate-800/90 bg-[#050d16]/80 p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <Database className="h-4 w-4 text-teal-400" />
                    <span className="font-mono text-[10px] text-teal-400">
                      MULTI-DOKUMEN
                    </span>
                  </div>
                  <p className="text-xs font-bold text-white">
                    Penyelarasan Tabel & Teks
                  </p>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Mendeteksi header kolom CSV, paragraf kontrak PDF, serta angka mata uang dan satuan secara otomatis.
                  </p>
                  <div className="flex items-center gap-1.5 pt-1">
                    <span className="h-1.5 w-8 rounded-full bg-teal-500/70" />
                    <span className="h-1.5 w-5 rounded-full bg-sky-500/60" />
                    <span className="h-1.5 w-3 rounded-full bg-emerald-500/50" />
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800/90 bg-[#050d16]/80 p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <GitCompare className="h-4 w-4 text-sky-400" />
                    <span className="font-mono text-[10px] text-sky-400">
                      REKONSILIASI
                    </span>
                  </div>
                  <p className="text-xs font-bold text-white">
                    Deteksi Konflik & Selisih
                  </p>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Membandingkan klausul, anggaran vs realisasi, atau entitas yang muncul di beberapa dokumen berbeda.
                  </p>
                  <div className="flex items-center gap-1.5 pt-1">
                    <span className="h-1.5 w-6 rounded-full bg-sky-500/70" />
                    <span className="h-1.5 w-6 rounded-full bg-amber-500/60" />
                    <span className="h-1.5 w-4 rounded-full bg-teal-500/50" />
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800/90 bg-[#050d16]/80 p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <span className="font-mono text-[10px] text-emerald-400">
                      VERIFIKASI
                    </span>
                  </div>
                  <p className="text-xs font-bold text-white">
                    Sitasi Halaman & Baris
                  </p>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Setiap temuan dilengkapi nama dokumen, nomor halaman/baris, serta pemisahan fakta dan kesimpulan.
                  </p>
                  <div className="flex items-center gap-1.5 pt-1">
                    <span className="h-1.5 w-10 rounded-full bg-emerald-500/70" />
                    <span className="h-1.5 w-4 rounded-full bg-teal-500/50" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN (5 cols): 2. Mode Analisis & 3. Instruksi Analisis */}
        <div className="lg:col-span-5 space-y-5">
          {/* CARD 1: 2. Mode Analisis */}
          <div className="rounded-2xl border border-slate-800/90 bg-[#081523]/95 backdrop-blur-md p-5 space-y-3.5 shadow-lg">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white">
                2. Mode Analisis
              </h2>
              <span className="text-[11px] font-medium text-teal-300">
                4 Metode Tersedia
              </span>
            </div>

            <div
              role="radiogroup"
              aria-label="Pilih Mode Analisis"
              className="grid grid-cols-1 gap-2.5 sm:grid-cols-2"
            >
              {MODE_CARDS.map((mode) => {
                const Icon = mode.icon;
                const isSelected = selectedMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => onSelectMode(mode.id)}
                    className={`flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'border-teal-400 bg-teal-950/35 text-white shadow-md'
                        : 'border-slate-800 bg-[#050d16]/90 text-slate-300 hover:border-slate-700 hover:text-white'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <div
                          className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                            isSelected
                              ? 'bg-teal-500 text-slate-950'
                              : 'bg-slate-800 text-teal-400'
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        {isSelected && (
                          <span className="rounded bg-teal-500/20 px-1.5 py-0.5 text-[10px] font-bold text-teal-300">
                            Aktif
                          </span>
                        )}
                      </div>
                      <p className="mt-2.5 text-xs font-bold text-white">
                        {mode.title}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-400 leading-snug">
                        {mode.shortDesc}
                      </p>
                    </div>

                    <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex flex-wrap gap-1">
                      {mode.outputs.map((out) => (
                        <span
                          key={out}
                          className="rounded bg-slate-900/90 px-1.5 py-0.5 text-[9px] font-medium text-slate-300"
                        >
                          {out}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* CARD 2: 3. Instruksi / Pertanyaan Analisis (No sample question suggestions!) */}
          <div className="rounded-2xl border border-slate-800/90 bg-[#081523]/95 backdrop-blur-md p-5 space-y-4 shadow-lg">
            <div>
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="custom-question-input"
                  className="block text-base font-bold text-white"
                >
                  3. Instruksi / Pertanyaan Analisis (Opsional)
                </label>
                {customQuestion.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={() => onChangeQuestion('')}
                    className="text-[11px] font-medium text-slate-400 hover:text-teal-300 cursor-pointer"
                  >
                    Bersihkan
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                Tulis instruksi atau pertanyaan spesifik sesuai tujuan Anda sendiri, atau kosongkan untuk menjalankan analisis menyeluruh sesuai mode <span className="font-semibold text-teal-300">{activeModeConfig.title}</span>.
              </p>

              <textarea
                id="custom-question-input"
                rows={4}
                value={customQuestion}
                onChange={(e) => onChangeQuestion(e.target.value)}
                placeholder="Ketik instruksi atau pertanyaan analisis Anda di sini..."
                className="mt-2.5 w-full rounded-xl border border-slate-700 bg-[#050d16] p-3 text-xs text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none leading-relaxed"
              />
            </div>

            {/* Active Mode Output Preview Strip */}
            <div className="rounded-xl border border-slate-800/90 bg-[#050d16]/80 p-3 space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-slate-300">
                  Komponen Laporan ({activeModeConfig.title})
                </span>
                <span className="font-mono text-teal-400">Otomatis</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {activeModeConfig.outputs.map((item) => (
                  <span
                    key={item}
                    className="inline-flex items-center gap-1 rounded-md border border-teal-800/50 bg-teal-950/30 px-2 py-0.5 text-[11px] font-medium text-teal-200"
                  >
                    <CheckCircle2 className="h-3 w-3 text-teal-400" />
                    {item}
                  </span>
                ))}
              </div>
            </div>

            {/* Consent & Primary Action Button */}
            <div className="space-y-3 pt-1">
              <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={storageConsent}
                  onChange={(e) => onToggleStorageConsent(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-teal-500 focus:ring-teal-500"
                />
                <span>Simpan laporan ke riwayat browser lokal</span>
              </label>

              <button
                type="button"
                disabled={isAnalyzing}
                onClick={onRunAnalysis}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-400 px-5 py-3.5 text-sm font-bold text-slate-950 shadow-lg shadow-teal-950/50 hover:from-teal-400 hover:to-emerald-300 disabled:opacity-50 transition-all cursor-pointer"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>
                  {isAnalyzing
                    ? 'Memproses Dokumen...'
                    : `Jalankan ${activeModeConfig.title}`}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
