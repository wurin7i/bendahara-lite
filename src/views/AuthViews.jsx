import { useState } from 'react';
import { DriveNotice, bookLabel } from '../components/DriveNotice.jsx';
import { BrandMark, ConfirmButton, Spinner } from '../components/ui.jsx';
import { TABLES } from '../google/schema.js';
import { useApp } from '../state/AppContext.jsx';

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 6.9-10 6.9-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

export function LoginView() {
  const { actions, loginError, config } = useApp();
  const [busy, setBusy] = useState(false);
  const missingClientId = !config.clientId && !config.demo;

  async function onClick() {
    setBusy(true);
    await actions.signIn();
    setBusy(false);
  }

  return (
    <div className="center-screen">
      <div className="card auth-card">
        <BrandMark size={48} />
        <h1>Bendahara Lite</h1>
        <p className="muted">Pencatat kas iuran bulanan. Data tersimpan di Google Spreadsheet milik Anda sendiri.</p>

        {config.demo && (
          <div className="notice warn">
            <strong>Mode demo.</strong> Login Google dan spreadsheet dipalsukan di browser ini.
          </div>
        )}
        {missingClientId ? (
          <div className="notice error" role="alert">
            <strong>Google Client ID belum diatur.</strong> Isi <code>VITE_GOOGLE_CLIENT_ID</code> pada file{' '}
            <code>.env</code> lalu jalankan ulang aplikasi. Langkah lengkap ada di README.
          </div>
        ) : (
          <button type="button" className="btn google-btn" onClick={onClick} disabled={busy}>
            {busy ? <span className="spinner" aria-hidden="true" /> : <GoogleG />}
            Masuk dengan Google
          </button>
        )}
        {loginError && (
          <div className="notice error" role="alert" style={{ marginTop: '0.9rem', marginBottom: 0 }}>{loginError}</div>
        )}
        <p className="hint" style={{ marginTop: '1rem' }}>
          Aplikasi hanya meminta izin membaca dan menulis Google Spreadsheet. Hak akses ke data mengikuti pengaturan
          berbagi (Share) spreadsheet di Google.
        </p>
      </div>
    </div>
  );
}

function AccountBar() {
  const { user, actions } = useApp();
  return (
    <p className="small muted" style={{ textAlign: 'center', marginTop: '1rem' }}>
      Masuk sebagai <strong>{user.email}</strong> ·{' '}
      <button type="button" className="btn small ghost" onClick={actions.signOut}>Keluar</button>
    </p>
  );
}

export function SetupView() {
  const { actions, books, sheetId, data, bookTitle } = useApp();
  const [title, setTitle] = useState('Kas Bendahara');
  const [existing, setExisting] = useState('');
  const hasActive = Boolean(data); // ada buku yang sedang berjalan untuk kembali
  const sorted = [...books].sort((a, b) => bookLabel(a).localeCompare(bookLabel(b), 'id', { sensitivity: 'base' }));

  return (
    <div className="center-screen">
      <div style={{ width: 'min(34rem, 100%)' }}>
        <div className="card">
          <h1>Pilih buku kas</h1>
          <p className="muted">
            Satu <strong>buku</strong> adalah satu Google Spreadsheet untuk satu organisasi atau kelompok, lengkap dengan
            anggota, akun kas, dan riwayatnya. Anda bisa mengelola beberapa buku dan berpindah di antaranya.
          </p>

          {sorted.length > 0 && (
            <>
              <h2 style={{ margin: '1rem 0 0.5rem' }}>Buku Anda</h2>
              <ul className="pay-list" aria-label="Daftar buku">
                {sorted.map((b) => {
                  const active = hasActive && b.id === sheetId;
                  return (
                    <li key={b.id}>
                      <div className="grow">
                        <strong>{bookLabel(b)}</strong>
                        {active && <span className="tag in">aktif</span>}
                      </div>
                      {active ? (
                        <button type="button" className="btn small" onClick={actions.closeSetup}>Kembali</button>
                      ) : (
                        <>
                          <button type="button" className="btn small primary" onClick={() => actions.switchBook(b.id)}>Buka</button>
                          <ConfirmButton onConfirm={() => actions.forgetBook(b.id)} confirmLabel="Hapus dari daftar?">
                            Hapus
                          </ConfirmButton>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="hint">“Hapus” hanya mengeluarkan buku dari daftar ini. Spreadsheet-nya tetap ada di Google Drive.</p>
            </>
          )}
          <DriveNotice />
        </div>

        <div className="card">
          <h2 style={{ marginBottom: '0.5rem' }}>Buat buku baru</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              actions.createNew(title);
            }}
          >
            <label className="field">
              <span className="label">Nama spreadsheet</span>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="mis. Kas RT 05" />
            </label>
            <button type="submit" className="btn primary">Buat buku baru</button>
          </form>
        </div>

        <div className="card">
          <h2 style={{ marginBottom: '0.5rem' }}>Hubungkan spreadsheet yang sudah ada</h2>
          <p className="muted small">
            Untuk bergabung ke kas yang sudah berjalan, tempel URL spreadsheet. Pemilik harus lebih dulu membagikannya
            (Share) ke email Anda sebagai <strong>Editor</strong> agar bisa mencatat, atau <strong>Viewer</strong> untuk
            hanya melihat.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              actions.connectExisting(existing);
            }}
          >
            <label className="field">
              <span className="label">URL atau ID spreadsheet</span>
              <input
                type="text"
                value={existing}
                placeholder="https://docs.google.com/spreadsheets/d/…"
                onChange={(e) => setExisting(e.target.value)}
              />
            </label>
            <button type="submit" className="btn" disabled={!existing.trim()}>Hubungkan</button>
          </form>
        </div>

        {hasActive && (
          <p style={{ textAlign: 'center', marginTop: '1rem' }}>
            <button type="button" className="btn" onClick={actions.closeSetup}>← Kembali ke {bookTitle || 'buku aktif'}</button>
          </p>
        )}
        <AccountBar />
      </div>
    </div>
  );
}

export function NeedInitView() {
  const { initInfo, actions } = useApp();
  const names = [...initInfo.state.missing, ...initInfo.state.emptyHeader].map((k) => TABLES[k].sheet);
  return (
    <div className="center-screen">
      <div className="card auth-card">
        <h1>Siapkan spreadsheet?</h1>
        <p>
          Spreadsheet <strong>{initInfo.state.title}</strong> belum berisi struktur Bendahara Lite. Aplikasi akan
          menambahkan sheet berikut dan <strong>tidak mengubah sheet yang sudah ada</strong>:
        </p>
        <p><code>{names.join(', ')}</code></p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={actions.openSetup}>Batal</button>
          <button type="button" className="btn primary" onClick={actions.confirmInit}>Siapkan sekarang</button>
        </div>
      </div>
    </div>
  );
}

export function ErrorView() {
  const { fatal, actions } = useApp();
  return (
    <div className="center-screen">
      <div className="card auth-card">
        <h1>Tidak bisa membuka data</h1>
        <div className="notice error" role="alert" style={{ marginTop: '0.75rem' }}>{fatal}</div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={actions.openSetup}>Kelola buku</button>
          <button type="button" className="btn primary" onClick={actions.retry}>Coba lagi</button>
        </div>
        <AccountBar />
      </div>
    </div>
  );
}

export function LoadingView() {
  return (
    <div className="center-screen">
      <Spinner label="Memuat data dari Google Spreadsheet…" />
    </div>
  );
}
