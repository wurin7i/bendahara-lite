export class ApiError extends Error {
  constructor(message, { status = 0, method = 'GET', reason = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.method = method;
    this.reason = reason;
  }
}

/** Token tidak ada / kedaluwarsa / dicabut: pengguna perlu masuk lagi. */
export class AuthError extends Error {
  constructor(message = 'Sesi berakhir') {
    super(message);
    this.name = 'AuthError';
  }
}

/** Data di spreadsheet berubah (mis. baris dihapus orang lain) sejak terakhir dibaca. */
export class ConflictError extends Error {
  constructor(message = 'Data di spreadsheet telah berubah.') {
    super(message);
    this.name = 'ConflictError';
  }
}

/** Struktur sheet tidak sesuai skema aplikasi. */
export class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SchemaError';
  }
}

/** Pesan ramah untuk ditampilkan ke pengguna. */
export function friendlyMessage(err) {
  if (err instanceof AuthError) return 'Sesi Google Anda berakhir. Silakan masuk kembali.';
  if (err instanceof ConflictError) return `${err.message} Data akan dimuat ulang, silakan ulangi.`;
  if (err instanceof SchemaError) return err.message;
  if (err instanceof ApiError) {
    const detail = err.message || '';
    switch (err.status) {
      case 0:
        return 'Tidak dapat terhubung ke Google. Periksa koneksi internet Anda.';
      case 400:
        return `Permintaan ditolak Google: ${detail}`;
      case 401:
        return 'Sesi Google Anda berakhir. Silakan masuk kembali.';
      case 403:
        if (/has not been used|is disabled|accessNotConfigured/i.test(`${detail} ${err.reason}`)) {
          return 'Google Sheets API belum diaktifkan di proyek Google Cloud Anda (lihat README, langkah 2).';
        }
        return err.method === 'GET'
          ? 'Akun Google ini tidak punya akses ke spreadsheet. Minta pemilik membagikannya ke email Anda.'
          : 'Akun Google ini hanya punya akses baca pada spreadsheet, sehingga tidak bisa menyimpan perubahan.';
      case 404:
        return 'Spreadsheet tidak ditemukan. Periksa kembali URL atau ID-nya.';
      case 429:
        return 'Terlalu banyak permintaan ke Google. Tunggu sebentar lalu coba lagi.';
      default:
        return `Google mengembalikan kesalahan (${err.status}): ${detail}`;
    }
  }
  return err?.message || 'Terjadi kesalahan tak terduga.';
}
