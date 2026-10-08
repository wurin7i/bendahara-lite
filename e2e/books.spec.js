import { expect, test } from '@playwright/test';
import { addMembers, freezeClock, loginAndCreateSheet, nav, waitForDriveSynced } from './helpers.js';

const EMAIL = 'bendahara.demo@example.com';
const NEW_BOOK = '__kelola__';

test.beforeEach(async ({ page }) => {
  await freezeClock(page);
});

/**
 * Meniru perangkat/browser baru: semua penyimpanan aplikasi hilang (localStorage + sessionStorage),
 * tetapi sisi Google (spreadsheet & folder Drive) tetap ada.
 */
async function simulateNewDevice(page) {
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) if (!key.endsWith('.fakeGoogle')) localStorage.removeItem(key);
    sessionStorage.clear();
  });
  await page.reload();
}

const picker = (page) => page.getByLabel('Pilih buku kas');
const loginAgain = async (page) => {
  await page.getByRole('button', { name: 'Masuk dengan Google' }).click();
};
const driveFile = (page) => page.evaluate((email) => window.__fakeGoogle.dumpDrive(email), EMAIL);

async function createBookFromHeader(page, title) {
  await picker(page).selectOption(NEW_BOOK);
  await expect(page.getByRole('heading', { name: 'Pilih buku kas' })).toBeVisible();
  await page.getByLabel('Nama spreadsheet').fill(title);
  await page.getByRole('button', { name: 'Buat buku baru' }).click();
  await expect(picker(page)).toBeVisible();
  await expect(picker(page).locator('option:checked')).toHaveText(title);
}

test('perangkat baru dengan akun yang sama langsung membuka buku terakhir, tanpa onboarding', async ({ page }) => {
  await loginAndCreateSheet(page, 'Kas RT 05');
  await addMembers(page, ['Ani Lestari']);

  // penunjuk tersimpan di Drive
  await expect.poll(async () => (await driveFile(page))[0]?.content?.books?.length).toBe(1);

  await simulateNewDevice(page);
  await loginAgain(page);

  await expect(page.getByRole('navigation', { name: 'Menu utama' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pilih buku kas' })).toHaveCount(0); // tidak ada onboarding
  await expect(picker(page).locator('option:checked')).toHaveText('Kas RT 05');
  await nav(page, 'Anggota');
  await expect(page.getByRole('row', { name: /Ani Lestari/ })).toBeVisible(); // data yang sama
});

test('mengelola dua organisasi: buat buku kedua, berpindah, data terpisah, dan terbawa ke perangkat baru', async ({ page }) => {
  await loginAndCreateSheet(page, 'Kas RT 05');
  await addMembers(page, ['Budi Santoso']);

  await createBookFromHeader(page, 'Kas Arisan');
  await nav(page, 'Anggota');
  await expect(page.getByRole('row', { name: /Budi Santoso/ })).toHaveCount(0); // buku baru kosong
  await addMembers(page, ['Ani Lestari']);

  // berpindah kembali ke buku pertama: datanya terpisah
  await picker(page).selectOption({ label: 'Kas RT 05' });
  await expect(picker(page).locator('option:checked')).toHaveText('Kas RT 05');
  await nav(page, 'Anggota');
  await expect(page.getByRole('row', { name: /Budi Santoso/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Ani Lestari/ })).toHaveCount(0);

  // dua buku tersimpan di Drive dan buku aktif = yang terakhir dibuka (penulisan ke Drive menyusul tampilan)
  const activeInDrive = async () => {
    const file = (await driveFile(page))[0].content;
    return file.books.find((b) => b.id === file.current)?.title;
  };
  await expect.poll(activeInDrive).toBe('Kas RT 05');
  const file = (await driveFile(page))[0].content;
  expect(file.books.map((b) => b.title).sort()).toEqual(['Kas Arisan', 'Kas RT 05']);

  // perangkat baru: kedua buku muncul di pemilih, dan langsung membuka buku aktif terakhir
  await simulateNewDevice(page);
  await loginAgain(page);
  await expect(picker(page).locator('option:checked')).toHaveText('Kas RT 05');
  const labels = await picker(page).locator('option').allTextContents();
  expect(labels).toEqual(['Kas Arisan', 'Kas RT 05', '＋ Kelola / tambah buku…']);
});

test('gagal berpindah buku: kembali ke daftar buku dengan buku aktif utuh, bukan layar galat', async ({ page }) => {
  await loginAndCreateSheet(page, 'Kas RT 05');
  await createBookFromHeader(page, 'Kas Arisan');
  await waitForDriveSynced(page, 'Kas Arisan'); // kegagalan yang disisipkan harus mengenai Sheets, bukan penulisan Drive

  await page.evaluate(() => window.__fakeGoogle.failNext(403, 'The caller does not have permission'));
  await picker(page).selectOption({ label: 'Kas RT 05' });

  await expect(page.getByText('tidak punya akses ke spreadsheet')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pilih buku kas' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tidak bisa membuka data' })).toHaveCount(0);

  // buku yang sedang aktif (Kas Arisan) masih bisa dikembalikan
  await page.getByRole('button', { name: /^← Kembali/ }).click();
  await expect(picker(page).locator('option:checked')).toHaveText('Kas Arisan');
});

test('menghapus buku dari daftar: hanya dari daftar, buku aktif tidak bisa dihapus', async ({ page }) => {
  await loginAndCreateSheet(page, 'Kas RT 05');
  await createBookFromHeader(page, 'Kas Arisan');

  await picker(page).selectOption(NEW_BOOK);
  const list = page.getByRole('list', { name: 'Daftar buku' });
  // buku aktif (Kas Arisan) tidak punya tombol Hapus
  await expect(list.getByRole('listitem').filter({ hasText: 'Kas Arisan' }).getByRole('button', { name: 'Hapus' })).toHaveCount(0);

  const other = list.getByRole('listitem').filter({ hasText: 'Kas RT 05' });
  await other.getByRole('button', { name: 'Hapus' }).click();
  await other.getByRole('button', { name: 'Hapus dari daftar?' }).click();
  await expect(list.getByRole('listitem').filter({ hasText: 'Kas RT 05' })).toHaveCount(0);

  const titles = (await driveFile(page))[0].content.books.map((b) => b.title);
  expect(titles).toEqual(['Kas Arisan']);
  // spreadsheet-nya sendiri tidak dihapus
  const stillThere = await page.evaluate(() => window.__fakeGoogle.spreadsheetIds().length);
  expect(stillThere).toBe(2);
});

test('mengubah nama kas memperbarui judul buku di pemilih dan di Drive', async ({ page }) => {
  await loginAndCreateSheet(page, 'Sheet Awal');
  await nav(page, 'Pengaturan');
  await page.getByLabel('Nama kas / organisasi').fill('Kas RT 05 Mawar');
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();

  await expect(picker(page).locator('option:checked')).toHaveText('Kas RT 05 Mawar');
  await expect.poll(async () => (await driveFile(page))[0].content.books[0].title).toBe('Kas RT 05 Mawar');
});

test.describe('tanpa sinkronisasi Drive, aplikasi tetap berfungsi', () => {
  test('izin Drive tidak dicentang: berjalan lewat browser, dengan pemberitahuan jelas', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Masuk dengan Google' }).waitFor();
    await page.evaluate(() => { window.__fakeGoogleDenyDrive = true; });
    await loginAgain(page);
    await expect(page.getByRole('heading', { name: 'Pilih buku kas' })).toBeVisible();
    await page.getByLabel('Nama spreadsheet').fill('Kas RT 05');
    await page.getByRole('button', { name: 'Buat buku baru' }).click();
    await expect(page.getByRole('navigation', { name: 'Menu utama' })).toBeVisible();

    await nav(page, 'Pengaturan');
    await expect(page.getByText('hanya diingat di browser ini', { exact: false })).toBeVisible();
    await expect(page.getByText('izin penyimpanan di Google Drive belum diberikan')).toBeVisible();
    expect(await driveFile(page)).toEqual([]); // tidak ada yang ditulis ke Drive

    // di browser yang sama, buku tetap diingat (cadangan browser)
    await page.reload();
    await page.evaluate(() => { window.__fakeGoogleDenyDrive = true; });
    await expect(page.getByRole('navigation', { name: 'Menu utama' })).toBeVisible();
    await expect(picker(page).locator('option:checked')).toHaveText('Kas RT 05');

    // perangkat baru: tidak ada yang mengingat -> onboarding lagi (konsekuensi tanpa Drive)
    await simulateNewDevice(page);
    await page.evaluate(() => { window.__fakeGoogleDenyDrive = true; });
    await loginAgain(page);
    await expect(page.getByRole('heading', { name: 'Pilih buku kas' })).toBeVisible();
  });

  test('Drive API belum diaktifkan di proyek Cloud: berjalan lewat browser dan menjelaskan penyebabnya', async ({ page }) => {
    await page.goto('/');
    // __fakeGoogle baru ada setelah aplikasi selesai boot (asinkron); tombol masuk tampil setelah itu.
    await page.getByRole('button', { name: 'Masuk dengan Google' }).waitFor();
    await page.evaluate(() => window.__fakeGoogle.setDriveApiEnabled(false));
    await loginAgain(page);
    await page.getByRole('button', { name: 'Buat buku baru' }).click();
    await expect(page.getByRole('navigation', { name: 'Menu utama' })).toBeVisible();

    await nav(page, 'Pengaturan');
    await expect(page.getByText('Google Drive API belum aktif')).toBeVisible();
    // pesan asli Google ikut tampil, termasuk nomor proyek yang dimaksud
    await expect(page.getByText(/has not been used in project 123456/)).toBeVisible();
    await expect(picker(page).locator('option:checked')).toHaveText('Kas Bendahara'); // tetap berfungsi

    // setelah API diaktifkan, "Coba lagi" memulihkan sinkronisasi tanpa keluar-masuk
    await page.evaluate(() => window.__fakeGoogle.setDriveApiEnabled(true));
    await page.getByRole('button', { name: 'Coba lagi' }).click();
    await expect(page.getByText('Daftar buku tersimpan di akun Google Anda')).toBeVisible();
    await expect.poll(async () => (await driveFile(page))[0]?.content?.books?.[0]?.title).toBe('Kas Bendahara');
  });
});
