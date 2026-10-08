import { useState } from 'react';
import { useApp } from '../state/AppContext.jsx';

/** Status sinkronisasi daftar buku ke Google Drive (atau alasan hanya tersimpan di browser). */
export function DriveNotice() {
  const { driveStatus, actions } = useApp();
  const [busy, setBusy] = useState(false);
  if (!driveStatus) return null;

  if (driveStatus.state === 'ok') {
    return <p className="hint">Daftar buku tersimpan di akun Google Anda dan ikut ke semua perangkat.</p>;
  }

  const reasons = {
    'no-scope': (
      <>
        Izin penyimpanan di Google Drive belum diberikan. Keluar, lalu masuk lagi dan centang izin tersebut agar daftar
        ikut ke semua perangkat.
      </>
    ),
    'api-disabled': (
      <>
        Google menjawab bahwa <strong>Google Drive API belum aktif</strong> di proyek Google Cloud pemilik Client ID
        aplikasi ini. Aktifkan di proyek yang <em>sama</em> dengan Client ID (lihat README), tunggu beberapa menit, lalu
        coba lagi. Aplikasi tetap bisa dipakai seperti biasa.
      </>
    ),
    error: <>Sinkronisasi ke Google Drive sementara gagal ({driveStatus.message}).</>,
  };

  async function retry() {
    setBusy(true);
    await actions.refreshBooks();
    setBusy(false);
  }

  return (
    <div className="notice warn small" role="status">
      Daftar buku hanya diingat di <strong>browser ini</strong>. {reasons[driveStatus.state]}
      {driveStatus.detail && (
        <div style={{ marginTop: '0.4rem' }}>
          <span className="muted">Pesan dari Google: </span>
          <code style={{ wordBreak: 'break-word' }}>{driveStatus.detail}</code>
        </div>
      )}
      <div style={{ marginTop: '0.5rem' }}>
        <button type="button" className="btn small" onClick={retry} disabled={busy}>
          {busy ? 'Memeriksa…' : 'Coba lagi'}
        </button>
      </div>
    </div>
  );
}

export const bookLabel = (book) => book.title || `Buku ${book.id.slice(0, 6)}…`;
