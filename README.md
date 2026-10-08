# Bendahara Lite

Aplikasi pencatat kas sederhana untuk **iuran bulanan anggota**, dengan **Google Spreadsheet sebagai database**
dan **login Google** sebagai pintu masuk. JavaScript saja (React + Vite), tanpa server sendiri.

## Fitur

- **Tabel iuran 1 tahun**: anggota × 12 bulan. Bulan mulai bebas (mis. Juli 2026 – Juni 2027), tidak harus Januari.
  Klik sel untuk mencatat pembayaran (penuh, sebagian, atau cicilan) atau membatalkannya.
- **Alokasi ke akun kas**: tiap periode punya iuran bulanan dan pembagiannya ke akun kas (Kas Kelas, Dana Darurat,
  Tabungan Wisata, dst.). **Total alokasi tidak boleh melebihi iuran** (divalidasi di form); selisihnya masuk ke "Umum".
- **Buku kas**: seluruh uang masuk/keluar dengan saldo berjalan, filter per akun dan per periode. Iuran masuk
  otomatis; pengeluaran, pemasukan lain, dan pindah saldo antar akun dicatat manual.
- **Laporan saldo akhir**: saldo awal, masuk, keluar, dan saldo akhir per akun, plus daftar tunggakan. Bisa dicetak/PDF.
- **Banyak buku (organisasi)**: satu akun Google bisa mengelola beberapa spreadsheet terpisah, mis. dua organisasi.
  Pemilih buku di header untuk berpindah atau membuat buku baru. Daftar buku tersimpan di akun Google Anda (folder
  tersembunyi di Drive), jadi **ikut ke semua perangkat dan browser** tanpa onboarding ulang.
- **Login Google**: tanpa login tidak ada data yang tampil. Hak akses mengikuti pengaturan *Share* spreadsheet di Google
  (Editor = boleh mencatat, Viewer = hanya melihat).

## Coba dulu tanpa kredensial (mode demo)

```bash
npm install
npm run dev:demo      # buka http://localhost:5173
```

Mode demo memalsukan login Google dan Sheets di dalam browser (data disimpan di localStorage browser ini), jadi
semua fitur bisa dicoba tanpa akun Google Cloud. Mode ini **tidak ikut** di build produksi.

## Memasang untuk dipakai sungguhan

Aplikasi ini berjalan sepenuhnya di browser dan memanggil Google Sheets API langsung memakai akun Google pengguna.
Anda perlu satu **OAuth Client ID** (gratis).

1. **Buat proyek** di [Google Cloud Console](https://console.cloud.google.com/).
2. **Aktifkan dua API**: *APIs & Services → Library* → **Google Sheets API** → Enable, lalu **Google Drive API** → Enable.
   (Drive API hanya dipakai untuk mengingat daftar buku Anda; tanpanya aplikasi tetap jalan, lihat bagian *Banyak buku*.)
3. **Atur layar persetujuan OAuth** (*OAuth consent screen* / *Google Auth Platform*):
   - Jenis pengguna **External**, isi nama aplikasi dan email dukungan.
   - Tambahkan scope `https://www.googleapis.com/auth/spreadsheets` dan `https://www.googleapis.com/auth/drive.appdata`.
   - Selama status **Testing**, tambahkan email para pengurus di **Test users** (maks. 100). Hanya mereka yang bisa
     login. Untuk dipakai lebih luas, aplikasi harus dipublikasikan dan melalui verifikasi Google karena scope
     Spreadsheet termasuk "sensitif".
4. **Buat OAuth Client ID**: *Credentials → Create credentials → OAuth client ID → Web application*.
   Di **Authorized JavaScript origins** isi `http://localhost:5173` (pengembangan) dan alamat situs Anda
   (mis. `https://namaanda.github.io`). Redirect URI tidak diperlukan. Tidak ada *client secret* yang dipakai.
5. **Isi konfigurasi**:

   ```bash
   cp .env.example .env
   # edit .env -> VITE_GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   npm run dev
   ```

6. Buka aplikasi, **Masuk dengan Google** (centang kedua izin: Spreadsheet dan penyimpanan data aplikasi di Drive), lalu
   pilih **Buat buku baru** (aplikasi membuat semua sheet dan header-nya) atau tempel URL spreadsheet yang sudah ada.

### Deploy

```bash
npm run build         # hasil di dist/, berupa file statis
```

Letakkan isi `dist/` di hosting statis mana pun (GitHub Pages, Netlify, Cloudflare Pages, dsb.) dan pastikan alamatnya
terdaftar di *Authorized JavaScript origins*. `VITE_GOOGLE_CLIENT_ID` dibaca saat **build**, jadi atur sebagai variabel
build di layanan hosting Anda.

### Banyak buku & banyak perangkat

Satu **buku** = satu Google Spreadsheet = satu organisasi/kelompok (anggota, akun kas, periode, dan riwayatnya sendiri).

- Pemilih buku di header untuk berpindah; **＋ Kelola / tambah buku…** untuk membuat buku baru atau menghubungkan
  spreadsheet yang sudah ada. Hanya satu buku aktif pada satu waktu; tidak ada laporan gabungan lintas buku.
- Daftar buku disimpan di **`appDataFolder` Google Drive** akun Anda (scope `drive.appdata`): folder tersembunyi
  yang hanya bisa dibaca aplikasi ini dan hanya berisi ID serta judul spreadsheet, tanpa data keuangan. Karena ikut
  akun Google, MacBook, laptop lain, atau browser lain yang login dengan akun yang sama langsung mengenali bukunya.
- Izin Drive **opsional**. Bila tidak dicentang (atau Drive API belum diaktifkan), aplikasi tetap berjalan dan hanya
  mengingat daftar di browser itu; di Pengaturan tampil pemberitahuan beserta alasannya.
- **Hapus** di daftar buku hanya mengeluarkan buku dari daftar; spreadsheet-nya tidak dihapus dan bisa dihubungkan
  lagi lewat URL-nya. Buku yang sedang aktif tidak bisa dihapus dari daftar.
- Pengguna versi sebelumnya: spreadsheet terakhir yang diingat browser otomatis dimasukkan ke daftar dan dipindahkan ke Drive.
- Folder tersebut bisa terhapus bila Anda memutus aplikasi dari akun Google. Dampaknya hanya mengulang pemilihan
  spreadsheet sekali; data keuangan tetap aman di spreadsheet.

### Berbagi dengan pengurus lain

1. Di Google Sheets, klik **Share** dan beri akses ke email mereka (**Editor** untuk mencatat, **Viewer** untuk melihat).
2. Di Pengaturan, klik **Salin tautan untuk anggota tim** dan kirimkan. Mereka login dengan Google, lalu spreadsheet
   langsung terhubung dan masuk ke daftar buku mereka (ikut ke semua perangkat mereka). Tanpa akses Share, aplikasi
   menolak dengan pesan "tidak punya akses".
3. Mencabut akses di Google Sheets otomatis mencabut akses ke data di aplikasi.

## Cara kerja

### Aturan bisnis

| Hal | Aturan |
| --- | --- |
| Periode | 12 bulan berturut-turut dari bulan mulai pilihan. Tiap periode punya iuran dan alokasinya sendiri. |
| Alokasi | Jumlah per akun kas per anggota per bulan. Σ alokasi ≤ iuran. Sisanya → akun virtual **Umum**. |
| Pembayaran sebagian | Dibagi **berurutan** sesuai urutan akun di Pengaturan (akun teratas terisi dulu), maksimal sebesar alokasinya. Sisa/kelebihan bayar → Umum. |
| Cicilan | Beberapa pembayaran pada sel yang sama dijumlahkan; pembagian cicilan berikutnya melanjutkan dari yang sudah terisi. |
| Riwayat tetap | Pembagian ke akun **disimpan (snapshot) pada tiap pembayaran**, jadi mengubah alokasi kemudian tidak mengubah buku kas lama. |
| Tunggakan | Dihitung untuk anggota aktif, dari bulan "Mulai iuran" mereka sampai bulan berjalan. |
| Saldo | Saldo akun = saldo awal + semua masuk − semua keluar. Laporan periode memakai saldo awal = mutasi sebelum periode. |
| Penghapusan | Baris tidak dihapus dari Sheets, hanya ditandai **Dihapus**, supaya jejak audit utuh. Anggota & akun dinonaktifkan, bukan dihapus. |

### Struktur spreadsheet

Aplikasi membuat sheet berikut (header di baris 1, kolom A = ID unik). Semua sheet bisa dibaca/diolah di Sheets,
tetapi **jangan mengubah, menambah, atau memindah kolom** pada baris header.

| Sheet | Isi |
| --- | --- |
| `Info` | Pengaturan (versi skema, nama kas). |
| `Anggota` | Nama, kontak, bulan mulai iuran, status aktif, catatan. |
| `Akun Kas` | Nama akun, urutan (prioritas), saldo awal, status aktif. |
| `Periode` | Bulan mulai, iuran bulanan per periode. |
| `Alokasi` | Jumlah per akun kas untuk tiap periode. |
| `Iuran` | Satu baris per pembayaran: periode, anggota, bulan, jumlah, tanggal, pembagian ke akun (JSON). |
| `Transaksi` | Pengeluaran, pemasukan lain, dan pasangan pindah saldo. |

Penulisan memakai `valueInputOption=RAW`, jadi isi seperti `=1+1` tersimpan sebagai teks biasa dan tidak pernah
dijalankan sebagai rumus. Setiap pembaruan mencari baris lewat ID saat itu juga, sehingga aman walau seseorang
mengurutkan ulang baris di Sheets.

### Arsitektur

```
src/lib/       logika bisnis murni (bulan, alokasi, buku kas, tabel iuran, rupiah)    ← dites unit
src/google/    login Google (GIS), HTTP bersama, klien Sheets API, skema sheet, repository, penyimpanan Drive
src/state/     konteks aplikasi (sesi, data, aksi bisnis) dan daftar buku (books.js, dites unit)
src/views/     Iuran, Buku Kas, Laporan, Anggota, Pengaturan, layar masuk/setup
src/dev/       Google palsu untuk mode demo dan pengujian
tests/unit/    Vitest          e2e/    Playwright
```

## Pengujian

```bash
npm test                 # unit test (logika bisnis, repository, daftar buku) terhadap Sheets & Drive palsu
npm run test:e2e         # end-to-end di Chromium (mode demo)
```

Bila browser Playwright belum terpasang: `npx playwright install chromium`, atau arahkan ke Chromium yang sudah
ada dengan `CHROMIUM_PATH=/path/ke/chrome npm run test:e2e`.

## Pemecahan masalah

| Gejala | Penyebab & solusi |
| --- | --- |
| `401 Unauthorized` ke `sheets.googleapis.com` / `fakeSheet…` | Sisa sesi mode demo di browser yang sama. Pada versi terbaru aplikasi otomatis kembali ke layar masuk; demo dan mode sungguhan juga memakai penyimpanan terpisah. Bila masih terjadi: DevTools → *Application* → *Clear site data*. |
| Popup Google: `Error 400: origin_mismatch` | Alamat yang Anda buka (mis. `http://localhost:5173`) belum ada di **Authorized JavaScript origins** pada OAuth Client ID. Pastikan persis sama, termasuk port. |
| `Access blocked` / aplikasi belum diverifikasi | Akun Anda belum masuk daftar **Test users** pada layar persetujuan OAuth (status Testing). |
| `Google Sheets API belum diaktifkan` | Aktifkan *Google Sheets API* pada proyek yang sama dengan Client ID (langkah 2). |
| Tombol "Masuk" diganti pesan *Client ID belum diatur* | `VITE_GOOGLE_CLIENT_ID` kosong. Isi di `.env`, lalu **restart** `npm run dev` (nilai dibaca saat start). |
| Pemberitahuan *"Daftar buku hanya diingat di browser ini"* | Izin Drive tidak dicentang saat masuk (keluar lalu masuk lagi dan centang), atau **Google Drive API belum diaktifkan** di proyek Cloud (langkah 2). Aplikasi tetap berfungsi; hanya daftar buku yang tidak ikut ke perangkat lain. |
| Popup login tidak muncul | Browser memblokir popup untuk situs ini; izinkan lalu klik **Masuk dengan Google** lagi. |

## Batasan & catatan penting

- **Belum diuji dengan Google sungguhan.** Pengujian berjalan terhadap tiruan Sheets API dan Google Identity Services
  yang meniru perilaku terdokumentasi (rentang A1, sel kosong di ujung, 403/404/429, dll.). Permintaan pemformatan
  (header tebal, baris beku, format teks) hanya diterima begitu saja oleh tiruan dan baru tervalidasi saat dipakai di
  Google nyata. Langkah pertama yang disarankan: buat spreadsheet baru lewat aplikasi lalu periksa hasilnya di Sheets.
- **Fitur Drive (daftar buku) belum diuji dengan Google sungguhan.** Panggilan ke `appDataFolder` mengikuti
  dokumentasi Google, tetapi baru teruji terhadap tiruan. Bila gagal, aplikasi jatuh ke ingatan browser dan
  menampilkan alasannya; sampaikan pesannya agar bisa diperbaiki. Pengguna lama diminta menyetujui satu izin tambahan.
- **Cakupan izin cukup luas.** Scope `spreadsheets` secara teknis mengizinkan akses ke seluruh spreadsheet akun
  yang login, bukan hanya satu. Aplikasi hanya menyentuh spreadsheet yang dipilih, tetapi pengguna tetap mempercayakan
  izin itu pada kode aplikasi yang Anda host. Alternatifnya, scope `drive.file` lebih sempit namun mewajibkan Google
  Picker (API key tambahan) agar pengurus lain bisa membuka spreadsheet yang sudah ada.
- **Token disimpan di `sessionStorage`** (hilang saat tab ditutup) dan berlaku sekitar 1 jam. Aplikasi mencoba
  memperbaruinya diam-diam; bila popup diblokir browser, Anda diminta masuk lagi.
- **Konkurensi ringan.** Dua pengurus mencatat bersamaan aman (penambahan baris atomik, pembaruan dicari lewat ID),
  tetapi tampilan baru ikut berubah setelah menyimpan atau menekan **Muat ulang data**. Cocok untuk kelompok kecil,
  bukan untuk puluhan penulis serentak. Kuota Sheets API ±60 permintaan/menit/pengguna.
- **Belum ada**: impor/ekspor CSV, pembayaran beberapa bulan sekaligus dalam satu langkah, dan notifikasi
  tunggakan (WhatsApp/email).
