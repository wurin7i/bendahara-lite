// Utilitas bulan & tanggal. Bulan disimpan sebagai "YYYY-MM", tanggal sebagai "YYYY-MM-DD".
// Semua perhitungan memakai zona waktu lokal (bukan UTC) agar tanggal tidak bergeser di WIB.

const pad = (n) => String(n).padStart(2, '0');

export const PERIOD_LENGTH = 12;

export const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export function parseMonth(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key ?? '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export const isMonthKey = (key) => parseMonth(key) !== null;

export const toMonthKey = (year, month) => `${String(year).padStart(4, '0')}-${pad(month)}`;

export function addMonths(key, n) {
  const p = parseMonth(key);
  if (!p) throw new Error(`Bulan tidak valid: ${key}`);
  const index = p.year * 12 + (p.month - 1) + n;
  return toMonthKey(Math.floor(index / 12), (index % 12) + 1);
}

/** 12 bulan berurutan mulai dari `startKey`. */
export function periodMonths(startKey) {
  return Array.from({ length: PERIOD_LENGTH }, (_, i) => addMonths(startKey, i));
}

export const periodEndMonth = (startKey) => addMonths(startKey, PERIOD_LENGTH - 1);

export function monthStart(key) {
  return `${key}-01`;
}

export function monthEnd(key) {
  const { year, month } = parseMonth(key);
  return `${key}-${pad(new Date(year, month, 0).getDate())}`;
}

/** Rentang tanggal (inklusif) yang dicakup satu periode 12 bulan. */
export function periodRange(startKey) {
  return { from: monthStart(startKey), to: monthEnd(periodEndMonth(startKey)) };
}

export function currentMonthKey(now = new Date()) {
  return toMonthKey(now.getFullYear(), now.getMonth() + 1);
}

export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isISODate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
}

export const monthOfDate = (iso) => String(iso).slice(0, 7);

/** "2026-07" -> "Jul 2026" (atau "Juli 2026" bila long). */
export function monthLabel(key, { long = false } = {}) {
  const p = parseMonth(key);
  if (!p) return String(key ?? '');
  return `${(long ? MONTH_NAMES : MONTH_SHORT)[p.month - 1]} ${p.year}`;
}

/** "2026-07-05" -> "5 Jul 2026". */
export function formatDate(iso) {
  if (!isISODate(iso)) return String(iso ?? '');
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_SHORT[m - 1]} ${y}`;
}

/** "Jul 2026 – Jun 2027" */
export function periodRangeLabel(startKey) {
  if (!isMonthKey(startKey)) return '';
  return `${monthLabel(startKey)} – ${monthLabel(periodEndMonth(startKey))}`;
}

/**
 * Konversi nomor seri tanggal Google Sheets (hari sejak 30 Des 1899) ke "YYYY-MM-DD".
 * Dipakai bila seseorang mengetik tanggal manual di Sheets sehingga sel berubah jadi tipe tanggal.
 */
export function serialToISODate(serial) {
  const n = Math.floor(Number(serial));
  if (!Number.isFinite(n)) return '';
  const d = new Date(Date.UTC(1899, 11, 30 + n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
