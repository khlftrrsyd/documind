/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { Navbar, ActiveTab } from './components/Navbar';
import { UploadWorkspace } from './components/UploadWorkspace';
import { AnalysisResultsView } from './components/AnalysisResultsView';
import { HistoryView } from './components/HistoryView';
import { SystemGuideView } from './components/SystemGuideView';
import {
  AnalysisModeId,
  AnalysisReport,
  ServerHealthStatus,
  UploadedDocumentPayload,
} from './types/analysis';
import {
  createLegalContractSampleDocuments,
  createPoltekpinTestDocuments,
  createSampleDocuments,
  getCrossDomainSamplePresets,
  normalizeDocumentPayload,
} from './utils/documentParser';
import { runDeterministicAnalysis } from './utils/analysisEngine';

const STORAGE_CONSENT_KEY = 'documind_storage_consent_v1';
const STORAGE_HISTORY_KEY = 'documind_analysis_history_v1';

async function safeFetchJson<T>(
  url: string,
  options?: RequestInit
): Promise<{
  ok: boolean;
  status: number;
  data: T | null;
  rawText: string;
}> {
  const response = await fetch(url, options);
  const rawText = await response.text();
  let data: T | null = null;
  if (rawText) {
    try {
      data = JSON.parse(rawText) as T;
    } catch {
      data = null;
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    data,
    rawText,
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('upload');
  const [documents, setDocuments] = useState<UploadedDocumentPayload[]>([]);
  const [selectedMode, setSelectedMode] = useState<AnalysisModeId>('synthesis');
  const [customQuestion, setCustomQuestion] = useState<string>('');
  const [storageConsent, setStorageConsent] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_CONSENT_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [history, setHistory] = useState<AnalysisReport[]>(() => {
    try {
      if (localStorage.getItem(STORAGE_CONSENT_KEY) !== 'true') return [];
      const raw = localStorage.getItem(STORAGE_HISTORY_KEY);
      return raw ? (JSON.parse(raw) as AnalysisReport[]) : [];
    } catch {
      return [];
    }
  });
  const [activeReport, setActiveReport] = useState<AnalysisReport | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<ServerHealthStatus | null>(
    null
  );

  // Check backend server health on mount safely without throwing on non-JSON responses
  useEffect(() => {
    safeFetchJson<ServerHealthStatus>('/api/health')
      .then(({ ok, data }) => {
        if (ok && data && data.status === 'ok') {
          setServerStatus(data);
        } else {
          setServerStatus({
            status: 'ok',
            geminiConfigured: false,
            modelName: 'gemini-3.8-flash',
            storageMode:
              'Transient In-Memory (Persetujuan Pengguna untuk Riwayat)',
          });
        }
      })
      .catch(() => {
        setServerStatus({
          status: 'ok',
          geminiConfigured: false,
          modelName: 'gemini-3.8-flash',
          storageMode:
            'Transient In-Memory (Persetujuan Pengguna untuk Riwayat)',
        });
      });

    // Support ?autostart=1 | finance | legal | research | inventory | poltekpin
    const params = new URLSearchParams(window.location.search);
    const autostartParam = params.get('autostart');
    const modeParam = params.get('mode') as AnalysisModeId | null;
    const validMode: AnalysisModeId =
      modeParam &&
      ['synthesis', 'comparison', 'gap_analysis', 'estimation'].includes(
        modeParam
      )
        ? modeParam
        : 'synthesis';

    if (autostartParam) {
      const presets = getCrossDomainSamplePresets();
      const matchedPreset = presets.find((p) => p.id === autostartParam);
      if (matchedPreset) {
        const docs = matchedPreset.documents;
        const modeToRun = modeParam ? validMode : matchedPreset.recommendedMode;
        setDocuments(docs);
        setSelectedMode(modeToRun);
        setCustomQuestion('');
        setActivePresetId(matchedPreset.id);
        executeAnalysisRequest(docs, modeToRun, '');
      } else if (autostartParam === 'poltekpin') {
        const { documents: poltekpinDocs } = createPoltekpinTestDocuments();
        setDocuments(poltekpinDocs);
        setSelectedMode(validMode);
        setCustomQuestion('');
        executeAnalysisRequest(poltekpinDocs, validMode, '');
      } else if (autostartParam === '1') {
        const sampleDocs = createSampleDocuments();
        setDocuments(sampleDocs);
        setSelectedMode(validMode);
        setCustomQuestion('');
        executeAnalysisRequest(sampleDocs, validMode, '');
      }
    }
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [activeTab]);

  const handleToggleStorageConsent = (consent: boolean) => {
    setStorageConsent(consent);
    try {
      if (consent) {
        localStorage.setItem(STORAGE_CONSENT_KEY, 'true');
        localStorage.setItem(STORAGE_HISTORY_KEY, JSON.stringify(history));
      } else {
        localStorage.removeItem(STORAGE_CONSENT_KEY);
        localStorage.removeItem(STORAGE_HISTORY_KEY);
      }
    } catch {
      // Ignore storage quota errors
    }
  };

  const saveReportToHistory = (report: AnalysisReport, forceConsent = false) => {
    const effectiveConsent = storageConsent || forceConsent;
    if (forceConsent && !storageConsent) {
      setStorageConsent(true);
      try {
        localStorage.setItem(STORAGE_CONSENT_KEY, 'true');
      } catch {
        // Ignore
      }
    }

    setHistory((prev) => {
      const exists = prev.some((item) => item.id === report.id);
      const updated = exists ? prev : [report, ...prev];
      if (effectiveConsent) {
        try {
          localStorage.setItem(STORAGE_HISTORY_KEY, JSON.stringify(updated));
        } catch {
          // Ignore
        }
      }
      return updated;
    });
  };

  const handleAddDocuments = (newDocs: UploadedDocumentPayload[]) => {
    setErrorMessage(null);
    setDocuments((prev) => {
      const next = [...prev];
      for (const incoming of newDocs) {
        const existingIndex = next.findIndex((d) => d.name === incoming.name);
        if (existingIndex >= 0) {
          next[existingIndex] = incoming;
        } else {
          next.push(incoming);
        }
      }
      return next;
    });
  };

  const handleUpdateDocument = (
    id: string,
    patch: Partial<UploadedDocumentPayload>
  ) => {
    setDocuments((prev) =>
      prev.map((doc) => (doc.id === id ? { ...doc, ...patch } : doc))
    );
  };

  const handleRemoveDocument = (id: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== id));
  };

  const [activePresetId, setActivePresetId] = useState<string | null>(null);

  const handleClearDocuments = () => {
    setDocuments([]);
    setActivePresetId(null);
  };

  const handleLoadSamplePreset = (presetId: string) => {
    setErrorMessage(null);
    const presets = getCrossDomainSamplePresets();
    const matched = presets.find((p) => p.id === presetId) || presets[0];
    if (matched) {
      setDocuments(matched.documents);
      setSelectedMode(matched.recommendedMode);
      setCustomQuestion('');
      setActivePresetId(matched.id);
      setActiveTab('upload');
    }
  };

  const executeAnalysisRequest = async (
    docsToAnalyze: UploadedDocumentPayload[],
    modeToUse: AnalysisModeId,
    questionToUse: string
  ) => {
    if (docsToAnalyze.length === 0) {
      setErrorMessage(
        'Silakan unggah minimal satu dokumen PDF atau CSV terlebih dahulu, atau pilih salah satu Contoh Skenario untuk mencoba.'
      );
      return;
    }

    const normalizedDocs = docsToAnalyze.map(normalizeDocumentPayload);

    // Only block if ALL uploaded documents have zero readable text and no base64 payload
    const readableOrRecoverableDocs = normalizedDocs.filter(
      (d) =>
        d.extractionStatus !== 'failed_scanned_or_empty' &&
        ((d.extractedCharCount ?? d.textContent.trim().length) > 0 ||
          Boolean(d.base64Data))
    );
    if (readableOrRecoverableDocs.length === 0) {
      setErrorMessage(
        `Analisis dibatalkan: Seluruh dokumen yang diunggah ("${normalizedDocs.map((d) => d.name).join(', ')}") kosong atau gagal diekstrak.`
      );
      return;
    }

    setErrorMessage(null);
    setIsAnalyzing(true);

    try {
      let report: AnalysisReport | null = null;

      try {
        const { ok, status, data } = await safeFetchJson<{
          report?: AnalysisReport;
          error?: string;
        }>('/api/analyze', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            documents: normalizedDocs,
            analysisMode: modeToUse,
            customQuestion: questionToUse,
          }),
        });

        if (ok && data?.report) {
          report = data.report;
        } else if (data?.error && status >= 400 && status < 500 && status !== 404 && status !== 405) {
          throw new Error(data.error);
        }
      } catch (networkOrApiErr: unknown) {
        if (
          networkOrApiErr instanceof Error &&
          !networkOrApiErr.message.includes('Unexpected token') &&
          !networkOrApiErr.message.includes('Failed to fetch') &&
          !networkOrApiErr.message.includes('NetworkError') &&
          !networkOrApiErr.message.includes('Load failed') &&
          networkOrApiErr.message.startsWith('Format file')
        ) {
          throw networkOrApiErr;
        }
      }

      // Real-time fallback engine when /api/analyze is unavailable (e.g., static GitHub/Vercel deployment returning 404 "The page could not be found")
      if (!report) {
        report = runDeterministicAnalysis(
          normalizedDocs,
          modeToUse,
          questionToUse
        );
        report.engineNote =
          'Diproses secara Real-Time oleh Mesin Analisis Lintas Dokumen Universal.';
      }

      setActiveReport(report);
      if (storageConsent) {
        saveReportToHistory(report);
      }
      setActiveTab('results');
    } catch (err: unknown) {
      const rawMsg =
        err instanceof Error
          ? err.message
          : 'Terjadi kendala saat menganalisis dokumen. Silakan coba kembali.';
      const safeMsg = rawMsg.includes('Unexpected token')
        ? 'Terjadi kendala respons jaringan, silakan jalankan analisis kembali.'
        : rawMsg;
      setErrorMessage(safeMsg);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleRunAnalysis = () => {
    executeAnalysisRequest(documents, selectedMode, customQuestion);
  };

  const handleQuickLoadAndRun = () => {
    const sampleDocs = createSampleDocuments();
    setDocuments(sampleDocs);
    setSelectedMode('comparison');
    setCustomQuestion('');
    setActivePresetId('finance');
    executeAnalysisRequest(sampleDocs, 'comparison', '');
  };

  const handleLoadLegalSampleAndRun = () => {
    const { documents: legalDocs } = createLegalContractSampleDocuments();
    setDocuments(legalDocs);
    setSelectedMode('comparison');
    setCustomQuestion('');
    setActivePresetId('legal');
    executeAnalysisRequest(legalDocs, 'comparison', '');
  };

  const handleDeleteHistoryReport = (id: string) => {
    setHistory((prev) => {
      const updated = prev.filter((r) => r.id !== id);
      if (storageConsent) {
        try {
          localStorage.setItem(STORAGE_HISTORY_KEY, JSON.stringify(updated));
        } catch {
          // Ignore
        }
      }
      return updated;
    });
  };

  const handleClearAllHistory = () => {
    setHistory([]);
    try {
      localStorage.removeItem(STORAGE_HISTORY_KEY);
    } catch {
      // Ignore
    }
  };

  const isCurrentReportInHistory = Boolean(
    activeReport && history.some((r) => r.id === activeReport.id)
  );

  return (
    <div className="relative min-h-screen flex flex-col bg-[#06101a] text-slate-100 overflow-x-hidden">
      {/* Dynamic Ambient Background Animation Layer */}
      <div
        aria-hidden="true"
        className="no-print pointer-events-none fixed inset-0 z-0 overflow-hidden"
      >
        <div className="absolute inset-0 bg-architectural-grid opacity-80" />
        <div className="absolute -top-36 -left-24 h-[460px] w-[460px] rounded-full bg-teal-500/15 blur-[110px] animate-aurora-primary" />
        <div className="absolute top-1/4 -right-28 h-[500px] w-[500px] rounded-full bg-sky-500/12 blur-[125px] animate-aurora-secondary" />
        <div className="absolute -bottom-32 left-1/3 h-[420px] w-[540px] rounded-full bg-emerald-500/10 blur-[120px] animate-aurora-tertiary" />
        <div className="absolute inset-x-0 top-0 h-[520px] bg-gradient-to-r from-teal-500/5 via-sky-400/10 to-transparent blur-3xl animate-beam-sweep" />
        <div className="absolute inset-0 bg-radial-vignette" />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col">
        <Navbar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          hasActiveReport={Boolean(activeReport)}
          historyCount={history.length}
          onQuickLoadSample={handleQuickLoadAndRun}
        />

        <main className="flex-1">
          {activeTab === 'upload' && (
            <UploadWorkspace
              documents={documents}
              onAddDocuments={(newDocs) => {
                handleAddDocuments(newDocs);
                setActivePresetId(null);
              }}
              onUpdateDocument={handleUpdateDocument}
              onRemoveDocument={handleRemoveDocument}
              onClearDocuments={handleClearDocuments}
              onLoadSamplePreset={handleLoadSamplePreset}
              activePresetId={activePresetId}
              selectedMode={selectedMode}
              onSelectMode={setSelectedMode}
              customQuestion={customQuestion}
              onChangeQuestion={setCustomQuestion}
              storageConsent={storageConsent}
              onToggleStorageConsent={handleToggleStorageConsent}
              onRunAnalysis={handleRunAnalysis}
              isAnalyzing={isAnalyzing}
              errorMessage={errorMessage}
              onDismissError={() => setErrorMessage(null)}
            />
          )}

          {activeTab === 'results' && (
            <AnalysisResultsView
              report={activeReport}
              onBackToUpload={() => setActiveTab('upload')}
              onSaveToHistory={(rep) => saveReportToHistory(rep, true)}
              isSavedInHistory={isCurrentReportInHistory}
              onLoadSampleAndAnalyze={handleQuickLoadAndRun}
              onLoadLegalSampleAndAnalyze={handleLoadLegalSampleAndRun}
            />
          )}

          {activeTab === 'history' && (
            <HistoryView
              history={history}
              storageConsent={storageConsent}
              onToggleStorageConsent={handleToggleStorageConsent}
              onOpenReport={(rep) => {
                setActiveReport(rep);
                setActiveTab('results');
              }}
              onDeleteReport={handleDeleteHistoryReport}
              onClearAllHistory={handleClearAllHistory}
              onGoToUpload={() => setActiveTab('upload')}
            />
          )}

          {activeTab === 'guide' && (
            <SystemGuideView
              serverStatus={serverStatus}
              onRunQuickDemo={handleQuickLoadAndRun}
            />
          )}
        </main>

        <footer className="no-print border-t border-slate-900/90 bg-[#050d16]/85 backdrop-blur-md py-4 text-xs text-slate-400">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6">
            <p className="font-semibold text-slate-300">DocuMind AI</p>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setActiveTab('upload')}
                className="hover:text-teal-300 transition-colors cursor-pointer"
              >
                Unggah
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className="hover:text-teal-300 transition-colors cursor-pointer"
              >
                Riwayat
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('guide')}
                className="hover:text-teal-300 transition-colors cursor-pointer"
              >
                Panduan
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
