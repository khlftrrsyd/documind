export default function handler(
  _req: unknown,
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    json?: (body: unknown) => void;
  }
) {
  const key = process.env.GEMINI_API_KEY?.trim();
  const geminiConfigured = Boolean(
    key && key !== 'MY_GEMINI_API_KEY' && key.length > 10
  );

  const payload = {
    status: 'ok',
    geminiConfigured,
    modelName: 'gemini-3.8-flash',
    storageMode: 'Transient In-Memory (Persetujuan Pengguna untuk Riwayat)',
  };

  if (typeof res.status === 'function') {
    res.status(200).json(payload);
  } else if (typeof res.json === 'function') {
    res.json(payload);
  }
}
