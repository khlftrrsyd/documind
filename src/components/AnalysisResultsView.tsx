import React, { useMemo, useState } from 'react';
import {
  FileText,
  Download,
  Printer,
  BookmarkCheck,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Calculator,
  TrendingUp,
  HelpCircle,
  Search,
  Table,
  GitMerge,
  GitCompare,
  ChevronDown,
  ChevronUp,
  BarChart3,
  Sparkles,
  FileSpreadsheet,
  Eye,
} from 'lucide-react';
import { AnalysisReport } from '../types/analysis';
import {
  cleanDisplayText,
  formatReportToMarkdown,
  formatSummaryTableToCsv,
  humanizeDocTitle,
} from '../utils/analysisEngine';
import { buildVisualAnalyticsData } from '../utils/visualAnalytics';

interface AnalysisResultsViewProps {
  report: AnalysisReport | null;
  onBackToUpload: () => void;
  onSaveToHistory: (report: AnalysisReport) => void;
  isSavedInHistory: boolean;
  onLoadSampleAndAnalyze: () => void;
  onLoadLegalSampleAndAnalyze?: () => void;
}

type ViewPresentationMode = 'visual' | 'detailed';

type SectionFilter =
  | 'all'
  | 'matching'
  | 'comparison_matrix'
  | 'facts'
  | 'conflicts'
  | 'calculations'
  | 'gaps';

const MODE_LABELS: Record<string, string> = {
  synthesis: 'Analisis & Sintesis',
  comparison: 'Perbandingan Data',
  gap_analysis: 'Kesenjangan Data',
  estimation: 'Estimasi & Tren',
};

export const AnalysisResultsView: React.FC<AnalysisResultsViewProps> = ({
  report,
  onBackToUpload,
  onSaveToHistory,
  isSavedInHistory,
  onLoadSampleAndAnalyze,
  onLoadLegalSampleAndAnalyze,
}) => {
  const [presentationMode, setPresentationMode] =
    useState<ViewPresentationMode>('visual');
  const [sectionFilter, setSectionFilter] = useState<SectionFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDocFilter, setSelectedDocFilter] = useState<string>('ALL');
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);
  const [matchViewFilter, setMatchViewFilter] = useState<'all' | 'qualified'>(
    'all'
  );

  // Per-card "Lihat Selengkapnya" toggles inside the Visual Dashboard
  const [expandedVisualBarIds, setExpandedVisualBarIds] = useState<
    Record<string, boolean>
  >({});
  const [showAllVisualBars, setShowAllVisualBars] = useState(false);
  const [expandedVisualGapIds, setExpandedVisualGapIds] = useState<
    Record<string, boolean>
  >({});
  const [showFullNarrativeDrawer, setShowFullNarrativeDrawer] = useState(false);
  const [showAllMatrixRows, setShowAllMatrixRows] = useState(false);

  const visualData = useMemo(
    () => (report ? buildVisualAnalyticsData(report) : null),
    [report]
  );

  if (!report || !visualData) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 text-center">
        <div className="rounded-2xl border border-slate-800 bg-[#081523] p-8 sm:p-10">
          <FileText className="mx-auto h-10 w-10 text-teal-400" />
          <h2 className="mt-4 text-xl font-bold text-white">
            Belum Ada Hasil Analisis
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-slate-300">
            Unggah dokumen PDF atau CSV untuk melihat visualisasi hasil analisis
            lintas dokumen.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onBackToUpload}
              className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-xs font-semibold text-slate-200 hover:border-teal-500/50 cursor-pointer"
            >
              Unggah Dokumen
            </button>
            <button
              type="button"
              onClick={onLoadSampleAndAnalyze}
              className="rounded-lg bg-teal-500 px-5 py-2.5 text-xs font-bold text-slate-950 hover:bg-teal-400 cursor-pointer"
            >
              Contoh Keuangan & Operasional (3 File)
            </button>
            {onLoadLegalSampleAndAnalyze && (
              <button
                type="button"
                onClick={onLoadLegalSampleAndAnalyze}
                className="rounded-lg border border-teal-500/50 bg-teal-950/60 px-4 py-2.5 text-xs font-semibold text-teal-200 hover:bg-teal-900/70 cursor-pointer"
              >
                Contoh Kontrak Hukum (2 PDF)
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const triggerDownload = (
    content: string,
    filename: string,
    mimeType: string,
    label: string
  ) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setExportFeedback(`Berhasil mengekspor ${label} (${filename})`);
    setTimeout(() => setExportFeedback(null), 3500);
  };

  const handleExportMarkdown = () => {
    const md = formatReportToMarkdown(report);
    triggerDownload(
      md,
      `Laporan_DocuMind_${report.id}.md`,
      'text/markdown;charset=utf-8;',
      'Laporan Markdown'
    );
  };

  const handleExportCsv = () => {
    const csv = formatSummaryTableToCsv(report);
    triggerDownload(
      csv,
      `Tabel_Ringkasan_DocuMind_${report.id}.csv`,
      'text/csv;charset=utf-8;',
      'Tabel CSV'
    );
  };

  const handleExportJson = () => {
    const json = JSON.stringify(report, null, 2);
    triggerDownload(
      json,
      `Data_Analisis_DocuMind_${report.id}.json`,
      'application/json;charset=utf-8;',
      'Data JSON'
    );
  };

  const q = searchQuery.trim().toLowerCase();
  const matchesDoc = (docName: string) =>
    selectedDocFilter === 'ALL' ||
    docName.toLowerCase().includes(selectedDocFilter.toLowerCase());

  const filteredFacts = report.explicitFacts.filter(
    (f) =>
      matchesDoc(f.citation.documentName) &&
      (!q ||
        f.statement.toLowerCase().includes(q) ||
        f.category.toLowerCase().includes(q) ||
        f.value.toLowerCase().includes(q))
  );

  const filteredConflicts = report.conflicts.filter(
    (c) =>
      (matchesDoc(c.documentA.documentName) ||
        matchesDoc(c.documentB.documentName)) &&
      (!q ||
        c.topic.toLowerCase().includes(q) ||
        c.discrepancyExplanation.toLowerCase().includes(q))
  );

  const filteredCalculations = report.calculations.filter(
    (c) =>
      (selectedDocFilter === 'ALL' ||
        c.citations.some((cit) => matchesDoc(cit.documentName))) &&
      (!q ||
        c.metricName.toLowerCase().includes(q) ||
        c.resultValue.toLowerCase().includes(q))
  );

  const filteredUncertainties = report.uncertainties.filter(
    (u) =>
      (selectedDocFilter === 'ALL' ||
        u.missingFromDocuments.some((m) => matchesDoc(m))) &&
      (!q ||
        u.topic.toLowerCase().includes(q) ||
        u.impactOnConclusion.toLowerCase().includes(q))
  );

  const crossMatch = report.crossDocumentMatch;
  const hasCrossMatch = Boolean(crossMatch && crossMatch.isApplicable);
  const nearMatchCount = hasCrossMatch
    ? Math.max(
        0,
        crossMatch!.allEvaluatedRows.length -
          crossMatch!.qualifiedMatchedRows.length
      )
    : 0;

  const displayedMatchedRows = hasCrossMatch
    ? (matchViewFilter === 'qualified'
        ? crossMatch!.qualifiedMatchedRows
        : crossMatch!.allEvaluatedRows
      ).filter(
        (r) =>
          !q ||
          r.participantName.toLowerCase().includes(q) ||
          r.majorCompatibility.toLowerCase().includes(q)
      )
    : [];

  const comparisonMatrix = report.comparisonMatrix;
  const hasComparisonMatrix = Boolean(
    comparisonMatrix &&
      comparisonMatrix.isApplicable &&
      comparisonMatrix.rows.length > 0 &&
      !hasCrossMatch
  );

  const filteredMatrixRows = hasComparisonMatrix
    ? [...comparisonMatrix!.rows]
        .filter((row) => {
          const matchesSearch =
            !q ||
            row.entityName.toLowerCase().includes(q) ||
            row.category.toLowerCase().includes(q) ||
            row.differenceOrRelation.toLowerCase().includes(q);
          const matchesDocSelection =
            selectedDocFilter === 'ALL' ||
            (row.docValues[selectedDocFilter] &&
              row.docValues[selectedDocFilter] !== '-');
          return matchesSearch && matchesDocSelection;
        })
        .sort((a, b) => {
          const rank = (status: string) =>
            status === 'Konflik Material'
              ? 0
              : status === 'Berbeda / Berubah'
              ? 1
              : 2;
          return rank(a.status) - rank(b.status);
        })
    : [];

  // Radial SVG Gauge math
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset =
    circumference - (visualData.alignmentPct / 100) * circumference;

  // SVG Trend Line Chart coordinates (Dynamic range so slope is visually distinct)
  const trendPoints = visualData.trendPoints;
  const maxTrendVal = Math.max(1, ...trendPoints.map((p) => p.value));
  const minTrendVal = Math.min(...trendPoints.map((p) => p.value));
  const lowerBound =
    minTrendVal > 0 && minTrendVal < maxTrendVal
      ? minTrendVal * 0.85
      : 0;
  const upperBound = maxTrendVal * 1.06;
  const chartWidth = 520;
  const chartHeight = 175;
  const padX = 52;
  const padY = 30;

  const svgPoints = trendPoints.map((pt, i) => {
    const x =
      trendPoints.length === 1
        ? chartWidth / 2
        : padX +
          (i / (trendPoints.length - 1)) * (chartWidth - padX * 2);
    const norm =
      (pt.value - lowerBound) / Math.max(1, upperBound - lowerBound);
    const y =
      chartHeight -
      padY -
      Math.max(0.12, Math.min(0.88, norm)) * (chartHeight - padY * 2);
    return { ...pt, x, y };
  });

  const polylinePoints = svgPoints.map((p) => `${p.x},${p.y}`).join(' ');
  const areaPath =
    svgPoints.length >= 2
      ? `M ${svgPoints[0].x},${chartHeight - padY} L ${svgPoints
          .map((p) => `${p.x},${p.y}`)
          .join(' L ')} L ${svgPoints[svgPoints.length - 1].x},${
          chartHeight - padY
        } Z`
      : '';

  const visibleBarComparisons = showAllVisualBars
    ? visualData.barComparisons
    : visualData.barComparisons.slice(0, 4);

  return (
    <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6 space-y-6">
      {/* Top Action & Mode Switcher Bar */}
      <div className="no-print flex flex-col lg:flex-row lg:items-center justify-between gap-4 rounded-2xl border border-teal-800/50 bg-[#081523]/95 backdrop-blur-md p-4 sm:p-5">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onBackToUpload}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-300 hover:text-teal-200 cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
            <span>Kembali ke Unggah</span>
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-bold text-white">
              Visualisasi {MODE_LABELS[report.analysisMode] || 'Analisis Dokumen'}
            </h1>
            {report.detectedDomain && (
              <span className="rounded-md border border-teal-700/60 bg-teal-950/60 px-2.5 py-0.5 text-xs font-semibold text-teal-300">
                {cleanDisplayText(report.detectedDomain)}
              </span>
            )}
          </div>
        </div>

        {/* Visual Mode vs Detailed Table Mode Switcher + Export */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div
            role="group"
            aria-label="Pilih Tampilan Visual atau Rincian Tabel"
            className="inline-flex items-center rounded-xl border border-teal-700/60 bg-[#050e18] p-1"
          >
            <button
              type="button"
              onClick={() => setPresentationMode('visual')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                presentationMode === 'visual'
                  ? 'bg-teal-500 text-slate-950 shadow-md shadow-teal-500/20'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              <span>Grafik Sekali Lihat</span>
            </button>
            <button
              type="button"
              onClick={() => setPresentationMode('detailed')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                presentationMode === 'detailed'
                  ? 'bg-teal-500 text-slate-950 shadow-md shadow-teal-500/20'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Table className="h-3.5 w-3.5" />
              <span>Rincian Tabel & Teks</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => onSaveToHistory(report)}
            disabled={isSavedInHistory}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
              isSavedInHistory
                ? 'border-emerald-700/50 bg-emerald-950/40 text-emerald-300 cursor-default'
                : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-teal-500/50'
            }`}
          >
            <BookmarkCheck className="h-4 w-4 text-teal-400" />
            {isSavedInHistory ? 'Tersimpan' : 'Simpan'}
          </button>

          <button
            type="button"
            onClick={handleExportMarkdown}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs font-semibold text-slate-200 hover:border-teal-500/50 cursor-pointer"
            title="Unduh Laporan Markdown"
          >
            <Download className="h-3.5 w-3.5 text-teal-400" />
            <span>MD</span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs font-semibold text-slate-200 hover:border-teal-500/50 cursor-pointer"
            title="Unduh Tabel CSV"
          >
            <Table className="h-3.5 w-3.5 text-sky-400" />
            <span>CSV</span>
          </button>

          <button
            type="button"
            onClick={handleExportJson}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs font-semibold text-slate-200 hover:border-teal-500/50 cursor-pointer"
            title="Unduh Data JSON"
          >
            <Download className="h-3.5 w-3.5 text-teal-300" />
            <span>JSON</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-500 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-teal-400 cursor-pointer"
          >
            <Printer className="h-3.5 w-3.5" />
            <span>Cetak</span>
          </button>
        </div>
      </div>

      {exportFeedback && (
        <div
          role="status"
          className="no-print rounded-xl border border-teal-500/40 bg-teal-950/60 px-4 py-2.5 text-xs font-medium text-teal-200"
        >
          {exportFeedback}
        </div>
      )}

      {/* =====================================================================
          BAGIAN UTAMA 1: PETA VISUAL ALIRAN DOKUMEN & SKOR KESELARASAN (SEKALI LIHAT)
          ===================================================================== */}
      <section
        aria-label="Visualisasi Aliran Dokumen dan Skor Keselarasan"
        className="rounded-2xl border border-teal-700/50 bg-[#081523]/95 backdrop-blur-md p-5 sm:p-6 shadow-xl space-y-5"
      >
        {/* Top Status Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/90 pb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-bold border ${
                visualData.verdictColor === 'emerald'
                  ? 'border-emerald-500/50 bg-emerald-950/80 text-emerald-300'
                  : visualData.verdictColor === 'rose'
                  ? 'border-amber-500/50 bg-amber-950/80 text-amber-300'
                  : 'border-amber-500/50 bg-amber-950/80 text-amber-300'
              }`}
            >
              {visualData.conflictCount > 0 ? (
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              )}
              {visualData.verdictBadge}
            </span>
            <p className="text-sm font-semibold text-slate-100">
              {visualData.oneGlanceHeadline}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowFullNarrativeDrawer((prev) => !prev)}
            className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-teal-500/40 bg-teal-950/50 px-3 py-1.5 text-xs font-semibold text-teal-200 hover:bg-teal-900/60 transition-colors shrink-0 cursor-pointer"
          >
            <Eye className="h-3.5 w-3.5 text-teal-300" />
            <span>
              {showFullNarrativeDrawer
                ? 'Sembunyikan Teks Ringkasan'
                : 'Lihat Selengkapnya'}
            </span>
            {showFullNarrativeDrawer ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        {/* Visual Infographic Grid: Left = Animated Cross-Document Flow Map, Right = Radial Gauge + Stat Blocks */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-center">
          {/* LEFT (7 Cols): Animated Cross-Document Flow Diagram */}
          <div className="lg:col-span-7 rounded-xl border border-slate-800/90 bg-[#050e18] p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-teal-300">
                Peta Hubungan Antar Dokumen
              </span>
              <span className="text-[11px] text-slate-400 font-mono">
                {visualData.documentNodes.length} Dokumen Terhubung
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-11 gap-3 items-center">
              {/* Source Document Nodes */}
              <div className="sm:col-span-5 space-y-2.5">
                {visualData.documentNodes.map((node) => {
                  const isConflict = node.status === 'conflict';
                  const isUnreadable = node.status === 'unreadable';
                  return (
                    <div
                      key={node.id}
                      className={`relative flex items-center justify-between gap-2.5 rounded-xl border p-3 transition-all ${
                        isUnreadable
                          ? 'border-rose-700/50 bg-rose-950/20'
                          : isConflict
                          ? 'border-amber-600/50 bg-amber-950/15'
                          : 'border-teal-800/60 bg-[#081726]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-bold ${
                            node.format === 'CSV'
                              ? 'border-sky-500/40 bg-sky-950/70 text-sky-300'
                              : 'border-teal-500/40 bg-teal-950/70 text-teal-300'
                          }`}
                        >
                          {node.format === 'CSV' ? (
                            <FileSpreadsheet className="h-4 w-4" />
                          ) : (
                            <FileText className="h-4 w-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-white truncate">
                            {node.shortTitle}
                          </p>
                          <p className="text-[11px] text-slate-400 font-mono">
                            {node.format} · {node.pageOrRowLabel}
                          </p>
                        </div>
                      </div>

                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          isUnreadable
                            ? 'bg-rose-950 text-rose-300 border border-rose-700/50'
                            : isConflict
                            ? 'bg-amber-950 text-amber-300 border border-amber-700/50'
                            : 'bg-emerald-950 text-emerald-300 border border-emerald-700/50'
                        }`}
                      >
                        {isUnreadable
                          ? 'Kosong'
                          : isConflict
                          ? `${node.conflictCount} Beda`
                          : 'Selaras'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Animated SVG Flow Connector Lines */}
              <div className="hidden sm:flex sm:col-span-2 items-center justify-center">
                <svg
                  viewBox="0 0 80 120"
                  className="w-full h-28 overflow-visible"
                  aria-hidden="true"
                >
                  <path
                    d="M 4 20 C 38 20, 42 60, 76 60"
                    fill="none"
                    stroke="#14b8a6"
                    strokeWidth="2"
                    className="animate-dash-flow"
                  />
                  <path
                    d="M 4 60 L 76 60"
                    fill="none"
                    stroke={
                      visualData.conflictCount > 0 ? '#f59e0b' : '#10b981'
                    }
                    strokeWidth="2.5"
                    className="animate-dash-flow"
                  />
                  <path
                    d="M 4 100 C 38 100, 42 60, 76 60"
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth="2"
                    className="animate-dash-flow"
                  />
                  <circle
                    cx="76"
                    cy="60"
                    r="4"
                    fill={
                      visualData.conflictCount > 0 ? '#f59e0b' : '#10b981'
                    }
                    className="animate-pulse-soft"
                  />
                </svg>
              </div>

              {/* Central Synthesis Hub Node */}
              <div className="sm:col-span-4">
                <div
                  className={`rounded-2xl border p-4 text-center space-y-2 ${
                    visualData.conflictCount > 0
                      ? 'border-amber-500/50 bg-gradient-to-b from-amber-950/30 to-[#071320]'
                      : 'border-emerald-500/50 bg-gradient-to-b from-emerald-950/30 to-[#071320]'
                  }`}
                >
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/15 border border-teal-400/40 animate-pulse-soft">
                    <Sparkles className="h-5 w-5 text-teal-300" />
                  </div>
                  <p className="text-xs font-bold text-white">
                    Hasil Cek Silang
                  </p>
                  <div className="flex items-center justify-center gap-2 text-xs font-mono">
                    <span className="rounded bg-emerald-950/90 border border-emerald-700/50 px-2 py-0.5 text-emerald-300 font-bold">
                      {visualData.verifiedCount} Fakta
                    </span>
                    <span
                      className={`rounded px-2 py-0.5 font-bold border ${
                        visualData.conflictCount > 0
                          ? 'bg-amber-950/90 border-amber-700/50 text-amber-300'
                          : 'bg-slate-900 border-slate-700 text-slate-400'
                      }`}
                    >
                      {visualData.conflictCount} Beda
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT (5 Cols): Animated Circular Gauge + 4 Visual Counters */}
          <div className="lg:col-span-5 rounded-xl border border-slate-800/90 bg-[#050e18] p-4 sm:p-5 flex flex-col sm:flex-row items-center gap-5">
            {/* Circular SVG Gauge */}
            <div className="relative flex items-center justify-center shrink-0">
              <svg
                width="128"
                height="128"
                viewBox="0 0 128 128"
                className="-rotate-90 transform"
              >
                <circle
                  cx="64"
                  cy="64"
                  r={radius}
                  fill="transparent"
                  stroke="#0f172a"
                  strokeWidth="12"
                />
                <circle
                  cx="64"
                  cy="64"
                  r={radius}
                  fill="transparent"
                  stroke={
                    visualData.conflictCount === 0
                      ? '#10b981'
                      : visualData.alignmentPct >= 60
                      ? '#14b8a6'
                      : '#f59e0b'
                  }
                  strokeWidth="12"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  className="transition-all duration-1000 ease-out"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="font-mono text-2xl font-extrabold text-white tabular-nums">
                  {visualData.alignmentPct}%
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-teal-300">
                  Skor Selaras
                </span>
              </div>
            </div>

            {/* 2x2 Visual Counter Grid */}
            <div className="grid grid-cols-2 gap-2.5 w-full">
              <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/20 p-3">
                <p className="text-[11px] font-semibold text-emerald-300">
                  Fakta Sesuai
                </p>
                <p className="mt-0.5 font-mono text-xl font-extrabold text-white tabular-nums">
                  {visualData.verifiedCount}
                </p>
              </div>

              <div
                className={`rounded-xl border p-3 ${
                  visualData.conflictCount > 0
                    ? 'border-amber-600/50 bg-amber-950/25'
                    : 'border-slate-800 bg-[#081523]'
                }`}
              >
                <p
                  className={`text-[11px] font-semibold ${
                    visualData.conflictCount > 0
                      ? 'text-amber-300'
                      : 'text-slate-400'
                  }`}
                >
                  Perbedaan Data
                </p>
                <p className="mt-0.5 font-mono text-xl font-extrabold text-white tabular-nums">
                  {visualData.conflictCount}
                </p>
              </div>

              <div className="rounded-xl border border-teal-800/40 bg-teal-950/20 p-3">
                <p className="text-[11px] font-semibold text-teal-300">
                  Hitung & Rasio
                </p>
                <p className="mt-0.5 font-mono text-xl font-extrabold text-white tabular-nums">
                  {visualData.calcCount}
                </p>
              </div>

              <div className="rounded-xl border border-sky-800/40 bg-sky-950/20 p-3">
                <p className="text-[11px] font-semibold text-sky-300">
                  Data Kosong
                </p>
                <p className="mt-0.5 font-mono text-xl font-extrabold text-white tabular-nums">
                  {visualData.gapCount}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Expandable Narrative Drawer ("Lihat Selengkapnya") */}
        {showFullNarrativeDrawer && (
          <div className="rounded-xl border border-teal-800/50 bg-teal-950/25 p-4 space-y-2.5 animate-fadeIn">
            <h3 className="text-xs font-bold uppercase tracking-wider text-teal-300">
              Ringkasan Lengkap Lintas Dokumen
            </h3>
            <p className="text-sm text-slate-100 leading-relaxed">
              {cleanDisplayText(report.directAnswerToQuestion)}
            </p>
            {report.executiveSummary &&
              report.executiveSummary !== report.directAnswerToQuestion && (
                <p className="text-xs text-slate-300 leading-relaxed pt-2 border-t border-teal-900/50">
                  {cleanDisplayText(report.executiveSummary)}
                </p>
              )}
            {report.conclusionValidityNote && (
              <p className="text-xs text-amber-200/90 pt-1">
                <strong>Catatan Validitas Bukti: </strong>
                {cleanDisplayText(report.conclusionValidityNote)}
              </p>
            )}
          </div>
        )}
      </section>

      {/* =====================================================================
          BAGIAN UTAMA 2: GRAFIK PERBANDINGAN NILAI & PERBEDAAN (ANIMATED BARS)
          ===================================================================== */}
      {visualData.barComparisons.length > 0 && (
        <section
          aria-label="Grafik Perbandingan Nilai Antar Dokumen"
          className="rounded-2xl border border-slate-800 bg-[#081523]/95 backdrop-blur-md p-5 sm:p-6 space-y-4 shadow-xl"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 border border-amber-500/40">
                <GitCompare className="h-4 w-4 text-amber-400" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">
                  Grafik Perbandingan & Selisih Antar Dokumen
                </h2>
                <p className="text-xs text-slate-400">
                  Perbandingan visual nilai antar berkas agar perbedaan langsung
                  terlihat dalam sekali lihat.
                </p>
              </div>
            </div>

            {visualData.barComparisons.length > 4 && (
              <button
                type="button"
                onClick={() => setShowAllVisualBars((prev) => !prev)}
                className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-teal-500/40 bg-teal-950/50 px-3 py-1.5 text-xs font-semibold text-teal-200 hover:bg-teal-900/60 cursor-pointer shrink-0"
              >
                <span>
                  {showAllVisualBars
                    ? 'Tampilkan 4 Grafik Utama'
                    : `Lihat Selengkapnya (${visualData.barComparisons.length} Grafik)`}
                </span>
                {showAllVisualBars ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {visibleBarComparisons.map((item) => {
              const isExpanded = Boolean(expandedVisualBarIds[item.id]);
              const isConflict = item.status === 'conflict';
              const isChanged = item.status === 'changed';

              return (
                <article
                  key={item.id}
                  className={`rounded-xl border p-4 flex flex-col justify-between gap-3.5 transition-all ${
                    isConflict
                      ? 'border-amber-600/50 bg-[#06111d]'
                      : isChanged
                      ? 'border-sky-700/50 bg-[#06111d]'
                      : 'border-slate-800 bg-[#06111d]'
                  }`}
                >
                  <div className="space-y-3">
                    {/* Card Header + Delta Badge */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                          {item.category}
                        </span>
                        <h3 className="text-sm font-bold text-white leading-snug">
                          {item.title}
                        </h3>
                      </div>

                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 font-mono text-xs font-bold border ${
                          isConflict
                            ? 'bg-amber-950/90 border-amber-500/50 text-amber-300'
                            : isChanged
                            ? 'bg-sky-950/90 border-sky-500/50 text-sky-300'
                            : 'bg-emerald-950/90 border-emerald-500/50 text-emerald-300'
                        }`}
                      >
                        {item.deltaBadge}
                      </span>
                    </div>

                    {/* Visual Animated Bar 1 (Document A) */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs gap-2">
                        <span className="font-medium text-slate-300 truncate">
                          {item.docALabel}
                        </span>
                        <span className="font-mono font-bold text-rose-300 shrink-0 tabular-nums">
                          {item.formattedA}
                        </span>
                      </div>
                      <div className="h-3.5 w-full overflow-hidden rounded-full bg-slate-900 p-0.5">
                        <div
                          style={{ width: `${item.barPctA}%` }}
                          className={`h-full rounded-full animate-bar-x ${
                            isConflict
                              ? 'bg-gradient-to-r from-rose-500 to-amber-400'
                              : 'bg-gradient-to-r from-teal-500 to-emerald-400'
                          }`}
                        />
                      </div>
                    </div>

                    {/* Visual Animated Bar 2 (Document B) */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs gap-2">
                        <span className="font-medium text-slate-300 truncate">
                          {item.docBLabel}
                        </span>
                        <span className="font-mono font-bold text-teal-300 shrink-0 tabular-nums">
                          {item.formattedB}
                        </span>
                      </div>
                      <div className="h-3.5 w-full overflow-hidden rounded-full bg-slate-900 p-0.5">
                        <div
                          style={{ width: `${item.barPctB}%` }}
                          className="h-full rounded-full animate-bar-x bg-gradient-to-r from-teal-500 to-sky-400"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Ultra-short 1-line summary + "Lihat Selengkapnya" toggle */}
                  <div className="pt-2.5 border-t border-slate-800/80 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-slate-300 truncate">
                        {item.shortSummary}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedVisualBarIds((prev) => ({
                            ...prev,
                            [item.id]: !prev[item.id],
                          }))
                        }
                        className="inline-flex items-center gap-1 text-xs font-semibold text-teal-300 hover:text-teal-200 shrink-0 cursor-pointer"
                      >
                        <span>
                          {isExpanded ? 'Tutup' : 'Lihat Selengkapnya'}
                        </span>
                        {isExpanded ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="rounded-lg border border-slate-800 bg-[#040b13] p-3 space-y-1.5 text-xs text-slate-200 animate-fadeIn">
                        <p className="leading-relaxed">{item.fullExplanation}</p>
                        {item.resolution && (
                          <p className="text-teal-300 pt-1">
                            <strong>Saran Tindak Lanjut: </strong>
                            {item.resolution}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* =====================================================================
          BAGIAN UTAMA 3: GRAFIK TREN (SVG CHART) & PETA VISUAL CELAH DATA
          ===================================================================== */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* LEFT (7 Cols): Animated SVG Trend & Metric Area Chart */}
        {svgPoints.length > 0 && (
          <section
            aria-label="Grafik Tren dan Indikator"
            className="lg:col-span-7 rounded-2xl border border-slate-800 bg-[#081523]/95 backdrop-blur-md p-5 sm:p-6 flex flex-col justify-between space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500/15 border border-teal-500/40">
                  <TrendingUp className="h-4 w-4 text-teal-300" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">
                    {visualData.trendTitle}
                  </h2>
                  <p className="text-xs text-slate-400">
                    {visualData.trendSubtitle}
                  </p>
                </div>
              </div>
              {visualData.trendUnit && (
                <span className="rounded-md border border-teal-800 bg-teal-950/60 px-2.5 py-1 font-mono text-xs font-semibold text-teal-300 whitespace-nowrap shrink-0">
                  Satuan: {visualData.trendUnit}
                </span>
              )}
            </div>

            {/* SVG Line + Area Graphic */}
            <div className="rounded-xl border border-slate-800/90 bg-[#050e18] p-4">
              <svg
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                className="w-full h-44 overflow-visible"
                role="img"
                aria-label={visualData.trendTitle}
              >
                <defs>
                  <linearGradient
                    id="trendAreaGrad"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.38" />
                    <stop offset="100%" stopColor="#14b8a6" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Subtle Horizontal Reference Lines */}
                {[0.25, 0.5, 0.75].map((ratio, idx) => (
                  <line
                    key={idx}
                    x1={padX - 10}
                    y1={padY + ratio * (chartHeight - padY * 2)}
                    x2={chartWidth - padX + 10}
                    y2={padY + ratio * (chartHeight - padY * 2)}
                    stroke="#1e293b"
                    strokeDasharray="4 4"
                    strokeWidth="1"
                  />
                ))}

                {/* Shaded Area under Trend Line */}
                {areaPath && <path d={areaPath} fill="url(#trendAreaGrad)" />}

                {/* Connecting Trend Line */}
                {svgPoints.length >= 2 && (
                  <polyline
                    fill="none"
                    stroke="#14b8a6"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={polylinePoints}
                  />
                )}

                {/* Data Nodes & Direct Value Callouts */}
                {svgPoints.map((pt, idx) => (
                  <g key={idx}>
                    {/* Vertical Drop Pillar */}
                    <line
                      x1={pt.x}
                      y1={pt.y}
                      x2={pt.x}
                      y2={chartHeight - padY}
                      stroke={pt.isProjection ? '#38bdf8' : '#14b8a6'}
                      strokeOpacity="0.35"
                      strokeDasharray={pt.isProjection ? '4 4' : undefined}
                      strokeWidth="2"
                    />
                    {/* Glowing Point */}
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r="6"
                      fill={pt.isProjection ? '#0284c7' : '#0d9488'}
                      stroke={pt.isProjection ? '#7dd3fc' : '#5eead4'}
                      strokeWidth="2.5"
                    />
                    {/* Value Badge Above Node */}
                    <text
                      x={pt.x}
                      y={pt.y - 12}
                      textAnchor="middle"
                      fill={pt.isProjection ? '#7dd3fc' : '#f8fafc'}
                      fontSize="11"
                      fontWeight="bold"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {pt.formattedValue}
                    </text>
                    {/* X-Axis Period Label */}
                    <text
                      x={pt.x}
                      y={chartHeight - 7}
                      textAnchor="middle"
                      fill="#cbd5e1"
                      fontSize="11"
                      fontWeight="600"
                    >
                      {pt.label}
                    </text>
                  </g>
                ))}
              </svg>

              {/* Bottom Pill Strip for Sub-labels (e.g. QoQ Growth) */}
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 border-t border-slate-800/80">
                {trendPoints.map((pt, i) => (
                  <div
                    key={i}
                    className={`rounded-lg border px-2.5 py-1.5 text-center ${
                      pt.isProjection
                        ? 'border-sky-700/50 bg-sky-950/25'
                        : 'border-slate-800 bg-[#081523]'
                    }`}
                  >
                    <p className="text-[11px] font-bold text-white truncate">
                      {pt.label}
                    </p>
                    <p
                      className={`font-mono text-[11px] font-semibold ${
                        pt.isProjection ? 'text-sky-300' : 'text-teal-300'
                      }`}
                    >
                      {pt.subLabel}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* RIGHT (5 Cols): Peta Visual Kesenjangan / Kelengkapan Data */}
        <section
          aria-label="Peta Visual Kelengkapan Data"
          className={`${
            svgPoints.length > 0 ? 'lg:col-span-5' : 'lg:col-span-12'
          } rounded-2xl border border-slate-800 bg-[#081523]/95 backdrop-blur-md p-5 sm:p-6 flex flex-col justify-between space-y-4 shadow-xl`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 border border-sky-500/40">
                <HelpCircle className="h-4 w-4 text-sky-400" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">
                  Radar Kelengkapan Data ({visualData.gapBadges.length})
                </h2>
                <p className="text-xs text-slate-400">
                  Bagian dokumen yang masih kosong atau menunggu bukti tambahan.
                </p>
              </div>
            </div>
          </div>

          {visualData.gapBadges.length === 0 ? (
            <div className="rounded-xl border border-emerald-800/50 bg-emerald-950/20 p-5 text-center space-y-2">
              <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" />
              <p className="text-sm font-bold text-white">
                100% Data Lengkap
              </p>
              <p className="text-xs text-slate-300">
                Tidak ditemukan atribut kosong atau lampiran yang hilang.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {visualData.gapBadges.map((gap) => {
                const isGapOpen = Boolean(expandedVisualGapIds[gap.id]);
                return (
                  <div
                    key={gap.id}
                    className="rounded-xl border border-slate-800 bg-[#050e18] p-3.5 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold ${
                            gap.severityColor === 'rose'
                              ? 'bg-rose-950 text-rose-300 border border-rose-700/50'
                              : gap.severityColor === 'amber'
                              ? 'bg-amber-950 text-amber-300 border border-amber-700/50'
                              : 'bg-sky-950 text-sky-300 border border-sky-700/50'
                          }`}
                        >
                          {gap.statusLabel}
                        </span>
                        <h3 className="text-xs font-bold text-white pt-1">
                          {gap.title}
                        </h3>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          setExpandedVisualGapIds((prev) => ({
                            ...prev,
                            [gap.id]: !prev[gap.id],
                          }))
                        }
                        className="text-[11px] font-semibold text-teal-300 hover:text-teal-200 shrink-0 cursor-pointer"
                      >
                        {isGapOpen ? 'Tutup' : 'Lihat Selengkapnya'}
                      </button>
                    </div>

                    <p className="text-[11px] text-slate-400 font-mono">
                      Sumber: {gap.docLabel}
                    </p>

                    {isGapOpen && (
                      <div className="rounded-lg border border-slate-800 bg-[#081523] p-2.5 space-y-1 text-xs text-slate-200 animate-fadeIn">
                        <p>{gap.shortImpact}</p>
                        {gap.fullVerification && (
                          <p className="text-teal-300 pt-1">
                            <strong>Verifikasi: </strong>
                            {gap.fullVerification}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* =====================================================================
          TOMBOL PEMBUKA RINCIAN TABEL & TEKS LENGKAP ("LIHAT SELENGKAPNYA")
          ===================================================================== */}
      <div className="no-print rounded-2xl border border-teal-800/50 bg-[#081523]/90 p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-white">
            Ingin melihat tabel lengkap, daftar fakta, dan rumus perhitungan?
          </p>
          <p className="text-xs text-slate-400">
            Tampilan di atas dirancang ringkas secara visual. Klik tombol di
            samping untuk membuka atau menyembunyikan rincian tabel dan teks.
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            setPresentationMode((prev) =>
              prev === 'visual' ? 'detailed' : 'visual'
            )
          }
          className="inline-flex items-center gap-2 rounded-xl bg-teal-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-teal-400 transition-colors shrink-0 cursor-pointer"
        >
          <span>
            {presentationMode === 'detailed'
              ? 'Sembunyikan Rincian Tabel & Teks'
              : 'Lihat Selengkapnya (Tabel & Rincian Teks)'}
          </span>
          {presentationMode === 'detailed' ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* =====================================================================
          MODE RINCIAN TABEL & TEKS (DITAMPILKAN SAAT USER MEMILIH "LIHAT SELENGKAPNYA")
          ===================================================================== */}
      {presentationMode === 'detailed' && (
        <div className="space-y-6 animate-fadeIn">
          {/* Filter & Search Bar */}
          <div className="no-print flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-xl border border-slate-800 bg-[#081523] p-3">
            <div
              role="tablist"
              aria-label="Filter Kategori Hasil Analisis"
              className="flex flex-wrap items-center gap-1 rounded-lg bg-[#050e18] p-1"
            >
              {(
                [
                  { id: 'all', label: 'Semua Rincian' },
                  ...(hasComparisonMatrix
                    ? [
                        {
                          id: 'comparison_matrix' as SectionFilter,
                          label: `Tabel (${comparisonMatrix!.rows.length})`,
                        },
                      ]
                    : []),
                  ...(hasCrossMatch
                    ? [
                        {
                          id: 'matching' as SectionFilter,
                          label: `Pencocokan (${crossMatch!.allEvaluatedRows.length})`,
                        },
                      ]
                    : []),
                  ...(report.conflicts.length > 0
                    ? [
                        {
                          id: 'conflicts' as SectionFilter,
                          label: `Perbedaan (${report.conflicts.length})`,
                        },
                      ]
                    : []),
                  {
                    id: 'facts',
                    label: `Fakta (${report.explicitFacts.length})`,
                  },
                  {
                    id: 'calculations',
                    label: `Rumus Hitung (${report.calculations.length})`,
                  },
                  {
                    id: 'gaps',
                    label: `Celah Data (${report.uncertainties.length})`,
                  },
                ] as Array<{ id: SectionFilter; label: string }>
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={sectionFilter === tab.id}
                  onClick={() => setSectionFilter(tab.id)}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    sectionFilter === tab.id
                      ? 'bg-teal-500 text-slate-950 font-semibold'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Search & Source Document Filter */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="search"
                  aria-label="Cari temuan analisis"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari cabang, klausul, angka..."
                  className="w-full sm:w-52 rounded-lg border border-slate-700 bg-[#050e18] pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none"
                />
              </div>

              <select
                aria-label="Filter berdasarkan dokumen sumber"
                value={selectedDocFilter}
                onChange={(e) => setSelectedDocFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-[#050e18] px-3 py-1.5 text-xs text-slate-200 focus:border-teal-400 focus:outline-none"
              >
                <option value="ALL">
                  Semua Dokumen ({report.documentNames.length})
                </option>
                {report.documentNames.map((name) => (
                  <option key={name} value={name}>
                    {humanizeDocTitle(name)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Specialized Multi-Stage Selection Table (When applicable) */}
          {hasCrossMatch &&
            (sectionFilter === 'all' || sectionFilter === 'matching') && (
              <section
                aria-label="Hasil Pencocokan Data Peserta Lintas Dokumen"
                className="rounded-2xl border border-teal-700/60 bg-[#081523] p-5 space-y-4 shadow-xl"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3.5">
                  <div>
                    <div className="flex items-center gap-2">
                      <GitMerge className="h-4 w-4 text-teal-400 shrink-0" />
                      <h2 className="text-base font-bold text-white">
                        Tabel Pencocokan Entitas & Skor Lintas Tahap
                      </h2>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-300">
                      Fokus:{' '}
                      <span className="font-semibold text-teal-300">
                        {crossMatch!.targetMajorFilter}
                      </span>{' '}
                      · {crossMatch!.matchedCount} cocok utama, {nearMatchCount}{' '}
                      menyerempet
                    </p>
                  </div>

                  <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-[#050e18] p-1 self-start">
                    <button
                      type="button"
                      onClick={() => setMatchViewFilter('all')}
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                        matchViewFilter === 'all'
                          ? 'bg-teal-500 text-slate-950'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      Semua ({crossMatch!.allEvaluatedRows.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setMatchViewFilter('qualified')}
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                        matchViewFilter === 'qualified'
                          ? 'bg-teal-500 text-slate-950'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      Lolos Utama ({crossMatch!.qualifiedMatchedRows.length})
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-800 bg-[#050e18] text-[11px] uppercase tracking-wider text-slate-300">
                      <tr>
                        <th className="px-2.5 py-3 font-semibold w-9 text-center">
                          No
                        </th>
                        <th className="px-3 py-3 font-semibold">
                          Nama Peserta
                        </th>
                        <th className="px-3 py-3 font-semibold">
                          Kategori / Program
                        </th>
                        <th className="px-2.5 py-3 font-semibold">Nilai SKD</th>
                        <th className="px-2.5 py-3 font-semibold">
                          Nilai Psikotes
                        </th>
                        <th className="px-2.5 py-3 font-semibold">
                          Status Psikotes
                        </th>
                        <th className="px-3 py-3 font-semibold">Sumber</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70 bg-[#07121e] tabular-nums">
                      {displayedMatchedRows.map((row, idx) => (
                        <tr key={`${row.participantName}-${idx}`}>
                          <td className="px-2.5 py-2.5 text-center font-mono text-slate-400">
                            {idx + 1}
                          </td>
                          <td className="px-3 py-2.5 font-semibold text-white">
                            {row.participantName}
                          </td>
                          <td className="px-3 py-2.5 text-slate-200">
                            {row.majorCompatibility}
                          </td>
                          <td className="px-2.5 py-2.5 font-mono text-teal-200">
                            {row.skdScore || '-'}
                          </td>
                          <td className="px-2.5 py-2.5 font-mono text-sky-200">
                            {row.psikologiScore || '-'}
                          </td>
                          <td className="px-2.5 py-2.5 text-emerald-300">
                            {row.psikologiStatus}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[11px] text-slate-300">
                            {cleanDisplayText(
                              row.sourceShort || row.sourceTraceability
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

          {/* Cross-Document Comparison Table */}
          {hasComparisonMatrix &&
            (sectionFilter === 'all' ||
              sectionFilter === 'comparison_matrix') && (
              <section
                aria-label="Tabel Perbandingan Lintas Dokumen"
                className="rounded-2xl border border-teal-800/50 bg-[#081523] p-5 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <GitCompare className="h-4 w-4 text-teal-400 shrink-0" />
                    <h2 className="text-base font-bold text-white">
                      Tabel Perbandingan Antar Dokumen (
                      {filteredMatrixRows.length} Baris)
                    </h2>
                  </div>

                  {filteredMatrixRows.length > 5 && (
                    <button
                      type="button"
                      onClick={() => setShowAllMatrixRows((prev) => !prev)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-teal-500/40 bg-teal-950/50 px-3 py-1.5 text-xs font-semibold text-teal-200 cursor-pointer"
                    >
                      <span>
                        {showAllMatrixRows
                          ? 'Ringkas Tabel (5 Teratas)'
                          : `Lihat Selengkapnya (${filteredMatrixRows.length} Baris)`}
                      </span>
                    </button>
                  )}
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-800 bg-[#050e18] text-[11px] uppercase tracking-wider text-slate-300">
                      <tr>
                        <th className="px-3.5 py-3 font-semibold">
                          {cleanDisplayText(
                            comparisonMatrix!.entityLabel || 'Item / Entitas'
                          )}
                        </th>
                        <th className="px-3 py-3 font-semibold">Kategori</th>
                        {comparisonMatrix!.documentColumns.map((docCol) => (
                          <th key={docCol} className="px-3.5 py-3 font-semibold">
                            {humanizeDocTitle(docCol)}
                          </th>
                        ))}
                        <th className="px-3 py-3 font-semibold">Status</th>
                        <th className="px-3.5 py-3 font-semibold">
                          Keterangan Perbedaan
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80 bg-[#07121e] tabular-nums">
                      {(showAllMatrixRows
                        ? filteredMatrixRows
                        : filteredMatrixRows.slice(0, 5)
                      ).map((row, idx) => (
                        <tr key={idx} className="hover:bg-[#0b1c2e]/70">
                          <td className="px-3.5 py-3 font-semibold text-white">
                            {cleanDisplayText(row.entityName)}
                          </td>
                          <td className="px-3 py-3 text-slate-300">
                            {cleanDisplayText(row.category)}
                          </td>
                          {comparisonMatrix!.documentColumns.map((docCol) => (
                            <td
                              key={docCol}
                              className="px-3.5 py-3 font-mono text-teal-200"
                            >
                              {cleanDisplayText(row.docValues[docCol] || '-')}
                            </td>
                          ))}
                          <td className="px-3 py-3 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold ${
                                row.status === 'Konsisten'
                                  ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-800/50'
                                  : row.status === 'Konflik Material'
                                  ? 'bg-rose-950/70 text-rose-300 border border-rose-800/50'
                                  : 'bg-amber-950/70 text-amber-300 border border-amber-800/50'
                              }`}
                            >
                              {row.status}
                            </span>
                          </td>
                          <td className="px-3.5 py-3 text-slate-200">
                            {cleanDisplayText(row.differenceOrRelation)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

          {/* Detailed Facts List */}
          {(sectionFilter === 'all' || sectionFilter === 'facts') &&
            filteredFacts.length > 0 && (
              <section
                aria-label="Fakta Utama"
                className="rounded-2xl border border-slate-800 bg-[#081523] p-5 space-y-3.5"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  <h2 className="text-base font-bold text-white">
                    Daftar Fakta & Temuan ({filteredFacts.length})
                  </h2>
                </div>
                <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
                  {filteredFacts.map((fact) => (
                    <article
                      key={fact.id}
                      className="rounded-xl border border-slate-800 bg-[#06101b] p-4 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-teal-300">
                          {cleanDisplayText(fact.category)}
                        </span>
                        <span className="font-mono text-xs font-bold text-emerald-300">
                          {cleanDisplayText(fact.value)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-200 leading-relaxed">
                        {cleanDisplayText(fact.statement)}
                      </p>
                      <p className="text-[11px] text-slate-400 pt-1 border-t border-slate-800/80">
                        Sumber: {humanizeDocTitle(fact.citation.documentName)} (
                        {cleanDisplayText(fact.citation.location)})
                      </p>
                    </article>
                  ))}
                </div>
              </section>
            )}

          {/* Detailed Calculations */}
          {(sectionFilter === 'all' || sectionFilter === 'calculations') &&
            filteredCalculations.length > 0 && (
              <section
                aria-label="Hasil Perhitungan"
                className="rounded-2xl border border-slate-800 bg-[#081523] p-5 space-y-3.5"
              >
                <div className="flex items-center gap-2">
                  <Calculator className="h-4 w-4 text-teal-300 shrink-0" />
                  <h2 className="text-base font-bold text-white">
                    Rincian Perhitungan & Rumus ({filteredCalculations.length})
                  </h2>
                </div>
                <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
                  {filteredCalculations.map((calc) => (
                    <article
                      key={calc.id}
                      className="rounded-xl border border-slate-800 bg-[#06101b] p-4 space-y-2"
                    >
                      <h3 className="text-xs font-bold text-white">
                        {cleanDisplayText(calc.metricName)}
                      </h3>
                      <p className="font-mono text-sm font-bold text-emerald-300">
                        {cleanDisplayText(calc.resultValue)}
                      </p>
                      <p className="text-xs text-slate-300">
                        {cleanDisplayText(calc.interpretation)}
                      </p>
                      <p className="font-mono text-[11px] text-slate-400 pt-1 border-t border-slate-800/80">
                        Rumus: {cleanDisplayText(calc.formula)}
                      </p>
                    </article>
                  ))}
                </div>
              </section>
            )}

          {/* Detailed Conflicts */}
          {sectionFilter === 'conflicts' && filteredConflicts.length > 0 && (
            <section
              aria-label="Rincian Perbedaan"
              className="rounded-2xl border border-slate-800 bg-[#081523] p-5 space-y-3.5"
            >
              <h2 className="text-base font-bold text-white">
                Rincian Perbedaan Data ({filteredConflicts.length})
              </h2>
              <div className="space-y-3">
                {filteredConflicts.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-xl border border-amber-700/40 bg-[#06101b] p-4 space-y-2"
                  >
                    <h3 className="text-sm font-bold text-white">
                      {cleanDisplayText(c.topic)}
                    </h3>
                    <p className="text-xs text-slate-200">
                      {cleanDisplayText(c.discrepancyExplanation)}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Detailed Gaps */}
          {sectionFilter === 'gaps' && filteredUncertainties.length > 0 && (
            <section
              aria-label="Rincian Celah Data"
              className="rounded-2xl border border-slate-800 bg-[#081523] p-5 space-y-3.5"
            >
              <h2 className="text-base font-bold text-white">
                Rincian Celah Data ({filteredUncertainties.length})
              </h2>
              <div className="space-y-3">
                {filteredUncertainties.map((u) => (
                  <div
                    key={u.id}
                    className="rounded-xl border border-slate-800 bg-[#06101b] p-4 space-y-1.5"
                  >
                    <h3 className="text-xs font-bold text-white">
                      {cleanDisplayText(u.topic)}
                    </h3>
                    <p className="text-xs text-slate-300">
                      {cleanDisplayText(u.impactOnConclusion)}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
};
