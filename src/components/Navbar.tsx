import React from 'react';

export type ActiveTab = 'upload' | 'results' | 'history' | 'guide';

interface NavbarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  hasActiveReport: boolean;
  historyCount: number;
  onQuickLoadSample: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  hasActiveReport,
  historyCount,
  onQuickLoadSample,
}) => {
  return (
    <header className="no-print sticky top-0 z-30 border-b border-teal-900/50 bg-[#06101a]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 md:gap-8 px-4 py-3 sm:px-6">
        <a
          href="#upload"
          onClick={(e) => {
            e.preventDefault();
            onSelectTab('upload');
          }}
          className="text-lg font-bold tracking-tight text-teal-300 hover:text-teal-200 transition-colors whitespace-nowrap shrink-0"
        >
          DocuMind AI
        </a>

        <nav
          aria-label="Navigasi Utama"
          className="flex items-center gap-5 sm:gap-7 overflow-x-auto text-sm font-medium"
        >
          <button
            type="button"
            onClick={() => onSelectTab('upload')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeTab === 'upload'
                ? 'border-teal-400 text-white font-semibold'
                : 'border-transparent text-slate-300 hover:text-white'
            }`}
          >
            Unggah
          </button>

          <button
            type="button"
            onClick={() => onSelectTab('results')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeTab === 'results'
                ? 'border-teal-400 text-white font-semibold'
                : 'border-transparent text-slate-300 hover:text-white'
            }`}
          >
            {hasActiveReport ? 'Hasil Analisis' : 'Hasil'}
          </button>

          <button
            type="button"
            onClick={() => onSelectTab('history')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 tabular-nums cursor-pointer ${
              activeTab === 'history'
                ? 'border-teal-400 text-white font-semibold'
                : 'border-transparent text-slate-300 hover:text-white'
            }`}
          >
            {historyCount > 0 ? `Riwayat (${historyCount})` : 'Riwayat'}
          </button>

          <button
            type="button"
            onClick={() => onSelectTab('guide')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeTab === 'guide'
                ? 'border-teal-400 text-white font-semibold'
                : 'border-transparent text-slate-300 hover:text-white'
            }`}
          >
            Panduan
          </button>
        </nav>

        <div className="hidden sm:flex items-center shrink-0">
          <button
            type="button"
            onClick={onQuickLoadSample}
            className="px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-teal-400 rounded-lg hover:bg-teal-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Uji Contoh
          </button>
        </div>
      </div>
    </header>
  );
};
