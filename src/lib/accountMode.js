// Mode pencatatan akun kas.
//
//  - Sederhana : satu akun kas untuk seluruh iuran (bawaan). Tidak ada alokasi per akun, pindah saldo, atau urutan.
//  - Multi akun: beberapa akun ("kantong"), iuran dibagi menurut alokasi periode dan urutan akun (prioritas).
//
// Mode disimpan di sheet Info (kunci `account_mode`). Akun tidak pernah dihapus, hanya dinonaktifkan, sehingga buku
// yang pernah Multi bisa kembali ke Sederhana bila tinggal satu akun aktif; akun nonaktifnya tetap ada di riwayat.

export const ACCOUNT_MODES = ['simple', 'multi'];
export const MODE_INFO_KEY = 'account_mode';
export const MODE_LABELS = { simple: 'Sederhana', multi: 'Multi akun kas' };

/** Mode tersimpan; buku lama tanpa kunci: Multi bila akun > 1, selain itu Sederhana. */
export function resolveAccountMode(info, accounts) {
  const stored = info?.[MODE_INFO_KEY];
  if (ACCOUNT_MODES.includes(stored)) return stored;
  return accounts.length > 1 ? 'multi' : 'simple';
}

/** Nama bawaan akun tunggal, mis. "Iuran Kas RT 05". */
export const defaultAccountName = (org) => `Iuran ${String(org ?? '').trim()}`.trim();

/** Akun yang dipakai mode Sederhana: aktif pertama menurut urutan, atau akun pertama bila semuanya nonaktif. */
export const primaryAccount = (accounts) => accounts.find((a) => a.active) ?? accounts[0] ?? null;

/* ---------- baris draf form (akun yang sedang diedit) ---------- */
// { key, id?, name, openingBalance, note, active }  — `id` kosong = akun baru yang belum tersimpan.

export const rowsFromAccounts = (accounts) =>
  accounts.map((a) => ({
    key: a.id, id: a.id, name: a.name, openingBalance: a.openingBalance, note: a.note, active: a.active,
  }));

const isFilled = (row) => Boolean(row.id || row.name.trim());

/** Baris yang dipakai mode Sederhana: aktif pertama, lalu akun tersimpan pertama, lalu baris baru yang terisi. */
export const pickPrimaryRow = (rows) =>
  rows.find((r) => r.active && isFilled(r)) ?? rows.find((r) => r.id) ?? rows.find(isFilled) ?? null;

/** Tukar ke Sederhana hanya boleh bila paling banyak satu baris aktif (nonaktifkan yang lain dulu). */
export const canSwitchToSimple = (rows) => rows.filter((r) => r.active && isFilled(r)).length <= 1;

/** Susunan baris saat masuk mode Sederhana: semua akun tersimpan tetap ada, baris baru selain utama dibuang. */
export function collapseToSimple(rows) {
  const primary = pickPrimaryRow(rows);
  return rows.filter((r) => r.id || r === primary);
}

/** Pesan galat untuk draf form, atau null bila bisa disimpan. */
export function validateAccountRows(rows, mode) {
  if (mode === 'simple') {
    const primary = pickPrimaryRow(rows);
    if (!primary || !primary.name.trim()) return 'Nama akun kas wajib diisi.';
    if (rows.some((r) => r !== primary && r.active && isFilled(r))) {
      return 'Mode Sederhana hanya punya satu akun aktif. Nonaktifkan akun lain atau pilih mode Multi akun kas.';
    }
    return null;
  }
  const filled = rows.filter(isFilled);
  if (filled.length === 0) return 'Isi minimal satu akun kas.';
  if (filled.some((r) => !r.name.trim())) return 'Nama akun kas wajib diisi.';
  return null;
}

const money = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v) || 0);

/**
 * Ubah draf menjadi operasi tulis. Urutan (`order`) mengikuti urutan baris pada draf, termasuk akun tersimpan yang
 * disembunyikan di mode Sederhana. Hanya akun yang benar-benar berubah yang masuk `toUpdate`.
 * @returns {{ toUpdate: object[], toAdd: object[] }}
 */
export function planAccountSave(rows, accounts, mode) {
  const error = validateAccountRows(rows, mode);
  if (error) throw new Error(error);

  const primary = mode === 'simple' ? pickPrimaryRow(rows) : null;
  const kept = rows.filter((r) => (mode === 'simple' ? r.id || r === primary : isFilled(r)));
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const toUpdate = [];
  const toAdd = [];
  kept.forEach((row, index) => {
    const next = {
      name: row.name.trim(),
      openingBalance: money(row.openingBalance),
      note: row.note.trim(),
      active: mode === 'simple' && row === primary ? true : row.active,
      order: index + 1,
    };
    const original = row.id ? byId.get(row.id) : null;
    if (row.id && !original) throw new Error('Akun kas sudah tidak ada di spreadsheet. Muat ulang data lalu ulangi.');
    if (!original) {
      toAdd.push(next);
    } else if (Object.keys(next).some((k) => original[k] !== next[k])) {
      toUpdate.push({ ...original, ...next });
    }
  });
  return { toUpdate, toAdd };
}
