import React from 'react';
import {
  Clock,
  Trash2,
  Eye,
  ShieldCheck,
  FolderOpen,
  Download,
} from 'lucide-react';
import { AnalysisReport } from '../types/analysis';
import {
  formatReportToMarkdown,
  humanizeDocTitle,
} from '../utils/analysisEngine';

interface HistoryViewProps {
  history: AnalysisReport[];
  storageConsent: boolean;
  onToggleStorageConsent: (consent: boolean) => void;
  onOpenReport: (report: AnalysisReport) => void;
  onDeleteReport: (id: string) => void;
  onClearAllHistory: () => void;
  onGoToUpload: () => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  history,
  storageConsent,
  onToggleStorageConsent,
  onOpenReport,
  onDeleteReport,
  onClearAllHistory,
  onGoToUpload,
}) => {
  const handleDownloadMarkdown = (report: AnalysisReport) => {
    const md = formatReportToMarkdown(report);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Laporan_DocuMind_${report.id}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 space-y-6">
      <section
        aria-label="Pengaturan Penyimpanan"
        className="rounded-2xl border border-teal-800/50 bg-[#081523] p-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-5 w-5 text-teal-400 shrink-0" />
            <div>
              <h1 className="text-lg font-bold text-white">
                Riwayat Analisis
              </h1>
              <p className="text-xs text-slate-300">
                Laporan disimpan secara lokal di perangkat Anda.
              </p>
            </div>
          </div>

          {history.length > 0 && (
            <button
              type="button"
              onClick={onClearAllHistory}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-900/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Hapus Semua ({history.length})
            </button>
          )}
        </div>

        <div className="mt-4 pt-3.5 border-t border-slate-800 flex items-center justify-between">
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={storageConsent}
              onChange={(e) => onToggleStorageConsent(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-teal-500 focus:ring-teal-400"
            />
            <span className="text-xs text-slate-200">
              Simpan otomatis hasil analisis baru
            </span>
          </label>
        </div>
      </section>

      <section aria-label="Daftar Riwayat Laporan">
        {history.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-[#081523] p-8 text-center">
            <Clock className="mx-auto h-8 w-8 text-slate-400" />
            <h2 className="mt-2.5 text-sm font-bold text-white">
              Belum Ada Riwayat Tersimpan
            </h2>
            <button
              type="button"
              onClick={onGoToUpload}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-teal-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-teal-400 cursor-pointer"
            >
              <FolderOpen className="h-4 w-4" />
              Unggah Dokumen
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((item) => (
              <article
                key={item.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-slate-800 bg-[#081523] p-4 hover:border-teal-700/50 transition-colors"
              >
                <div className="space-y-1 min-w-0">
                  <p className="text-xs text-teal-300 tabular-nums">
                    {new Date(item.createdAt).toLocaleString('id-ID')} ·{' '}
                    {item.documentNames.length} dokumen
                  </p>
                  <h2 className="text-sm font-bold text-white truncate">
                    {item.customQuestion ||
                      item.documentNames.map(humanizeDocTitle).join(' · ')}
                  </h2>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onOpenReport(item)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-teal-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-teal-400 transition-colors cursor-pointer"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Buka
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDownloadMarkdown(item)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-teal-500/50 transition-colors cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5 text-teal-400" />
                    .MD
                  </button>

                  <button
                    type="button"
                    onClick={() => onDeleteReport(item.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-1.5 text-xs font-medium text-rose-300 hover:border-rose-500/40 transition-colors cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
