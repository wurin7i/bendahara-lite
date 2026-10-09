import { expect, test } from '@playwright/test';
import {
  addMembers, addPeriod, freezeClock, loginAndCreateSheet, nav, saveDialog, setupAccounts,
} from './helpers.js';

test.beforeEach(async ({ page }) => {
  await freezeClock(page);
});

const sheetRows = (page, sheet) =>
  page.evaluate((name) => {
    const server = window.__fakeGoogle;
    return server.dump(server.spreadsheetIds()[0], name).slice(1);
  }, sheet);

const modeText = (page) => page.locator('.mode-bar');

test('mode Sederhana (bawaan): urutan form, nama akun bawaan mengikuti nama kas, tanpa checkbox aktif', async ({ page }) => {
  await loginAndCreateSheet(page, 'Kas RT 05');
  await nav(page, 'Pengaturan');

  // urutan dari atas: Nama kas / organisasi -> Tukar mode -> Akun kas
  const org = page.getByLabel('Nama kas / organisasi');
  const toggle = page.getByRole('button', { name: 'Tukar mode' });
  const name = page.getByLabel('Nama akun', { exact: true });
  const y = async (locator) => (await locator.boundingBox()).y;
  expect(await y(org)).toBeLessThan(await y(toggle));
  expect(await y(toggle)).toBeLessThan(await y(name));

  await expect(modeText(page)).toContainText('Sederhana');
  await expect(org).toHaveValue('Kas RT 05'); // dari judul buku bila nama kas belum pernah diisi
  await expect(name).toHaveValue('Iuran Kas RT 05');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '+ Tambah akun' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '+ Tambah periode' })).toBeDisabled(); // belum ada akun tersimpan

  // nama bawaan mengikuti nama kas sampai diedit sendiri
  await org.fill('Kas RW 02');
  await expect(name).toHaveValue('Iuran Kas RW 02');
  await name.fill('Iuran Warga');
  await org.fill('Kas RW 03');
  await expect(name).toHaveValue('Iuran Warga');

  await page.getByLabel('Saldo awal', { exact: true }).fill('50000');
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Simpan', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '+ Tambah periode' })).toBeEnabled();

  expect((await sheetRows(page, 'Akun Kas')).map((r) => [r[1], r[2], r[3], r[4]])).toEqual([['Iuran Warga', 1, 50000, true]]);
  const info = Object.fromEntries(await sheetRows(page, 'Info'));
  expect(info).toMatchObject({ org_name: 'Kas RW 03', account_mode: 'simple' });

  // tersimpan: muat ulang halaman tetap Sederhana
  await page.reload();
  await nav(page, 'Pengaturan');
  await expect(modeText(page)).toContainText('Sederhana');
  await expect(page.getByLabel('Nama akun', { exact: true })).toHaveValue('Iuran Warga');
});

test('mode Sederhana: periode tanpa alokasi, seluruh iuran (termasuk kelebihan) masuk akun tunggal', async ({ page }) => {
  await loginAndCreateSheet(page, 'Kas Kelas');
  await setupAccounts(page, [{ name: 'Iuran Kelas', opening: 50000 }]);

  const dialog = await addPeriod(page, { fee: '100000' });
  await expect(dialog.getByText('Alokasi per akun kas')).toHaveCount(0);
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await saveDialog(page, 'Simpan periode');
  await expect(page.getByRole('columnheader', { name: 'Alokasi' })).toHaveCount(0);

  const alloc = await sheetRows(page, 'Alokasi');
  expect(alloc.map((r) => r[3])).toEqual([100000]); // seluruh iuran ke satu-satunya akun

  await addMembers(page, ['Ani Lestari']);
  await nav(page, 'Iuran');
  await expect(page.getByText('Pembagian iuran:')).toHaveCount(0);

  // bayar 150.000 untuk iuran 100.000: kelebihan tetap di akun tunggal, bukan "Umum"
  await page.getByRole('button', { name: /^Ani Lestari, Jul 2026:/ }).click();
  const pay = page.getByRole('dialog');
  await pay.getByLabel('Jumlah', { exact: true }).fill('150000');
  await expect(pay.getByText('melebihi kekurangan bulan ini')).toBeVisible();
  await expect(pay.getByText('Umum')).toHaveCount(0);
  await expect(pay.getByLabel('Pembagian ke akun kas')).toHaveCount(0);
  await pay.getByRole('button', { name: 'Simpan pembayaran' }).click();
  await expect(pay).toBeHidden();

  const payments = await sheetRows(page, 'Iuran');
  expect(JSON.parse(payments[0][7])).toEqual({ [alloc[0][2]]: 150000 });

  // Buku Kas: tanpa filter akun, kolom Akun, dan pindah saldo
  await nav(page, 'Buku Kas');
  await expect(page.getByLabel('Akun', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '⇄ Pindah saldo' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Akun' })).toHaveCount(0);
  await page.getByRole('button', { name: '− Pengeluaran' }).click();
  const tx = page.getByRole('dialog');
  await expect(tx.getByLabel('Akun kas')).toHaveCount(0);
  await tx.getByLabel('Jumlah').fill('25000');
  await tx.getByLabel('Keterangan').fill('Beli spidol');
  await saveDialog(page);
  await expect(page.locator('table.simple tfoot')).toContainText('175.000'); // 50.000 + 150.000 - 25.000

  // Laporan: satu akun, tanpa baris Umum
  await nav(page, 'Laporan');
  await expect(page.getByRole('row', { name: /^Iuran Kelas/ })).toContainText('175.000');
  await expect(page.getByRole('row', { name: /^Umum/ })).toHaveCount(0);
});

test('Tukar mode: Multi memunculkan baris berulang; kembali ke Sederhana diblokir sampai satu akun aktif', async ({ page }) => {
  await loginAndCreateSheet(page, 'Kas Kelas 1A');
  await setupAccounts(page, [{ name: 'Kas Kelas' }]);

  await page.getByRole('button', { name: 'Tukar mode' }).click();
  await expect(modeText(page)).toContainText('Multi akun kas');
  await expect(page.getByLabel('Akun 1 aktif')).toBeChecked();
  await page.getByRole('button', { name: '+ Tambah akun' }).click();
  await page.getByLabel('Nama akun 2', { exact: true }).fill('Dana Darurat');
  await page.getByLabel('Saldo awal 2', { exact: true }).fill('20000');
  await page.getByLabel('Catatan 2', { exact: true }).fill('untuk keperluan mendadak');

  // dua akun aktif: tidak boleh kembali ke Sederhana
  await page.getByRole('button', { name: 'Tukar mode' }).click();
  await expect(page.getByRole('alert')).toContainText('hanya punya satu akun aktif');
  await expect(modeText(page)).toContainText('Multi akun kas');

  await page.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Simpan', exact: true })).toBeDisabled();
  expect((await sheetRows(page, 'Akun Kas')).map((r) => [r[1], r[2], r[3], r[4]])).toEqual([
    ['Kas Kelas', 1, 0, true],
    ['Dana Darurat', 2, 20000, true],
  ]);
  expect(Object.fromEntries(await sheetRows(page, 'Info'))).toMatchObject({ account_mode: 'multi' });

  // urutan: turunkan akun pertama
  await page.getByLabel('Turunkan akun 1').click();
  await expect(page.getByLabel('Nama akun 1', { exact: true })).toHaveValue('Dana Darurat');
  await page.getByLabel('Naikkan akun 2').click();
  await expect(page.getByLabel('Nama akun 1', { exact: true })).toHaveValue('Kas Kelas');

  // nonaktifkan akun kedua -> boleh kembali ke Sederhana (akun nonaktif tetap tersimpan)
  await page.getByLabel('Akun 2 aktif').uncheck();
  await page.getByRole('button', { name: 'Tukar mode' }).click();
  await expect(modeText(page)).toContainText('Sederhana');
  await expect(page.getByLabel('Nama akun', { exact: true })).toHaveValue('Kas Kelas');
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Simpan', exact: true })).toBeDisabled();

  expect((await sheetRows(page, 'Akun Kas')).map((r) => [r[1], r[4]])).toEqual([
    ['Kas Kelas', true],
    ['Dana Darurat', false],
  ]);
  expect(Object.fromEntries(await sheetRows(page, 'Info'))).toMatchObject({ account_mode: 'simple' });
});

test('beralih Multi -> Sederhana: alokasi periode lama ke akun lain dinolkan saat periode disimpan ulang', async ({ page }) => {
  await loginAndCreateSheet(page, 'Kas Kelas');
  await setupAccounts(page, [{ name: 'Kas Kelas' }, { name: 'Dana Darurat' }], { mode: 'multi' });
  const dialog = await addPeriod(page, { fee: '100000', allocations: { 'Kas Kelas': 60000, 'Dana Darurat': 40000 } });
  await expect(dialog.getByText('Alokasi per akun kas')).toBeVisible();
  await saveDialog(page, 'Simpan periode');

  await page.getByLabel('Akun 2 aktif').uncheck();
  await page.getByRole('button', { name: 'Tukar mode' }).click();
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Simpan', exact: true })).toBeDisabled();

  await page.getByRole('row', { name: /Jul 2026/ }).getByRole('button', { name: 'Ubah' }).click();
  await expect(page.getByRole('dialog').getByText('Alokasi per akun kas')).toHaveCount(0);
  await saveDialog(page, 'Simpan periode');

  const accounts = await sheetRows(page, 'Akun Kas');
  const name = new Map(accounts.map((r) => [r[0], r[1]]));
  const alloc = Object.fromEntries((await sheetRows(page, 'Alokasi')).map((r) => [name.get(r[2]), r[3]]));
  expect(alloc).toEqual({ 'Kas Kelas': 100000, 'Dana Darurat': 0 });
});
