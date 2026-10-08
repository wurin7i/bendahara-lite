// Konfigurasi build-time (lihat .env.example).
export const config = {
  clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '',
  defaultSpreadsheetId: import.meta.env.VITE_SPREADSHEET_ID ?? '',
  // Mode demo (vite --mode demo) memakai Google palsu di dalam browser. Tidak ikut di build produksi.
  demo: import.meta.env.MODE === 'demo',
  // Mode demo & sungguhan bisa berjalan di origin yang sama (localhost:5173); awalan terpisah mencegah
  // sesi/spreadsheet palsu dari demo terbawa ke mode sungguhan (dan sebaliknya).
  storagePrefix: import.meta.env.MODE === 'demo' ? 'bendahara-demo' : 'bendahara',
};
