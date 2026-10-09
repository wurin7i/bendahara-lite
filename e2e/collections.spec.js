import { expect, test } from '@playwright/test';
import {
  addMembers, addPeriod, freezeClock, loginAndCreateSheet, nav, saveDialog, setupAccounts,
} from './helpers.js';

test.beforeEach(async ({ page }) => {
  await freezeClock(page);
});

const sheetTitles = (page) => page.evaluate(() => {
  const server = window.__fakeGoogle;
  return server.sheetTitles(server.spreadsheetIds()[0]);
});
const sheetRows = (page, sheet) =>
  page.evaluate((name) => {
    const server = window.__fakeGoogle;
    return server.dump(server.spreadsheetIds()[0], name).slice(1);
  }, sheet);
const menu = (page) => page.getByRole('navigation', { name: 'Menu utama' });
const stat = (page, label) => page.locator('.stat', { hasText: label });

async function enableCollections(page) {
  await nav(page, 'Pengaturan');
  await page.getByRole('button', { name: 'Aktifkan', exact: true }).click();
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Fitur tambahan' }) });
  await expect(card.getByRole('link', { name: 'Buka Patungan' })).toBeVisible();
  await expect(menu(page).getByRole('link', { name: 'Patungan' })).toBeVisible();
}

async function newCollection(page, { name, voluntary = false, amount, target, exclude = [] }) {
  await nav(page, 'Patungan');
  await page.getByRole('button', { name: '+ Patungan baru' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nama patungan').fill(name);
  if (voluntary) await dialog.getByText('Sukarela', { exact: true }).click();
  if (amount !== undefined) await dialog.getByLabel('Besaran per anggota').fill(String(amount));
  if (target !== undefined) await dialog.getByLabel('Target dana').fill(String(target));
  if (exclude.length) {
    await dialog.getByText(/^Peserta:/).click();
    for (const member of exclude) await dialog.getByRole('checkbox', { name: member }).uncheck();
  }
  await saveDialog(page, 'Simpan patungan');
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(`^${name}`) })).toBeVisible();
}

async function contribute(page, member, amount) {
  await page.getByRole('button', { name: `Catat setoran ${member}` }).click();
  const dialog = page.getByRole('dialog');
  if (amount !== undefined) await dialog.getByLabel('Jumlah', { exact: true }).fill(String(amount));
  await dialog.getByRole('button', { name: 'Simpan setoran' }).click();
  await expect(dialog).toBeHidden();
}

test('mode Sederhana: patungan tidak ikut buku baru, diaktifkan dari Pengaturan, kantongnya terpisah dari kas utama', async ({ page }) => {
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type())) problems.push(`${m.type()}: ${m.text()}`);
  });

  await loginAndCreateSheet(page, 'Kas RT 05');
  await setupAccounts(page, [{ name: 'Kas RT', opening: 100000 }]);
  await addPeriod(page, { fee: '20000' });
  await saveDialog(page, 'Simpan periode');
  await addMembers(page, ['Ani Lestari', 'Budi Santoso', 'Citra Dewi']);

  // buku baru: tanpa sheet & tab Patungan; alamat #/patungan jatuh ke Iuran
  expect(await sheetTitles(page)).not.toContain('Patungan');
  await expect(menu(page).getByRole('link', { name: 'Patungan' })).toHaveCount(0);
  await page.evaluate(() => { window.location.hash = '#/patungan'; });
  await expect(page.getByRole('heading', { level: 1, name: /^Iuran/ })).toBeVisible();

  await enableCollections(page);
  expect((await sheetTitles(page)).slice(-2)).toEqual(['Patungan', 'Setoran Patungan']);

  // --- patungan besaran ditentukan, Citra tidak ikut
  await newCollection(page, { name: 'Perbaikan jalan', amount: 50000, exclude: ['Citra Dewi'] });
  await contribute(page, 'Ani Lestari'); // bawaan = besaran penuh
  await contribute(page, 'Budi Santoso', 20000);
  await expect(page.getByRole('row', { name: /^Ani Lestari/ })).toContainText('Lunas');
  await expect(page.getByRole('row', { name: /^Budi Santoso/ })).toContainText('Kurang 30.000');
  await expect(page.getByRole('row', { name: /^Citra Dewi/ })).toContainText('Tidak ikut');
  await expect(stat(page, 'Terkumpul')).toContainText('Rp 70.000');
  await expect(stat(page, 'Belum disetor')).toContainText('Rp 30.000');
  await expect(stat(page, 'Saldo kantong')).toContainText('Rp 70.000');
  await page.screenshot({ path: 'e2e/screenshots/patungan-detail.png', fullPage: true });

  // --- Buku Kas: bawaan kas utama saja; belanja dicatat dari kantong patungan
  await nav(page, 'Buku Kas');
  await expect(page.locator('table.simple tfoot')).toContainText('100.000'); // setoran patungan tidak ikut
  await expect(page.getByRole('button', { name: '⇄ Pindah saldo' })).toBeVisible(); // ada kantong patungan
  await page.getByRole('button', { name: '− Pengeluaran' }).click();
  const tx = page.getByRole('dialog');
  await tx.getByLabel('Akun kas').selectOption({ label: 'Perbaikan jalan' });
  await tx.getByLabel('Jumlah').fill('60000');
  await tx.getByLabel('Keterangan').fill('Semen dan pasir');
  await saveDialog(page);
  await expect(page.locator('table.simple tfoot')).toContainText('100.000');
  await page.getByLabel('Akun', { exact: true }).selectOption({ label: 'Perbaikan jalan' });
  await expect(page.getByRole('row', { name: /Patungan Perbaikan jalan – Ani Lestari/ })).toContainText('Patungan');
  await expect(page.locator('table.simple tfoot')).toContainText('10.000');

  // --- tutup, lalu pindahkan sisa ke kas utama
  await nav(page, 'Patungan');
  await page.getByRole('button', { name: 'Perbaikan jalan', exact: true }).click();
  await expect(stat(page, 'Saldo kantong')).toContainText('Rp 10.000');
  await expect(stat(page, 'Saldo kantong')).toContainText('Terpakai Rp 60.000');
  await page.getByRole('button', { name: 'Tutup patungan' }).click();
  await expect(page.locator('.notice')).toContainText('Masih ada sisa Rp 10.000');
  await expect(page.getByRole('button', { name: 'Catat setoran Ani Lestari' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Pindahkan sisa' }).click();
  const tf = page.getByRole('dialog', { name: 'Pindahkan sisa patungan' });
  await expect(tf.getByLabel('Dari akun').locator('option:checked')).toHaveText('Perbaikan jalan');
  await expect(tf.getByLabel('Ke akun').locator('option:checked')).toHaveText('Kas RT');
  await expect(tf.getByLabel('Jumlah')).toHaveValue('10.000');
  await saveDialog(page);
  await expect(stat(page, 'Saldo kantong')).toContainText('Rp 0');
  await expect(page.getByRole('button', { name: 'Pindahkan sisa' })).toHaveCount(0);

  // kantong tutup & nol: hilang dari pilihan, mode Sederhana kembali tanpa Pindah saldo
  await nav(page, 'Buku Kas');
  await expect(page.getByRole('button', { name: '⇄ Pindah saldo' })).toHaveCount(0);
  await expect(page.locator('table.simple tfoot')).toContainText('110.000');
  await expect(page.getByRole('row', { name: /Pindah dari Perbaikan jalan/ })).toContainText('10.000');

  // --- Laporan: kas utama vs kantong patungan
  await nav(page, 'Laporan');
  await expect(page.getByRole('row', { name: /^Kas RT/ })).toContainText('110.000');
  await expect(stat(page, 'Saldo kas saat ini')).toContainText('Rp 110.000');
  await expect(stat(page, 'Pemasukan periode')).toContainText('Rp 0'); // sisa patungan = pindah saldo, bukan pemasukan
  const pockets = page.locator('section', { has: page.getByRole('heading', { name: 'Kantong patungan' }) });
  await expect(pockets.getByRole('row', { name: /^Perbaikan jalan/ })).toContainText('ditutup');
  await expect(pockets.getByRole('row', { name: /^Perbaikan jalan/ })).toContainText('70.000');
  await page.screenshot({ path: 'e2e/screenshots/laporan-patungan.png', fullPage: true });

  // --- Pengaturan: kantong patungan tidak dianggap akun kedua di mode Sederhana
  await nav(page, 'Pengaturan');
  await expect(page.getByLabel('Nama akun', { exact: true })).toHaveValue('Kas RT');
  await page.getByLabel('Nama kas / organisasi').fill('Kas RT 05 Baru');
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Simpan', exact: true })).toBeDisabled();

  const accounts = await sheetRows(page, 'Akun Kas');
  expect(accounts.map((r) => [r[0].slice(0, 4), r[1]])).toEqual([[accounts[0][0].slice(0, 4), 'Kas RT'], ['ktp_', 'Perbaikan jalan']]);
  expect(Object.fromEntries(await sheetRows(page, 'Info'))).toMatchObject({ account_mode: 'simple' });
  expect((await sheetRows(page, 'Setoran Patungan')).map((r) => r[3])).toEqual([50000, 20000]);

  expect(problems).toEqual([]);
});

test('mode Multi: patungan sukarela, sisa ke Umum, dan hapus patungan kosong', async ({ page }) => {
  await loginAndCreateSheet(page, 'Kas Kelas');
  await setupAccounts(page, [{ name: 'Kas Kelas' }, { name: 'Dana Darurat' }], { mode: 'multi' });
  await addMembers(page, ['Ani Lestari', 'Budi Santoso']);
  await enableCollections(page);

  await newCollection(page, { name: 'Jenguk Nina', voluntary: true, target: 100000 });
  await expect(page.getByRole('columnheader', { name: 'Besaran' })).toHaveCount(0);
  await contribute(page, 'Ani Lestari', 25000);
  await expect(page.getByRole('row', { name: /^Ani Lestari/ })).toContainText('Menyetor');
  await expect(page.getByRole('row', { name: /^Budi Santoso/ })).not.toContainText('Belum');
  await expect(stat(page, 'Penyumbang')).toContainText('1');
  await expect(page.getByRole('progressbar', { name: 'Kemajuan terkumpul' })).toHaveAttribute('aria-valuenow', '25');

  // sisa ke Umum (bawaan di mode Multi)
  await page.getByRole('button', { name: 'Pindahkan sisa' }).click();
  const tf = page.getByRole('dialog', { name: 'Pindahkan sisa patungan' });
  await expect(tf.getByLabel('Ke akun').locator('option:checked')).toHaveText(/^Umum/);
  await saveDialog(page);
  await expect(stat(page, 'Saldo kantong')).toContainText('Rp 0');

  // patungan tanpa setoran bisa dihapus; kantongnya dinonaktifkan
  await newCollection(page, { name: 'Coba-coba', amount: 10000 });
  await page.getByRole('button', { name: 'Hapus' }).click();
  await page.getByRole('button', { name: 'Hapus?' }).click();
  await expect(page.getByRole('button', { name: 'Coba-coba', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Jenguk Nina', exact: true })).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/patungan.png', fullPage: true });
  const accounts = await sheetRows(page, 'Akun Kas');
  expect(accounts.filter((r) => r[1] === 'Coba-coba').map((r) => r[4])).toEqual([false]);

  // Buku Kas Multi: setoran ada di kantongnya, sisa di Umum
  await nav(page, 'Buku Kas');
  await page.getByLabel('Akun', { exact: true }).selectOption({ label: 'Umum (belum dialokasikan)' });
  await expect(page.getByRole('row', { name: /Pindah dari Jenguk Nina/ })).toContainText('25.000');
});
