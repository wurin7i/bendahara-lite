import { describe, expect, it } from 'vitest';
import {
  KIND_FIXED, KIND_VOLUNTARY, buildCollectionTable, isParticipant, sortCollections, validateCollection,
} from '../../src/lib/collections.js';

const members = [
  { id: 'b', name: 'Budi', active: true, startMonth: '' },
  { id: 'a', name: 'Ani', active: true, startMonth: '' },
  { id: 'c', name: 'Citra', active: true, startMonth: '2026-11' }, // baru bergabung setelah patungan
  { id: 'd', name: 'Dedi', active: false, startMonth: '' },
  { id: 'e', name: 'Eka', active: true, startMonth: '' },
];
const fixed = {
  id: 'ptg1', name: 'Perbaikan jalan', kind: KIND_FIXED, amount: 50000, target: 0,
  date: '2026-10-01', dueDate: '2026-10-31', excluded: { e: true }, closed: false,
};
const setor = (memberId, amount, id = `${memberId}${amount}`, collectionId = 'ptg1', date = '2026-10-05') =>
  ({ id, collectionId, memberId, amount, date, createdAt: `${date}T01:00:00Z` });

describe('patungan besaran ditentukan', () => {
  const contributions = [
    setor('a', 20000, 'a1'),
    setor('a', 30000, 'a2'), // dua cicilan -> lunas
    setor('b', 10000), // sebagian
    setor('d', 50000), // nonaktif tetapi pernah menyetor
    setor('e', 25000), // tidak ikut tetapi menyumbang
    setor('a', 99999, 'lain', 'ptg-lain'), // patungan lain diabaikan
  ];
  const t = buildCollectionTable({ collection: fixed, members, contributions, today: '2026-10-08' });
  const row = (id) => t.rows.find((r) => r.member.id === id);

  it('peserta: anggota aktif yang sudah mulai iuran pada bulan patungan, kecuali yang tidak ikut', () => {
    expect(['a', 'b', 'c', 'd', 'e'].map((id) => isParticipant(fixed, members.find((m) => m.id === id))))
      .toEqual([true, true, false, false, false]);
    expect(t.totals.participants).toBe(2);
    expect(t.totals.expected).toBe(100000);
    expect(t.target).toBe(100000);
  });

  it('status per anggota dan cicilan dijumlahkan', () => {
    expect(t.rows.map((r) => r.member.name)).toEqual(['Ani', 'Budi', 'Citra', 'Dedi', 'Eka']);
    expect(row('a')).toMatchObject({ paid: 50000, status: 'paid', shortfall: 0 });
    expect(row('a').contributions.map((c) => c.id)).toEqual(['a1', 'a2']);
    expect(row('b')).toMatchObject({ paid: 10000, status: 'partial', shortfall: 40000 });
    expect(row('c')).toMatchObject({ status: 'na', due: 0 });
    expect(row('d')).toMatchObject({ status: 'gave', paid: 50000 });
    expect(row('e')).toMatchObject({ status: 'gave', paid: 25000 });
  });

  it('total: terkumpul memuat semua setoran, kekurangan hanya dari peserta', () => {
    expect(t.totals).toMatchObject({ collected: 135000, outstanding: 40000, paidCount: 1, contributors: 4 });
    expect(t.progress).toBe(1); // dibatasi 100%
  });

  it('belum bayar: "pending" sebelum batas waktu, "due" setelahnya', () => {
    const before = buildCollectionTable({ collection: fixed, members, contributions: [], today: '2026-10-31' });
    expect(before.rows.find((r) => r.member.id === 'a').status).toBe('pending');
    const after = buildCollectionTable({ collection: fixed, members, contributions: [], today: '2026-11-01' });
    expect(after.overdue).toBe(true);
    expect(after.rows.find((r) => r.member.id === 'a').status).toBe('due');
    const noDue = buildCollectionTable({ collection: { ...fixed, dueDate: '' }, members, contributions: [], today: '2030-01-01' });
    expect(noDue.rows.find((r) => r.member.id === 'a').status).toBe('pending');
  });

  it('kelebihan setoran dicatat sebagai surplus', () => {
    const t2 = buildCollectionTable({ collection: fixed, members, contributions: [setor('a', 70000)], today: '2026-10-08' });
    expect(t2.rows.find((r) => r.member.id === 'a')).toMatchObject({ status: 'paid', surplus: 20000 });
  });
});

describe('patungan sukarela', () => {
  const voluntary = { ...fixed, id: 'ptg2', name: 'Jenguk Nina', kind: KIND_VOLUNTARY, amount: 0, target: 200000, excluded: {} };
  const t = buildCollectionTable({
    collection: voluntary, members, today: '2026-12-01',
    contributions: [setor('a', 20000, 'x1', 'ptg2'), setor('a', 10000, 'x2', 'ptg2'), setor('b', 50000, 'x3', 'ptg2')],
  });

  it('tanpa kewajiban: tidak ada peserta, kekurangan, atau status merah', () => {
    expect(t.totals).toMatchObject({ participants: 0, expected: 0, outstanding: 0, collected: 80000, contributors: 2 });
    expect(t.rows.map((r) => r.status)).toEqual(['gave', 'gave', 'none', 'none']); // Dedi nonaktif tanpa setoran disembunyikan
    expect(t.rows.every((r) => r.shortfall === 0)).toBe(true);
  });

  it('kemajuan terhadap target dana (opsional)', () => {
    expect(t.target).toBe(200000);
    expect(t.progress).toBe(0.4);
    const noTarget = buildCollectionTable({ collection: { ...voluntary, target: 0 }, members, contributions: [], today: '2026-12-01' });
    expect(noTarget.progress).toBeNull();
  });
});

describe('validateCollection', () => {
  const draft = { name: 'Perbaikan jalan', kind: KIND_FIXED, amount: 50000, target: 0, date: '2026-10-01', dueDate: '' };
  it('menerima draf yang benar', () => {
    expect(validateCollection(draft)).toBeNull();
    expect(validateCollection({ ...draft, kind: KIND_VOLUNTARY, amount: 0 })).toBeNull();
  });
  it('menolak nama kosong, nama kembar, besaran nol, dan batas waktu sebelum tanggal', () => {
    expect(validateCollection({ ...draft, name: '  ' })).toMatch(/Nama/);
    expect(validateCollection(draft, [{ id: 'x', name: 'perbaikan JALAN ' }])).toMatch(/Sudah ada/);
    expect(validateCollection({ ...draft, id: 'x' }, [{ id: 'x', name: 'Perbaikan jalan' }])).toBeNull(); // dirinya sendiri
    expect(validateCollection({ ...draft, amount: 0 })).toMatch(/Besaran/);
    expect(validateCollection({ ...draft, dueDate: '2026-09-30' })).toMatch(/Batas waktu/);
    expect(validateCollection({ ...draft, date: '' })).toMatch(/Tanggal/);
  });
});

describe('sortCollections', () => {
  it('yang buka dulu, lalu terbaru', () => {
    const list = [
      { name: 'A', closed: true, date: '2026-12-01' },
      { name: 'B', closed: false, date: '2026-01-01' },
      { name: 'C', closed: false, date: '2026-05-01' },
    ];
    expect(sortCollections(list).map((c) => c.name)).toEqual(['C', 'B', 'A']);
  });
});
