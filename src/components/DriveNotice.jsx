import { useApp } from '../state/AppContext.jsx';

/** Status sinkronisasi daftar buku ke Google Drive (atau alasan hanya tersimpan di browser). */
export function DriveNotice() {
  const { driveStatus } = useApp();
  if (!driveStatus) return null;

  switch (driveStatus.state) {
    case 'ok':
      return <p className="hint">Daftar buku tersimpan di akun Google Anda dan ikut ke semua perangkat.</p>;
    case 'no-scope':
      return (
        <div className="notice warn small" role="status">
          Daftar buku hanya diingat di <strong>browser ini</strong> karena izin penyimpanan di Google Drive belum diberikan.
          Keluar, lalu masuk lagi dan centang izin tersebut agar daftar ikut ke semua perangkat.
        </div>
      );
    case 'api-disabled':
      return (
        <div className="notice warn small" role="status">
          Daftar buku hanya diingat di <strong>browser ini</strong>: Google Drive API belum diaktifkan di proyek Google
          Cloud Anda (lihat README). Aplikasi tetap bisa dipakai seperti biasa.
        </div>
      );
    default:
      return (
        <div className="notice warn small" role="status">
          Daftar buku sementara tidak bisa disinkronkan ke Google Drive ({driveStatus.message}); untuk sementara hanya
          diingat di <strong>browser ini</strong>.
        </div>
      );
  }
}

export const bookLabel = (book) => book.title || `Buku ${book.id.slice(0, 6)}…`;
