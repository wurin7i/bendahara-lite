import { expect } from '@playwright/test';

/** Tanggal tetap supaya status tunggakan deterministik: 8 Okt 2026. */
export async function freezeClock(page) {
  await page.clock.setFixedTime(new Date('2026-10-08T10:00:00+07:00'));
}

export async function loginAndCreateSheet(page, title = 'Kas Uji') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Masuk dengan Google' }).click();
  await expect(page.getByRole('heading', { name: 'Pilih buku kas' })).toBeVisible();
  await page.getByLabel('Nama spreadsheet').fill(title);
  await page.getByRole('button', { name: 'Buat buku baru' }).click();
  await expect(page.getByRole('navigation', { name: 'Menu utama' })).toBeVisible();
}

export const nav = (page, name) => page.getByRole('navigation', { name: 'Menu utama' }).getByRole('link', { name }).click();

export async function saveDialog(page, name = 'Simpan') {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name, exact: true }).click();
  await expect(dialog).toBeHidden();
}

/**
 * Isi kartu "Kas & akun kas" di Pengaturan lalu simpan. accounts: [{ name, opening? }].
 * mode 'multi' menukar mode dulu dan memakai baris berulang; 'simple' (bawaan) hanya satu akun.
 */
export async function setupAccounts(page, accounts, { mode = 'simple', org } = {}) {
  await nav(page, 'Pengaturan');
  if (org !== undefined) await page.getByLabel('Nama kas / organisasi').fill(org);
  const multi = mode === 'multi';
  if (multi && (await page.getByRole('button', { name: '+ Tambah akun' }).count()) === 0) {
    await page.getByRole('button', { name: 'Tukar mode' }).click();
  }
  for (const [i, account] of accounts.entries()) {
    const suffix = multi ? ` ${i + 1}` : '';
    if (multi && i > 0) await page.getByRole('button', { name: '+ Tambah akun' }).click();
    await page.getByLabel(`Nama akun${suffix}`, { exact: true }).fill(account.name);
    if (account.opening) await page.getByLabel(`Saldo awal${suffix}`, { exact: true }).fill(String(account.opening));
  }
  const save = page.getByRole('button', { name: 'Simpan', exact: true });
  await save.click();
  await expect(save).toBeDisabled(); // tersimpan: tidak ada perubahan tersisa
}

/** Buat periode Jul 2026 dengan iuran 100.000. allocations: { 'Kas Kelas': 50000, ... } */
export async function addPeriod(page, { startMonth = 'Juli', startYear = '2026', fee = '100000', allocations = {} }) {
  await nav(page, 'Pengaturan');
  await page.getByRole('button', { name: '+ Tambah periode' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Bulan mulai: nama bulan').selectOption({ label: startMonth });
  await dialog.getByLabel('Bulan mulai: tahun').selectOption(startYear);
  await dialog.getByLabel('Iuran per anggota per bulan').fill(fee);
  for (const [name, amount] of Object.entries(allocations)) {
    await dialog.getByLabel(name, { exact: true }).fill(String(amount));
  }
  return dialog;
}

export async function addMembers(page, names) {
  await nav(page, 'Anggota');
  await page.getByRole('button', { name: 'Tambah banyak' }).click();
  await page.getByLabel('Satu nama per baris').fill(names.join('\n'));
  await page.getByRole('dialog').getByRole('button', { name: /^Tambahkan/ }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

export async function pay(page, member, monthLabel, amount) {
  await page.getByRole('button', { name: new RegExp(`^${member}, ${monthLabel}:`) }).click();
  const dialog = page.getByRole('dialog');
  if (amount !== undefined) await dialog.getByLabel('Jumlah', { exact: true }).fill(String(amount));
  await dialog.getByRole('button', { name: 'Simpan pembayaran' }).click();
  await expect(dialog).toBeHidden();
}

/**
 * Tunggu penulisan daftar buku ke Drive (berjalan di latar setelah buku dibuka) selesai.
 * Penting bagi tes yang menyisipkan kegagalan: kalau penulisan masih berjalan, kegagalan itu termakan olehnya.
 */
export async function waitForDriveSynced(page, bookTitle, email = 'bendahara.demo@example.com') {
  await expect
    .poll(
      () =>
        page.evaluate((e) => {
          const file = window.__fakeGoogle.dumpDrive(e)[0]?.content;
          return file?.books?.find((b) => b.id === file.current)?.title ?? null;
        }, email),
      { message: `Drive belum memuat buku aktif "${bookTitle}"` },
    )
    .toBe(bookTitle);
}
