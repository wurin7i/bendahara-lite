import { describe, expect, it } from 'vitest';
import {
  addMonths, currentMonthKey, formatDate, isISODate, monthEnd, monthLabel, periodMonths,
  periodRange, periodRangeLabel, serialToISODate, todayISO,
} from '../../src/lib/months.js';

describe('months', () => {
  it('addMonths melewati batas tahun ke dua arah', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-07', 0)).toBe('2026-07');
  });

  it('periodMonths memberi 12 bulan berurutan dari bulan mulai sembarang', () => {
    const m = periodMonths('2026-07');
    expect(m).toHaveLength(12);
    expect(m[0]).toBe('2026-07');
    expect(m[5]).toBe('2026-12');
    expect(m[6]).toBe('2027-01');
    expect(m[11]).toBe('2027-06');
  });

  it('monthEnd menangani Februari kabisat dan biasa', () => {
    expect(monthEnd('2028-02')).toBe('2028-02-29');
    expect(monthEnd('2027-02')).toBe('2027-02-28');
    expect(monthEnd('2026-12')).toBe('2026-12-31');
  });

  it('periodRange mencakup bulan pertama hingga hari terakhir bulan ke-12', () => {
    expect(periodRange('2026-07')).toEqual({ from: '2026-07-01', to: '2027-06-30' });
    expect(periodRange('2026-01')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('label tampil dalam bahasa Indonesia', () => {
    expect(monthLabel('2026-05')).toBe('Mei 2026');
    expect(monthLabel('2026-08', { long: true })).toBe('Agustus 2026');
    expect(formatDate('2026-10-08')).toBe('8 Okt 2026');
    expect(periodRangeLabel('2026-07')).toBe('Jul 2026 – Jun 2027');
  });

  it('todayISO / currentMonthKey memakai tanggal lokal, bukan UTC', () => {
    // 1 Jan 00:30 waktu lokal: toISOString() di zona UTC+ akan memberi 31 Des tahun sebelumnya.
    const d = new Date(2026, 0, 1, 0, 30);
    expect(todayISO(d)).toBe('2026-01-01');
    expect(currentMonthKey(d)).toBe('2026-01');
  });

  it('isISODate menolak tanggal yang tidak ada', () => {
    expect(isISODate('2026-02-29')).toBe(false);
    expect(isISODate('2028-02-29')).toBe(true);
    expect(isISODate('2026-13-01')).toBe(false);
    expect(isISODate('')).toBe(false);
  });

  it('serialToISODate mengonversi nomor seri Google Sheets', () => {
    expect(serialToISODate(46023)).toBe('2026-01-01');
    expect(serialToISODate(25569)).toBe('1970-01-01');
  });
});
