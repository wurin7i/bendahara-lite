import { describe, expect, it } from 'vitest';
import { buildDuesTable, pickDefaultPeriod } from '../../src/lib/dues.js';

const period = { id: 'per1', startMonth: '2026-07', fee: 100000 };
const members = [
  { id: 'b', name: 'Budi', active: true, startMonth: '' },
  { id: 'a', name: 'Ani', active: true, startMonth: '' },
  { id: 'c', name: 'Citra', active: true, startMonth: '2026-09' },
  { id: 'd', name: 'Dedi', active: false, startMonth: '' },
];
const pay = (memberId, month, amount, id = `${memberId}${month}${amount}`) => ({ id, periodId: 'per1', memberId, month, amount });

describe('buildDuesTable', () => {
  const payments = [
    pay('a', '2026-07', 100000),
    pay('a', '2026-08', 40000, 'a8-1'),
    pay('a', '2026-08', 60000, 'a8-2'), // dua cicilan -> lunas
    pay('b', '2026-07', 30000), // sebagian
    pay('d', '2026-07', 100000), // anggota nonaktif yang pernah bayar
    { ...pay('a', '2026-07', 999), periodId: 'lain' }, // periode lain diabaikan
  ];
  const t = buildDuesTable({ period, members, payments, nowMonth: '2026-09' });

  it('mengurutkan anggota menurut nama dan menyembunyikan nonaktif tanpa pembayaran', () => {
    expect(t.rows.map((r) => r.member.name)).toEqual(['Ani', 'Budi', 'Citra', 'Dedi']);
    const noDedi = buildDuesTable({ period, members, payments: [], nowMonth: '2026-09' });
    expect(noDedi.rows.map((r) => r.member.name)).toEqual(['Ani', 'Budi', 'Citra']);
  });

  it('menjumlahkan cicilan dalam satu sel dan menentukan status', () => {
    const ani = t.rows[0];
    expect(ani.cells['2026-07'].status).toBe('paid');
    expect(ani.cells['2026-08']).toMatchObject({ paid: 100000, status: 'paid' });
    expect(ani.cells['2026-09'].status).toBe('due');
    expect(ani.cells['2026-10'].status).toBe('upcoming');
    expect(t.rows[1].cells['2026-07'].status).toBe('partial');
  });

  it('tunggakan dihitung sampai bulan berjalan saja', () => {
    expect(t.rows[0].arrears).toBe(100000); // Ani: Sep belum bayar
    expect(t.rows[1].arrears).toBe(70000 + 100000 + 100000); // Budi: Jul kurang 70rb, Agu, Sep
    expect(t.rows[1].arrearMonths).toBe(3);
  });

  it('anggota baru tidak ditagih untuk bulan sebelum "Mulai Iuran"', () => {
    const citra = t.rows[2];
    expect(citra.cells['2026-07'].status).toBe('na');
    expect(citra.cells['2026-08'].status).toBe('na');
    expect(citra.cells['2026-09'].status).toBe('due');
    expect(citra.arrears).toBe(100000);
  });

  it('anggota nonaktif tidak ditagih, tetapi pembayarannya tetap terhitung', () => {
    const dedi = t.rows[3];
    expect(dedi.arrears).toBe(0);
    expect(dedi.cells['2026-07'].status).toBe('paid');
    expect(dedi.cells['2026-08'].status).toBe('na');
  });

  it('total & total kolom konsisten', () => {
    expect(t.totals.collected).toBe(100000 + 100000 + 30000 + 100000);
    expect(t.columnTotals['2026-07']).toBe(100000 + 30000 + 100000);
    expect(t.totals.collected).toBe(Object.values(t.columnTotals).reduce((a, b) => a + b, 0));
    // 3 anggota aktif x 3 bulan, kecuali Citra (hanya Sep) -> 7 sel x 100rb
    expect(t.totals.expectedToDate).toBe(700000);
  });

  it('target setahun memperhitungkan bulan mulai anggota', () => {
    expect(t.totals.expectedFull).toBe((12 + 12 + 10) * 100000);
  });
});

describe('pickDefaultPeriod', () => {
  const periods = [
    { id: 'p1', startMonth: '2025-07' },
    { id: 'p2', startMonth: '2026-07' },
  ];
  it('memilih periode yang memuat bulan ini', () => {
    expect(pickDefaultPeriod(periods, '2025-09').id).toBe('p1');
    expect(pickDefaultPeriod(periods, '2026-09').id).toBe('p2');
  });
  it('bila tidak ada yang memuat, memilih yang terbaru', () => {
    expect(pickDefaultPeriod(periods, '2030-01').id).toBe('p2');
    expect(pickDefaultPeriod([], '2030-01')).toBeNull();
  });
});
