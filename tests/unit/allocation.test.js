import { describe, expect, it } from 'vitest';
import {
  UNALLOCATED_ID, mergeSplits, normalizeSplit, splitPayment, validateAllocations,
} from '../../src/lib/allocation.js';

const allocs = [
  { accountId: 'kelas', amount: 50000 },
  { accountId: 'darurat', amount: 30000 },
  { accountId: 'wisata', amount: 10000 },
];

describe('validateAllocations', () => {
  it('menerima total sama dengan atau kurang dari iuran', () => {
    expect(validateAllocations(100000, allocs).ok).toBe(true); // 90.000 < 100.000
    expect(validateAllocations(90000, allocs)).toMatchObject({ ok: true, remaining: 0 });
  });
  it('menolak total yang melebihi iuran', () => {
    const r = validateAllocations(80000, allocs);
    expect(r.ok).toBe(false);
    expect(r.remaining).toBe(-10000);
  });
  it('menolak nilai negatif atau pecahan', () => {
    expect(validateAllocations(100000, [{ accountId: 'a', amount: -1 }]).ok).toBe(false);
    expect(validateAllocations(100000, [{ accountId: 'a', amount: 1.5 }]).ok).toBe(false);
  });
});

describe('splitPayment', () => {
  it('pembayaran penuh dibagi sesuai alokasi dan sisanya ke Umum', () => {
    expect(splitPayment(100000, allocs)).toEqual({
      kelas: 50000, darurat: 30000, wisata: 10000, [UNALLOCATED_ID]: 10000,
    });
  });

  it('pembayaran sebagian mengisi akun berurutan menurut prioritas', () => {
    expect(splitPayment(60000, allocs)).toEqual({ kelas: 50000, darurat: 10000 });
    expect(splitPayment(20000, allocs)).toEqual({ kelas: 20000 });
  });

  it('cicilan kedua melanjutkan dari bagian yang sudah terisi (tanpa dobel hitung)', () => {
    const first = splitPayment(30000, allocs); // kelas 30.000
    const second = splitPayment(70000, allocs, first);
    expect(second).toEqual({ kelas: 20000, darurat: 30000, wisata: 10000, [UNALLOCATED_ID]: 10000 });
    // total dua cicilan = pembagian pembayaran penuh
    expect(mergeSplits([first, second])).toEqual(splitPayment(100000, allocs));
  });

  it('kelebihan bayar masuk ke Umum', () => {
    expect(splitPayment(150000, allocs)[UNALLOCATED_ID]).toBe(60000);
  });

  it('jumlah hasil pembagian selalu sama dengan pembayaran', () => {
    for (const amount of [1, 999, 45000, 90000, 100000, 123457]) {
      const total = Object.values(splitPayment(amount, allocs)).reduce((a, b) => a + b, 0);
      expect(total).toBe(amount);
    }
  });

  it('tanpa alokasi, seluruhnya masuk Umum', () => {
    expect(splitPayment(50000, [])).toEqual({ [UNALLOCATED_ID]: 50000 });
  });
});

describe('normalizeSplit', () => {
  it('snapshot kosong atau rusak -> semuanya Umum', () => {
    expect(normalizeSplit(50000, {})).toEqual({ [UNALLOCATED_ID]: 50000 });
    expect(normalizeSplit(50000, null)).toEqual({ [UNALLOCATED_ID]: 50000 });
  });
  it('snapshot lebih besar dari pembayaran dianggap rusak', () => {
    expect(normalizeSplit(50000, { a: 40000, b: 40000 })).toEqual({ [UNALLOCATED_ID]: 50000 });
  });
  it('selisih kecil ditambahkan ke Umum', () => {
    expect(normalizeSplit(50000, { a: 30000 })).toEqual({ a: 30000, [UNALLOCATED_ID]: 20000 });
  });
});
