import { expect, test } from '@playwright/test';
import {
  addMembers, addPeriod, freezeClock, loginAndCreateSheet, nav, pay, saveDialog, setupAccounts,
} from './helpers.js';

test.beforeEach(async ({ page }) => {
  await freezeClock(page);
});

test('login wajib: tanpa masuk tidak ada data atau menu', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Masuk dengan Google' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Menu utama' })).toHaveCount(0);
  await expect(page.getByText('Anggota', { exact: true })).toHaveCount(0);
});

test('alur lengkap: akun, periode, anggota, iuran, buku kas, laporan', async ({ page }) => {
  // Peringatan React (key ganda, dsb.) hanya tampil di console, jadi dikumpulkan dan diperiksa di akhir.
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type())) problems.push(`${m.type()}: ${m.text()}`);
  });

  await loginAndCreateSheet(page);

  // Panduan awal tampil sebelum ada data
  await expect(page.getByRole('heading', { name: 'Mulai dari sini' })).toBeVisible();

  // --- akun kas
  await setupAccounts(page, [{ name: 'Kas Kelas' }, { name: 'Dana Darurat' }, { name: 'Tabungan Wisata' }], { mode: 'multi' });
  await expect(page.getByLabel('Nama akun 2', { exact: true })).toHaveValue('Dana Darurat');

  // --- periode: total alokasi tidak boleh melebihi iuran
  const dialog = await addPeriod(page, {
    fee: '100000',
    allocations: { 'Kas Kelas': 50000, 'Dana Darurat': 30000, 'Tabungan Wisata': 30000 },
  });
  await expect(dialog.getByRole('status')).toContainText('Total alokasi melebihi iuran bulanan');
  await expect(dialog.getByRole('button', { name: 'Simpan periode' })).toBeDisabled();
  await dialog.getByLabel('Tabungan Wisata', { exact: true }).fill('10000');
  await expect(dialog.getByRole('status')).toContainText('Sisa ke Umum: Rp 10.000');
  await expect(dialog.getByRole('button', { name: 'Simpan periode' })).toBeEnabled();
  await saveDialog(page, 'Simpan periode');
  await expect(page.getByRole('row', { name: /Jul 2026 – Jun 2027/ })).toBeVisible();

  // --- anggota
  await addMembers(page, ['Ani Lestari', 'Budi Santoso', 'Citra Dewi']);
  await expect(page.getByRole('row', { name: /Budi Santoso/ })).toBeVisible();

  // --- tabel iuran: 12 bulan mulai Juli
  await nav(page, 'Iuran');
  const headers = await page.locator('table.dues thead th.month').allTextContents();
  expect(headers).toEqual([
    'Jul 2026', 'Agu 2026', 'Sep 2026', 'Okt 2026', 'Nov 2026', 'Des 2026',
    'Jan 2027', 'Feb 2027', 'Mar 2027', 'Apr 2027', 'Mei 2027', 'Jun 2027',
  ]);

  await pay(page, 'Ani Lestari', 'Jul 2026'); // jumlah bawaan = iuran penuh
  await pay(page, 'Budi Santoso', 'Jul 2026', 30000); // sebagian
  await expect(page.getByRole('button', { name: /^Ani Lestari, Jul 2026: lunas/ })).toHaveText('100.000');
  await expect(page.getByRole('button', { name: /^Budi Santoso, Jul 2026: sebagian/ })).toHaveText('30.000');

  // cicilan kedua melunasi sel (jumlah bawaan = sisa 70.000)
  await pay(page, 'Budi Santoso', 'Jul 2026');
  await expect(page.getByRole('button', { name: /^Budi Santoso, Jul 2026: lunas/ })).toHaveText('100.000');

  // tunggakan s.d. Okt 2026: Ani 3 bln, Budi 3 bln, Citra 4 bln = 1.000.000
  await expect(page.locator('.stat', { hasText: 'Tunggakan s.d. bulan ini' })).toContainText('Rp 1.000.000');
  await expect(page.locator('.stat', { hasText: 'Terkumpul' })).toContainText('Rp 200.000');
  await page.screenshot({ path: 'e2e/screenshots/iuran.png', fullPage: true });

  // --- buku kas: pengeluaran 25.000 dari Kas Kelas
  await nav(page, 'Buku Kas');
  await page.getByRole('button', { name: '− Pengeluaran' }).click();
  const tx = page.getByRole('dialog');
  await tx.getByLabel('Akun kas').selectOption({ label: 'Kas Kelas' });
  await tx.getByLabel('Jumlah').fill('25000');
  await tx.getByLabel('Keterangan').fill('Beli spidol');
  await saveDialog(page);
  await expect(page.getByRole('row', { name: /Beli spidol/ })).toContainText('25.000');

  // pindah saldo Dana Darurat -> Tabungan Wisata 10.000 tidak mengubah total kas
  await page.getByRole('button', { name: '⇄ Pindah saldo' }).click();
  const tf = page.getByRole('dialog');
  await tf.getByLabel('Dari akun').selectOption({ label: 'Dana Darurat' });
  await tf.getByLabel('Ke akun').selectOption({ label: 'Tabungan Wisata' });
  await tf.getByLabel('Jumlah').fill('10000');
  await saveDialog(page);
  await expect(page.getByText('Pindah ke Tabungan Wisata')).toBeVisible();
  await expect(page.locator('table.simple tfoot')).toContainText('175.000'); // 200.000 - 25.000
  await page.screenshot({ path: 'e2e/screenshots/buku-kas.png', fullPage: true });

  // filter satu akun memakai saldo berjalan akun itu
  await page.getByLabel('Akun', { exact: true }).selectOption({ label: 'Kas Kelas' });
  const lastBalance = await page.locator('table.simple tbody tr').last().locator('td').nth(-2).textContent();
  expect(lastBalance.trim()).toBe('75.000'); // 100.000 iuran - 25.000

  // --- laporan saldo akhir per akun
  await nav(page, 'Laporan');
  const row = (name) => page.getByRole('row', { name: new RegExp(`^${name}`) });
  await expect(row('Kas Kelas')).toContainText('75.000');
  await expect(row('Dana Darurat')).toContainText('50.000'); // 60.000 - 10.000
  await expect(row('Tabungan Wisata')).toContainText('30.000'); // 20.000 + 10.000
  await expect(row('Umum')).toContainText('20.000');
  await expect(page.locator('table.simple tfoot').first()).toContainText('175.000');
  await expect(page.locator('.stat', { hasText: 'Saldo kas saat ini' })).toContainText('Rp 175.000');
  await expect(page.getByText('perpindahan saldo antar akun sebesar Rp 10.000')).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/laporan.png', fullPage: true });

  // --- data tersimpan di spreadsheet: muat ulang halaman tetap masuk dan datanya ada
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Menu utama' })).toBeVisible();
  await nav(page, 'Iuran');
  await expect(page.getByRole('button', { name: /^Budi Santoso, Jul 2026: lunas/ })).toHaveText('100.000');

  // isi sheet nyata: setiap pembayaran menyimpan snapshot pembagian
  const sheet = await page.evaluate(() => {
    const server = window.__fakeGoogle;
    const id = server.spreadsheetIds()[0];
    return server.dump(id, 'Iuran').slice(1).map((r) => ({ jumlah: r[4], pembagian: r[7], dihapus: r[8] }));
  });
  expect(sheet).toHaveLength(3);
  expect(JSON.parse(sheet[0].pembagian)).toMatchObject({ umum: 10000 });
  expect(sheet.reduce((s, r) => s + r.jumlah, 0)).toBe(200000);

  // --- keluar
  await page.getByRole('button', { name: 'Keluar' }).click();
  await expect(page.getByRole('button', { name: 'Masuk dengan Google' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Masuk dengan Google' })).toBeVisible();

  expect(problems).toEqual([]);
});
