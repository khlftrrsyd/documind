import React from 'react';
import {
  CheckCircle2,
  Settings,
  Play,
} from 'lucide-react';
import { ServerHealthStatus } from '../types/analysis';

interface SystemGuideViewProps {
  serverStatus: ServerHealthStatus | null;
  onRunQuickDemo: () => void;
}

export const SystemGuideView: React.FC<SystemGuideViewProps> = ({
  serverStatus,
  onRunQuickDemo,
}) => {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 space-y-6">
      <section className="rounded-2xl border border-teal-800/50 bg-[#081523] p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <h1 className="text-lg font-bold text-white">
              Panduan Singkat & Status Sistem
            </h1>
            <p className="mt-0.5 text-xs text-slate-300">
              Ringkasan kapabilitas analisis multi-dokumen universal pada DocuMind AI.
            </p>
          </div>

          <button
            type="button"
            onClick={onRunQuickDemo}
            className="inline-flex items-center gap-2 rounded-xl bg-teal-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-teal-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            Uji Skenario Multi-Dokumen
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-[#06101b] p-4 space-y-2.5">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              <h2 className="text-sm font-bold text-white">
                Kapabilitas Lintas Domain
              </h2>
            </div>

            <ul className="space-y-1.5 text-xs text-slate-200">
              <li>
                • Ekstraksi teks & tabel dari PDF (digital maupun OCR scan) serta CSV dengan keterlacakan halaman/baris.
              </li>
              <li>
                • Analisis & Sintesis terpadu yang memisahkan Fakta Eksplisit, Interpretasi, dan Kesimpulan Turunan.
              </li>
              <li>
                • Perbandingan Data lintas dokumen untuk laporan keuangan, klausul kontrak hukum, riset, dan inventaris.
              </li>
              <li>
                • Deteksi Kesenjangan Data (membedakan data belum tercantum vs gagal ekstrak) serta Estimasi & Tren numerik.
              </li>
            </ul>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#06101b] p-4 space-y-2.5">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-sky-400 shrink-0" />
              <h2 className="text-sm font-bold text-white">Status Sistem</h2>
            </div>

            <div className="space-y-1.5 text-xs text-slate-300 font-mono">
              <p>
                API Server:{' '}
                <span className="text-teal-300">Aktif (/api/analyze)</span>
              </p>
              <p>
                Mesin Analisis:{' '}
                <span className="text-sky-300">
                  {serverStatus?.geminiConfigured
                    ? 'Gemini API + Pipeline Lintas Dokumen Terstruktur'
                    : 'Pipeline Analisis Lintas Dokumen Terstruktur Aktif'}
                </span>
              </p>
              <p>
                Penyimpanan:{' '}
                <span className="text-emerald-300">
                  Lokal Perangkat (Dengan Persetujuan)
                </span>
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
