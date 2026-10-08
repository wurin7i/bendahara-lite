import { describe, expect, it } from 'vitest';
import { UNALLOCATED_ID } from '../../src/lib/allocation.js';
import { accountStatement, buildLedgerLines, buildLedgerView } from '../../src/lib/ledger.js';

const accounts = [
  { id: 'kelas', name: 'Kas Kelas', active: true, openingBalance: 100000 },
  { id: 'darurat', name: 'Dana Darurat', active: true, openingBalance: 0 },
];
const members = [{ id: 'm1', name: 'Ani' }, { id: 'm2', name: 'Budi' }];

const payments = [
  { id: 'p1', memberId: 'm1', month: '2026-07', amount: 100000, date: '2026-07-05', createdAt: '2026-07-05T01:00:00Z',
    split: { kelas: 70000, darurat: 20000, [UNALLOCATED_ID]: 10000 } },
  { id: 'p2', memberId: 'm2', month: '2026-07', amount: 100000, date: '2026-07-06', createdAt: '2026-07-06T01:00:00Z',
    split: { kelas: 70000, darurat: 20000, [UNALLOCATED_ID]: 10000 } },
];
const transactions = [
  { id: 't1', date: '2026-07-10', type: 'out', accountId: 'kelas', amount: 50000, description: 'Beli spidol', groupId: '', createdAt: '2026-07-10T01:00:00Z' },
  { id: 't2', date: '2026-08-01', type: 'out', accountId: 'darurat', amount: 15000, description: 'Pindah ke Kas Kelas', groupId: 'g1', createdAt: '2026-08-01T01:00:00Z' },
  { id: 't3', date: '2026-08-01', type: 'in', accountId: 'kelas', amount: 15000, description: 'Pindah dari Dana Darurat', groupId: 'g1', createdAt: '2026-08-01T01:00:01Z' },
];

const lines = buildLedgerLines({ payments, transactions, members, accounts });

describe('buildLedgerLines', () => {
  it('memecah pembayaran iuran per akun dan mengurutkan menurut tanggal', () => {
    expect(lines.filter((l) => l.source === 'dues')).toHaveLength(6);
    expect(lines.map((l) => l.date)).toEqual([...lines.map((l) => l.date)].sort());
    expect(lines.find((l) => l.id === 'p1:kelas')).toMatchObject({ in: 70000, description: 'Iuran Ani – Jul 2026' });
  });

  it('transaksi bertanggal & berwaktu sama tetap berurutan seperti di sheet (bukan acak)', () => {
    const same = { date: '2026-08-01', createdAt: '2026-08-01T01:00:00Z', groupId: '' };
    const tx = ['z', 'a', 'm'].map((id) => ({ ...same, id, type: 'out', accountId: 'kelas', amount: 1, description: id }));
    const l = buildLedgerLines({ payments: [], transactions: tx, members, accounts });
    expect(l.map((x) => x.id)).toEqual(['z', 'a', 'm']);
  });

  it('akun yang tidak dikenal dialihkan ke Umum agar uang tidak hilang', () => {
    const l = buildLedgerLines({
      payments: [], members, accounts,
      transactions: [{ id: 'x', date: '2026-07-01', type: 'in', accountId: 'hantu', amount: 5000, description: 'x', groupId: '', createdAt: '' }],
    });
    expect(l[0].accountId).toBe(UNALLOCATED_ID);
  });
});

describe('accountStatement', () => {
  it('saldo akhir = saldo awal + masuk - keluar per akun, dan total cocok dengan seluruh uang', () => {
    const s = accountStatement(accounts, lines);
    const kelas = s.rows.find((r) => r.accountId === 'kelas');
    expect(kelas).toMatchObject({ opening: 100000, in: 70000 + 70000 + 15000, out: 50000, closing: 100000 + 155000 - 50000 });
    const darurat = s.rows.find((r) => r.accountId === 'darurat');
    expect(darurat.closing).toBe(40000 - 15000);
    const umum = s.rows.find((r) => r.accountId === UNALLOCATED_ID);
    expect(umum.closing).toBe(20000);
    // total kas = saldo awal + semua iuran - pengeluaran nyata (pindah akun saling meniadakan)
    expect(s.total.closing).toBe(100000 + 200000 - 50000);
  });

  it('saldo awal periode memuat mutasi sebelum tanggal mulai; mutasi setelah akhir diabaikan', () => {
    const s = accountStatement(accounts, lines, { from: '2026-08-01', to: '2026-08-31' });
    const kelas = s.rows.find((r) => r.accountId === 'kelas');
    expect(kelas.opening).toBe(100000 + 140000 - 50000);
    expect(kelas.in).toBe(15000);
    const s2 = accountStatement(accounts, lines, { from: '2026-07-01', to: '2026-07-31' });
    expect(s2.rows.find((r) => r.accountId === 'kelas').in).toBe(140000);
    expect(s2.rows.find((r) => r.accountId === 'kelas').closing).toBe(190000);
  });

  it('mencatat volume perpindahan antar akun agar total masuk/keluar bisa dikoreksi', () => {
    const s = accountStatement(accounts, lines);
    expect(s.transferVolume).toBe(15000);
    expect(s.total.in - s.transferVolume).toBe(200000); // hanya iuran
    expect(s.total.out - s.transferVolume).toBe(50000); // hanya pengeluaran nyata
    expect(accountStatement(accounts, lines, { to: '2026-07-31' }).transferVolume).toBe(0);
  });

  it('baris Umum disembunyikan bila tak ada aktivitas', () => {
    const s = accountStatement(accounts, []);
    expect(s.rows.map((r) => r.accountId)).toEqual(['kelas', 'darurat']);
  });
});

describe('buildLedgerView', () => {
  it('tampilan semua akun menggabung satu pembayaran iuran jadi satu baris', () => {
    const v = buildLedgerView(accounts, lines);
    const dues = v.entries.filter((e) => e.source === 'dues');
    expect(dues).toHaveLength(2);
    expect(dues[0]).toMatchObject({ in: 100000, accountIds: expect.arrayContaining(['kelas', 'darurat', UNALLOCATED_ID]) });
  });

  it('saldo berjalan konsisten sampai saldo akhir', () => {
    const v = buildLedgerView(accounts, lines);
    expect(v.opening).toBe(100000);
    expect(v.closing).toBe(100000 + 200000 - 50000);
    expect(v.entries.at(-1).balance).toBe(v.closing);
    expect(v.totalIn - v.totalOut).toBe(v.closing - v.opening);
  });

  it('filter satu akun memakai saldo awal akun itu dan saldo berjalan per akun', () => {
    const v = buildLedgerView(accounts, lines, { accountId: 'kelas' });
    expect(v.opening).toBe(100000);
    expect(v.entries.map((e) => e.balance)).toEqual([170000, 240000, 190000, 205000]);
  });

  it('rentang tanggal menggeser saldo awal', () => {
    const v = buildLedgerView(accounts, lines, { accountId: 'kelas', from: '2026-08-01' });
    expect(v.opening).toBe(190000);
    expect(v.entries).toHaveLength(1);
    expect(v.closing).toBe(205000);
  });
});
