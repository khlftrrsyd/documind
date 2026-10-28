import {
  AnalysisModeId,
  UploadedDocumentPayload,
} from '../src/types/analysis';
import {
  humanizeAnalysisReport,
  runDeterministicAnalysis,
} from '../src/utils/analysisEngine';
import {
  chunkDocumentSections,
  normalizeDocumentPayload,
} from '../src/utils/documentParser';

export default async function handler(
  req: {
    method?: string;
    body?: {
      documents?: UploadedDocumentPayload[];
      analysisMode?: AnalysisModeId;
      customQuestion?: string;
    } | string;
  },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
  }
) {
  if (req.method && req.method !== 'POST') {
    res.status(405).json({ error: 'Metode tidak didukung. Gunakan POST.' });
    return;
  }

  try {
    const parsedBody =
      typeof req.body === 'string'
        ? (JSON.parse(req.body) as {
            documents?: UploadedDocumentPayload[];
            analysisMode?: AnalysisModeId;
            customQuestion?: string;
          })
        : req.body || {};

    const rawDocuments = parsedBody.documents;
    const analysisMode: AnalysisModeId = parsedBody.analysisMode || 'synthesis';
    const customQuestion = (parsedBody.customQuestion || '').trim();

    if (!Array.isArray(rawDocuments) || rawDocuments.length === 0) {
      res.status(400).json({
        error:
          'Tidak ada dokumen yang dikirim ke server. Silakan unggah minimal satu dokumen berformat PDF atau CSV terlebih dahulu.',
      });
      return;
    }

    const verifiedDocuments = rawDocuments.map((doc) => {
      const normalized = normalizeDocumentPayload(doc);
      return {
        ...normalized,
        sections: chunkDocumentSections(
          normalized.sections || normalized.parsedSections || [],
          3200
        ),
      };
    });

    const report = humanizeAnalysisReport(
      runDeterministicAnalysis(verifiedDocuments, analysisMode, customQuestion)
    );
    report.engineNote =
      'Diproses secara Real-Time oleh Pipeline Analisis Lintas Dokumen Universal.';

    res.status(200).json({ report });
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : 'Terjadi kesalahan saat menganalisis dokumen.';
    res.status(500).json({
      error: `Gagal menganalisis dokumen: ${message}`,
    });
  }
}
