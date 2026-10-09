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
