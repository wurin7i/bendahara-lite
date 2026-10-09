// Kantong patungan: akun kas khusus milik satu kegiatan patungan.
//
// Kantong disimpan di sheet "Akun Kas" seperti akun lain, tetapi ID-nya berawalan "ktp_". Saat dimuat, kantong
// dipisahkan dari kantong utama (data.accounts) ke data.pockets, sehingga seluruh logika mode Sederhana/Multi
// (satu akun aktif, akun utama, alokasi periode) tidak pernah melihatnya. Tanpa kolom baru di "Akun Kas", buku lama
// tidak perlu migrasi header.

export const POCKET_PREFIX = 'ktp';

export const isPocketId = (id) => String(id ?? '').startsWith(`${POCKET_PREFIX}_`);

/** Pisahkan akun kas menjadi kantong utama dan kantong patungan. */
export function splitAccounts(accounts) {
  const main = [];
  const pockets = [];
  for (const a of accounts) (isPocketId(a.id) ? pockets : main).push(a);
  return { accounts: main, pockets };
}

/** Pisahkan baris buku kas: mutasi kantong utama (termasuk Umum) dan mutasi kantong patungan. */
export function splitLines(lines, pockets) {
  const ids = new Set(pockets.map((p) => p.id));
  const main = [];
  const pocket = [];
  for (const l of lines) (ids.has(l.accountId) ? pocket : main).push(l);
  return { main, pocket };
}

/**
 * Kantong yang masih perlu tampil di pilihan akun: patungannya masih buka, atau saldonya belum nol
 * (sisa yang perlu dipakai atau dipindahkan). Kantong tanpa patungan (dihapus) hanya tampil bila masih bersaldo.
 * @param {object[]} pockets
 * @param {object[]} collections
 * @param {Map<string, number>} balances accountId -> saldo saat ini
 */
export function visiblePockets(pockets, collections, balances) {
  const byAccount = new Map(collections.map((c) => [c.accountId, c]));
  return pockets.filter((p) => {
    const balance = balances.get(p.id) ?? 0;
    if (balance !== 0) return true;
    const collection = byAccount.get(p.id);
    return Boolean(p.active && collection && !collection.closed);
  });
}
