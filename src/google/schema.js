// Skema "database": satu sheet per tabel, baris 1 = header (Bahasa Indonesia), kolom pertama = ID unik.
// Kode aplikasi memakai kunci (key) berbahasa Inggris; pengguna Sheets melihat header berbahasa Indonesia.

import { isMonthKey, serialToISODate } from '../lib/months.js';

export const SCHEMA_VERSION = 1;
export const APP_ID = 'bendahara-lite';

const col = (key, header, type = 'text') => ({ key, header, type });
const audit = () => [col('createdBy', 'Dicatat Oleh'), col('createdAt', 'Dibuat Pada')];

export const TABLES = {
  info: {
    sheet: 'Info',
    prefix: 'info',
    columns: [col('id', 'Kunci'), col('value', 'Nilai')],
  },
  members: {
    sheet: 'Anggota',
    prefix: 'agt',
    columns: [
      col('id', 'ID'),
      col('name', 'Nama'),
      col('contact', 'Kontak'),
      col('startMonth', 'Mulai Iuran', 'month'),
      col('active', 'Aktif', 'bool'),
      col('note', 'Catatan'),
      ...audit(),
    ],
  },
  periods: {
    sheet: 'Periode',
    prefix: 'per',
    columns: [
      col('id', 'ID'),
      col('name', 'Nama'),
      col('startMonth', 'Bulan Mulai', 'month'),
      col('fee', 'Iuran Bulanan', 'number'),
      col('note', 'Catatan'),
      col('deleted', 'Dihapus', 'bool'),
      ...audit(),
    ],
  },
  accounts: {
    sheet: 'Akun Kas',
    prefix: 'akn',
    columns: [
      col('id', 'ID'),
      col('name', 'Nama'),
      col('order', 'Urutan', 'number'),
      col('openingBalance', 'Saldo Awal', 'number'),
      col('active', 'Aktif', 'bool'),
      col('note', 'Catatan'),
      ...audit(),
    ],
  },
  allocations: {
    sheet: 'Alokasi',
    prefix: 'alk',
    columns: [
      col('id', 'ID'),
      col('periodId', 'ID Periode'),
      col('accountId', 'ID Akun'),
      col('amount', 'Jumlah per Anggota', 'number'),
    ],
  },
  payments: {
    sheet: 'Iuran',
    prefix: 'iur',
    columns: [
      col('id', 'ID'),
      col('periodId', 'ID Periode'),
      col('memberId', 'ID Anggota'),
      col('month', 'Bulan', 'month'),
      col('amount', 'Jumlah', 'number'),
      col('date', 'Tanggal Bayar', 'date'),
      col('note', 'Catatan'),
      col('split', 'Pembagian ke Akun (JSON)', 'json'),
      col('deleted', 'Dihapus', 'bool'),
      ...audit(),
    ],
  },
  transactions: {
    sheet: 'Transaksi',
    prefix: 'trx',
    columns: [
      col('id', 'ID'),
      col('date', 'Tanggal', 'date'),
      col('type', 'Jenis (masuk/keluar)'),
      col('accountId', 'ID Akun'),
      col('amount', 'Jumlah', 'number'),
      col('description', 'Keterangan'),
      col('groupId', 'ID Pindah Akun'),
      col('deleted', 'Dihapus', 'bool'),
      ...audit(),
    ],
  },

  // Tabel fitur opsional: sheet-nya tidak dibuat saat buku baru, hanya saat fitur diaktifkan dari Pengaturan.
  collections: {
    sheet: 'Patungan',
    prefix: 'ptg',
    feature: 'collections',
    columns: [
      col('id', 'ID'),
      col('name', 'Nama'),
      col('kind', 'Jenis (tetap/sukarela)'),
      col('amount', 'Besaran per Anggota', 'number'),
      col('target', 'Target Dana', 'number'),
      col('date', 'Tanggal', 'date'),
      col('dueDate', 'Batas Waktu', 'date'),
      col('accountId', 'ID Kantong'),
      col('excluded', 'Tidak Ikut (JSON)', 'json'),
      col('closed', 'Ditutup', 'bool'),
      col('note', 'Catatan'),
      col('deleted', 'Dihapus', 'bool'),
      ...audit(),
    ],
  },
  contributions: {
    sheet: 'Setoran Patungan',
    prefix: 'stp',
    feature: 'collections',
    columns: [
      col('id', 'ID'),
      col('collectionId', 'ID Patungan'),
      col('memberId', 'ID Anggota'),
      col('amount', 'Jumlah', 'number'),
      col('date', 'Tanggal Setor', 'date'),
      col('note', 'Catatan'),
      col('deleted', 'Dihapus', 'bool'),
      ...audit(),
    ],
  },
};

export const TABLE_KEYS = Object.keys(TABLES);
/** Tabel yang selalu ada di setiap buku. */
export const CORE_TABLE_KEYS = TABLE_KEYS.filter((k) => !TABLES[k].feature);
/** Fitur opsional -> tabel-tabelnya. */
export const FEATURES = { collections: TABLE_KEYS.filter((k) => TABLES[k].feature === 'collections') };

/** 1 -> A, 26 -> Z, 27 -> AA */
export function columnLetter(n) {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

export const lastColumn = (table) => columnLetter(table.columns.length);
export const quoteSheet = (name) => `'${name.replace(/'/g, "''")}'`;
export const fullRange = (table) => `${quoteSheet(table.sheet)}!A1:${lastColumn(table)}`;
export const headerRange = (table) => `${quoteSheet(table.sheet)}!A1:${lastColumn(table)}1`;
export const idColumnRange = (table) => `${quoteSheet(table.sheet)}!A2:A`;
export const appendRange = (table) => `${quoteSheet(table.sheet)}!A:${lastColumn(table)}`;
export const rowRange = (table, row) => `${quoteSheet(table.sheet)}!A${row}:${lastColumn(table)}${row}`;

const isBlank = (v) => v === undefined || v === null || v === '';

const toBool = (v) => v === true || v === 1 || (typeof v === 'string' && ['true', 'ya', 'yes', '1'].includes(v.trim().toLowerCase()));

const decoders = {
  text: (v) => (isBlank(v) ? '' : String(v)),
  number: (v) => {
    const n = typeof v === 'number' ? v : Number(v);
    return isBlank(v) || !Number.isFinite(n) ? 0 : n;
  },
  bool: toBool,
  // Bila sel diubah manual menjadi tipe tanggal di Sheets, nilainya datang sebagai nomor seri.
  date: (v) => (typeof v === 'number' ? serialToISODate(v) : isBlank(v) ? '' : String(v).trim().slice(0, 10)),
  month: (v) => {
    const s = typeof v === 'number' ? serialToISODate(v) : isBlank(v) ? '' : String(v).trim();
    const key = s.slice(0, 7);
    return isMonthKey(key) ? key : '';
  },
  json: (v) => {
    if (isBlank(v)) return {};
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  },
};

const encoders = {
  text: (v) => (isBlank(v) ? '' : String(v)),
  number: (v) => (Number.isFinite(Number(v)) ? Number(v) : 0),
  bool: (v) => Boolean(v),
  date: (v) => (isBlank(v) ? '' : String(v)),
  month: (v) => (isBlank(v) ? '' : String(v)),
  json: (v) => JSON.stringify(v ?? {}),
};

export function decodeRow(table, row) {
  const record = {};
  table.columns.forEach((c, i) => {
    record[c.key] = decoders[c.type](row?.[i]);
  });
  return record;
}

export function encodeRecord(table, record) {
  return table.columns.map((c) => encoders[c.type](record[c.key]));
}

export const headersOf = (table) => table.columns.map((c) => c.header);

export function headerMatches(table, row) {
  return table.columns.every((c, i) => String(row?.[i] ?? '').trim() === c.header);
}

export const isBlankRow = (row) => !row || row.every(isBlank);

export const hasDeletedColumn = (table) => table.columns.some((c) => c.key === 'deleted');

/** Nilai awal tiap kolom untuk record baru. */
export function emptyRecord(table) {
  return decodeRow(table, []);
}
