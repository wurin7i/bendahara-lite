// Konfigurasi build-time (lihat .env.example).
export const config = {
  clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '',
  defaultSpreadsheetId: import.meta.env.VITE_SPREADSHEET_ID ?? '',
  // Mode demo (vite --mode demo) memakai Google palsu di dalam browser. Tidak ikut di build produksi.
  demo: import.meta.env.MODE === 'demo',
};
