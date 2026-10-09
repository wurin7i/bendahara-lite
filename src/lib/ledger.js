// Buku kas: seluruh uang masuk/keluar digabung dari tiga sumber,
//   1. pembayaran iuran (dipecah per akun sesuai snapshot pembagian),
//   2. setoran patungan (masuk ke kantong patungan masing-masing), dan
//   3. transaksi manual (pengeluaran, pemasukan lain, pindah antar akun).
// Tidak ada data ganda: buku kas selalu dihitung ulang dari sumber-sumber itu.

import { UNALLOCATED_ID, UNALLOCATED_NAME, normalizeSplit } from './allocation.js';
import { monthLabel } from './months.js';

// Seri (tanggal & waktu catat sama) dibiarkan sesuai urutan baris di sheet, karena sort JS bersifat stabil.
const byDateThenCreated = (a, b) =>
  a.date.localeCompare(b.date) || String(a.createdAt).localeCompare(String(b.createdAt));

/**
 * @returns {{id, ref, source, date, createdAt, accountId, in, out, description, groupId?}[]}
 *   source: 'dues' | 'collection' | 'manual' | 'transfer'. Diurutkan menurut tanggal.
 *   `accounts` harus memuat semua akun yang bisa dituju, termasuk kantong patungan.
 */
export function buildLedgerLines({ payments, transactions, members, accounts, collections = [], contributions = [] }) {
  const knownAccounts = new Set(accounts.map((a) => a.id));
  // Akun tak dikenal (mis. baris diedit manual di Sheets) dialihkan ke "Umum" supaya uang tidak hilang dari laporan.
  const resolve = (id) => (knownAccounts.has(id) ? id : UNALLOCATED_ID);
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const lines = [];

  for (const p of payments) {
    const resolved = {};
    for (const [accountId, value] of Object.entries(normalizeSplit(p.amount, p.split))) {
      const target = resolve(accountId);
      resolved[target] = (resolved[target] || 0) + value;
    }
    const description = `Iuran ${memberName.get(p.memberId) ?? '(anggota dihapus)'} – ${monthLabel(p.month)}`;
    for (const [accountId, value] of Object.entries(resolved)) {
      lines.push({
        id: `${p.id}:${accountId}`,
        ref: p.id,
        source: 'dues',
        date: p.date,
        createdAt: p.createdAt,
        accountId,
        in: value,
        out: 0,
        description,
        note: p.note,
      });
    }
  }

  const collectionOf = new Map(collections.map((c) => [c.id, c]));
  for (const c of contributions) {
    const collection = collectionOf.get(c.collectionId);
    lines.push({
      id: c.id,
      ref: c.id,
      source: 'collection',
      collectionId: c.collectionId,
      date: c.date,
      createdAt: c.createdAt,
      accountId: resolve(collection?.accountId),
      in: c.amount,
      out: 0,
      description: `Patungan ${collection?.name ?? '(patungan dihapus)'} – ${memberName.get(c.memberId) ?? '(anggota dihapus)'}`,
      note: c.note,
    });
  }

  for (const t of transactions) {
    lines.push({
      id: t.id,
      ref: t.id,
      source: t.groupId ? 'transfer' : 'manual',
      groupId: t.groupId || null,
      date: t.date,
      createdAt: t.createdAt,
      accountId: resolve(t.accountId),
      in: t.type === 'in' ? t.amount : 0,
      out: t.type === 'out' ? t.amount : 0,
      description: t.description,
    });
  }

  return lines.sort(byDateThenCreated);
}

/**
 * Rekap per akun untuk rentang [from, to] (keduanya inklusif, boleh null = tanpa batas).
 * opening = saldo awal akun + semua mutasi sebelum `from`.
 * transferIn/transferOut = bagian Masuk/Keluar yang berasal dari pindah saldo. Keduanya sama bila semua akun ikut
 * dihitung, tetapi bisa berbeda bila hanya sebagian akun (mis. kantong utama saja) yang dimasukkan.
 */
export function accountStatement(accounts, lines, { from = null, to = null } = {}) {
  const rows = accounts.map((a) => ({
    accountId: a.id,
    name: a.name,
    active: a.active,
    unallocated: false,
    opening: a.openingBalance,
    in: 0,
    out: 0,
  }));
  const unallocated = {
    accountId: UNALLOCATED_ID,
    name: UNALLOCATED_NAME,
    active: true,
    unallocated: true,
    opening: 0,
    in: 0,
    out: 0,
  };
  rows.push(unallocated);
  const byId = new Map(rows.map((r) => [r.accountId, r]));
  // Perpindahan antar akun muncul sebagai masuk di satu akun dan keluar di akun lain (saling meniadakan).
  let transferIn = 0;
  let transferOut = 0;

  for (const line of lines) {
    const row = byId.get(line.accountId) ?? unallocated;
    if (from && line.date < from) {
      row.opening += line.in - line.out;
    } else if (!to || line.date <= to) {
      row.in += line.in;
      row.out += line.out;
      if (line.source === 'transfer') {
        transferIn += line.in;
        transferOut += line.out;
      }
    }
  }

  for (const row of rows) {
    row.closing = row.opening + row.in - row.out;
    row.visible = !row.unallocated || row.opening !== 0 || row.in !== 0 || row.out !== 0 || row.closing !== 0;
  }
  const visible = rows.filter((r) => r.visible);
  const total = visible.reduce(
    (t, r) => ({ opening: t.opening + r.opening, in: t.in + r.in, out: t.out + r.out, closing: t.closing + r.closing }),
    { opening: 0, in: 0, out: 0, closing: 0 },
  );
  return { rows: visible, total, transferIn, transferOut };
}

/**
 * Tampilan buku kas dengan saldo berjalan.
 * - accountId diisi: satu baris per mutasi akun tersebut.
 * - accountId kosong: seluruh akun pada `accounts` (plus Umum); mutasi iuran satu pembayaran digabung jadi satu
 *   baris. Dengan hanya memberi kantong utama, mutasi kantong patungan tidak ikut.
 */
export function buildLedgerView(accounts, lines, { accountId = null, from = null, to = null } = {}) {
  const inScope = new Set([...accounts.map((a) => a.id), UNALLOCATED_ID]);
  const scoped = lines.filter((l) => (accountId ? l.accountId === accountId : inScope.has(l.accountId)));

  let opening = accountId
    ? (accounts.find((a) => a.id === accountId)?.openingBalance ?? 0)
    : accounts.reduce((sum, a) => sum + a.openingBalance, 0);
  if (from) {
    for (const l of scoped) if (l.date < from) opening += l.in - l.out;
  }

  const inRange = scoped.filter((l) => (!from || l.date >= from) && (!to || l.date <= to));

  const entries = [];
  const grouped = new Map();
  for (const l of inRange) {
    if (!accountId && l.source === 'dues') {
      const existing = grouped.get(l.ref);
      if (existing) {
        existing.in += l.in;
        existing.out += l.out;
        existing.accountIds.push(l.accountId);
        continue;
      }
      const entry = { ...l, key: l.ref, accountIds: [l.accountId] };
      grouped.set(l.ref, entry);
      entries.push(entry);
    } else {
      entries.push({ ...l, key: l.id, accountIds: [l.accountId] });
    }
  }

  let balance = opening;
  let totalIn = 0;
  let totalOut = 0;
  for (const e of entries) {
    balance += e.in - e.out;
    e.balance = balance;
    totalIn += e.in;
    totalOut += e.out;
  }
  return { opening, entries, totalIn, totalOut, closing: balance };
}
