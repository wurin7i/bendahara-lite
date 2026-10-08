import { expect, test } from '@playwright/test';
import { freezeClock, loginAndCreateSheet, nav } from './helpers.js';

const DEMO_EMAIL = 'bendahara.demo@example.com';
const STRANGER = 'orang.lain@example.com';

test.beforeEach(async ({ page }) => {
  await freezeClock(page);
});

/** Buat spreadsheet atas nama akun lain langsung di server palsu; mengembalikan URL-nya. */
async function createSheetAs(page, email, title, sheets) {
  return page.evaluate(
    async ({ email, title, sheets }) => {
      const res = await window.fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        headers: { Authorization: `Bearer fake-token:${email}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: { title }, ...(sheets ? { sheets: sheets.map((t) => ({ properties: { title: t } })) } : {}) }),
      });
      const json = await res.json();
      return json.spreadsheetUrl;
    },
    { email, title, sheets },
  );
}

async function loginOnly(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Masuk dengan Google' }).click();
  await expect(page.getByRole('heading', { name: 'Pilih spreadsheet' })).toBeVisible();
}

test('akun tanpa izin pada spreadsheet orang lain ditolak dengan pesan jelas', async ({ page }) => {
  await loginOnly(page);
  const url = await createSheetAs(page, STRANGER, 'Kas Rahasia');

  await page.getByLabel('URL atau ID spreadsheet').fill(url);
  await page.getByRole('button', { name: 'Hubungkan' }).click();

  await expect(page.getByRole('heading', { name: 'Tidak bisa membuka data' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('tidak punya akses ke spreadsheet');
  await expect(page.getByRole('navigation', { name: 'Menu utama' })).toHaveCount(0);

  // bisa kembali memilih spreadsheet lain
  await page.getByRole('button', { name: 'Ganti spreadsheet' }).click();
  await expect(page.getByRole('heading', { name: 'Pilih spreadsheet' })).toBeVisible();
});

test('tautan berbagi ?sheet=ID didahulukan dari spreadsheet tersimpan lalu dibersihkan dari URL', async ({ page }) => {
  await loginAndCreateSheet(page); // spreadsheet A tersimpan sebagai pilihan terakhir
  const urlB = await createSheetAs(page, DEMO_EMAIL, 'Kas Lain'); // B: milik sendiri tapi belum disiapkan
  const idB = urlB.match(/\/d\/([^/]+)/)[1];

  await page.goto(`/?sheet=${idB}`);
  await expect(page.getByRole('heading', { name: 'Siapkan spreadsheet?' })).toBeVisible();
  await expect(page.getByText('Kas Lain')).toBeVisible();
  expect(new URL(page.url()).searchParams.has('sheet')).toBe(false);
});

test('URL yang bukan spreadsheet ditolak sebelum memanggil Google', async ({ page }) => {
  await loginOnly(page);
  await page.getByLabel('URL atau ID spreadsheet').fill('bukan url');
  await page.getByRole('button', { name: 'Hubungkan' }).click();
  await expect(page.getByText('URL atau ID spreadsheet tidak valid.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pilih spreadsheet' })).toBeVisible();
});

test('akses baca saja: data terbaca, tetapi menyimpan ditolak dengan pesan jelas', async ({ page }) => {
  await loginAndCreateSheet(page);
  await page.evaluate((email) => {
    const server = window.__fakeGoogle;
    server.share(server.spreadsheetIds()[0], email, 'reader');
  }, DEMO_EMAIL);

  // membaca tetap berhasil
  await nav(page, 'Pengaturan');
  await page.getByRole('button', { name: 'Muat ulang data' }).click();
  await expect(page.getByText('Data dimuat ulang')).toBeVisible();

  // menulis ditolak
  await nav(page, 'Anggota');
  await page.getByRole('button', { name: '+ Tambah anggota' }).click();
  await page.getByRole('dialog').getByLabel('Nama', { exact: true }).fill('Ani');
  await page.getByRole('dialog').getByRole('button', { name: 'Simpan' }).click();

  await expect(page.getByText('hanya punya akses baca')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeVisible(); // form tidak tertutup, isian tidak hilang
  await expect(page.getByRole('dialog').getByLabel('Nama', { exact: true })).toHaveValue('Ani');
});

test('spreadsheet kosong milik sendiri: ditawarkan disiapkan, sheet lama tidak disentuh', async ({ page }) => {
  await loginOnly(page);
  const url = await createSheetAs(page, DEMO_EMAIL, 'Sheet Lama');

  await page.getByLabel('URL atau ID spreadsheet').fill(url);
  await page.getByRole('button', { name: 'Hubungkan' }).click();
  await expect(page.getByRole('heading', { name: 'Siapkan spreadsheet?' })).toBeVisible();

  await page.getByRole('button', { name: 'Siapkan sekarang' }).click();
  await expect(page.getByRole('navigation', { name: 'Menu utama' })).toBeVisible();

  const titles = await page.evaluate(() => {
    const s = window.__fakeGoogle;
    return s.sheetTitles(s.spreadsheetIds()[0]);
  });
  expect(titles).toEqual(['Sheet1', 'Info', 'Anggota', 'Periode', 'Akun Kas', 'Alokasi', 'Iuran', 'Transaksi']);
});

test('sheet bernama sama dengan struktur lain tidak ditimpa', async ({ page }) => {
  await loginOnly(page);
  const url = await createSheetAs(page, DEMO_EMAIL, 'Punya Saya', ['Anggota']);
  await page.evaluate(async () => {
    await window.fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${window.__fakeGoogle.spreadsheetIds()[0]}/values/${encodeURIComponent("'Anggota'!A1:B1")}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: { Authorization: 'Bearer fake-token:bendahara.demo@example.com', 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [['Nama Lengkap', 'Telepon']] }),
      },
    );
  });

  await page.getByLabel('URL atau ID spreadsheet').fill(url);
  await page.getByRole('button', { name: 'Hubungkan' }).click();
  await expect(page.getByRole('alert')).toContainText('Sheet "Anggota" sudah ada tetapi strukturnya tidak sesuai');
  const cells = await page.evaluate(() => {
    const s = window.__fakeGoogle;
    return s.dump(s.spreadsheetIds()[0], 'Anggota');
  });
  expect(cells).toEqual([['Nama Lengkap', 'Telepon']]);
});

test('Google menolak token (401) di tengah sesi: kembali ke layar masuk, bukan macet', async ({ page }) => {
  await loginAndCreateSheet(page);
  await nav(page, 'Pengaturan');
  await page.evaluate(() => window.__fakeGoogle.failNext(401, 'Invalid Credentials'));
  await page.getByRole('button', { name: 'Muat ulang data' }).click();

  await expect(page.getByRole('button', { name: 'Masuk dengan Google' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Menu utama' })).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('bendahara-demo.session'))).toBeNull();

  // masuk lagi memulihkan aplikasi
  await page.getByRole('button', { name: 'Masuk dengan Google' }).click();
  await expect(page.getByRole('navigation', { name: 'Menu utama' })).toBeVisible();
});

test('mode demo memakai penyimpanan terpisah dari mode sungguhan', async ({ page }) => {
  await loginAndCreateSheet(page);
  const keys = await page.evaluate(() => ({
    session: [...Object.keys(sessionStorage)],
    local: [...Object.keys(localStorage)],
  }));
  // tidak ada kunci "bendahara.*" (milik mode sungguhan) yang tersentuh oleh demo
  expect([...keys.session, ...keys.local].filter((k) => k.startsWith('bendahara.'))).toEqual([]);
  expect(keys.session).toContain('bendahara-demo.session');
});

test.describe('sesi Google', () => {
  test('token kedaluwarsa diperbarui diam-diam dan aksi tetap berhasil', async ({ page }) => {
    await loginAndCreateSheet(page);
    expect(await page.evaluate(() => window.__fakeGoogleTokenRequests)).toBe(1); // hanya saat login
    await page.clock.setFixedTime(new Date('2026-10-08T13:00:00+07:00')); // +3 jam: token (1 jam) sudah habis

    await nav(page, 'Anggota');
    await page.getByRole('button', { name: '+ Tambah anggota' }).click();
    await page.getByRole('dialog').getByLabel('Nama', { exact: true }).fill('Dewi');
    await page.getByRole('dialog').getByRole('button', { name: 'Simpan' }).click();

    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('row', { name: /Dewi/ })).toBeVisible();
    // token benar-benar diminta ulang (sekali), bukan memakai token lama
    expect(await page.evaluate(() => window.__fakeGoogleTokenRequests)).toBe(2);
  });

  test('pembaruan senyap gagal (popup diblokir): kembali ke layar masuk, lalu bisa masuk lagi tanpa kehilangan data', async ({ page }) => {
    await loginAndCreateSheet(page);
    await nav(page, 'Anggota');
    await page.getByRole('button', { name: '+ Tambah anggota' }).click();
    await page.getByRole('dialog').getByLabel('Nama', { exact: true }).fill('Eka');
    await page.getByRole('dialog').getByRole('button', { name: 'Simpan' }).click();
    await expect(page.getByRole('row', { name: /Eka/ })).toBeVisible();

    await page.evaluate(() => { window.__fakeGoogleBlockPopup = true; });
    await page.clock.setFixedTime(new Date('2026-10-08T13:00:00+07:00'));
    await nav(page, 'Pengaturan');
    await page.getByRole('button', { name: 'Muat ulang data' }).click();

    await expect(page.getByRole('button', { name: 'Masuk dengan Google' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Menu utama' })).toHaveCount(0);

    await page.evaluate(() => { window.__fakeGoogleBlockPopup = false; });
    await page.getByRole('button', { name: 'Masuk dengan Google' }).click();
    await expect(page.getByRole('navigation', { name: 'Menu utama' })).toBeVisible();
    await nav(page, 'Anggota');
    await expect(page.getByRole('row', { name: /Eka/ })).toBeVisible();
  });

  test('sesi yang sudah kedaluwarsa tidak dipulihkan saat halaman dimuat ulang', async ({ page }) => {
    await loginAndCreateSheet(page);
    await page.clock.setFixedTime(new Date('2026-10-08T13:00:00+07:00'));
    await page.reload();
    await expect(page.getByRole('button', { name: 'Masuk dengan Google' })).toBeVisible();
  });
});
