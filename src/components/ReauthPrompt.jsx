import { useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { Modal } from './ui.jsx';

/**
 * Tampil saat token Google habis (batas ~1 jam dari Google). Satu ketukan melanjutkan sesi tanpa kehilangan halaman
 * atau isian; permintaan yang sedang menunggu (mis. Simpan) otomatis dilanjutkan. Memakai <dialog> modal sehingga
 * tetap bisa diketuk walau dialog lain (form) sedang terbuka.
 */
export function ReauthPrompt() {
  const { session, reauth, reauthError, actions } = useApp();
  const [busy, setBusy] = useState(false);
  if (!session || !reauth) return null;

  async function renew() {
    setBusy(true);
    await actions.renewSession();
    setBusy(false);
  }

  return (
    <Modal title="Sesi Google habis">
      <p>
        Akses ke Google Spreadsheet berlaku sekitar 1 jam. Ketuk <strong>Lanjutkan</strong> untuk melanjutkan sebagai{' '}
        <strong>{session.user.email}</strong>. Halaman dan isian Anda tidak hilang.
      </p>
      {reauthError && <div className="notice error small" role="alert">{reauthError}</div>}
      <div className="modal-actions">
        <button type="button" className="btn left" onClick={actions.signOut} disabled={busy}>Keluar</button>
        <button type="button" className="btn primary" onClick={renew} disabled={busy} autoFocus>
          {busy ? 'Menunggu Google…' : 'Lanjutkan'}
        </button>
      </div>
    </Modal>
  );
}
