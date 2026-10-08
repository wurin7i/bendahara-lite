// Pemilih data turunan yang dipakai beberapa tampilan.

import { sumAmounts } from './allocation.js';
import { periodRangeLabel } from './months.js';

/** Alokasi satu periode, berurutan menurut urutan akun (urutan = prioritas pembagian). */
export function periodAllocations(data, periodId) {
  const amounts = new Map(data.allocations.filter((a) => a.periodId === periodId).map((a) => [a.accountId, a.amount]));
  return data.accounts
    .filter((a) => (amounts.get(a.id) ?? 0) > 0)
    .map((a) => ({ accountId: a.id, amount: amounts.get(a.id) }));
}

export function periodAllocationSummary(data, period) {
  const allocations = periodAllocations(data, period.id);
  const total = sumAmounts(allocations);
  return { allocations, total, remainder: period.fee - total };
}

export const accountName = (data, id) => data.accounts.find((a) => a.id === id)?.name ?? id;

/** Nama tampilan periode: nama buatan pengguna, atau rentang bulannya. */
export const periodTitle = (p) => p.name || periodRangeLabel(p.startMonth);

/** "Nama · Jul 2026 – Jun 2027", atau hanya rentang bila periode tidak diberi nama. */
export const periodSubtitle = (p) => (p.name ? `${p.name} · ${periodRangeLabel(p.startMonth)}` : periodRangeLabel(p.startMonth));
