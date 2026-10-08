import { expect } from '@playwright/test';

/** Tanggal tetap supaya status tunggakan deterministik: 8 Okt 2026. */
export async function freezeClock(page) {
  await page.clock.setFixedTime(new Date('2026-10-08T10:00:00+07:00'));
}

export async function loginAndCreateSheet(page, title = 'Kas Uji') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Masuk dengan Google' }).click();
  await expect(page.getByRole('heading', { name: 'Pilih spreadsheet' })).toBeVisible();
  await page.getByLabel('Nama spreadsheet').fill(title);
  await page.getByRole('button', { name: 'Buat spreadsheet baru' }).click();
  await expect(page.getByRole('navigation', { name: 'Menu utama' })).toBeVisible();
}

export const nav = (page, name) => page.getByRole('navigation', { name: 'Menu utama' }).getByRole('link', { name }).click();

export async function saveDialog(page, name = 'Simpan') {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name, exact: true }).click();
  await expect(dialog).toBeHidden();
}

export async function addAccount(page, name, opening) {
  await nav(page, 'Pengaturan');
  await page.getByRole('button', { name: '+ Tambah akun' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nama akun').fill(name);
  if (opening) await dialog.getByLabel('Saldo awal').fill(String(opening));
  await saveDialog(page);
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
