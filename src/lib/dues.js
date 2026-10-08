// Tabel iuran: anggota x 12 bulan dalam satu periode.

import { addMonths, periodMonths } from './months.js';

const byName = (a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' });

/**
 * @param {object} args
 * @param {{id, startMonth, fee}} args.period
 * @param {object[]} args.members
 * @param {object[]} args.payments semua pembayaran aktif (akan disaring per periode)
 * @param {string} args.nowMonth "YYYY-MM" bulan berjalan, batas penghitungan tunggakan
 */
export function buildDuesTable({ period, members, payments, nowMonth }) {
  const months = periodMonths(period.startMonth);
  const fee = period.fee;
  const periodPayments = payments.filter((p) => p.periodId === period.id);

  const cellPayments = new Map();
  for (const p of periodPayments) {
    const key = `${p.memberId}|${p.month}`;
    if (!cellPayments.has(key)) cellPayments.set(key, []);
    cellPayments.get(key).push(p);
  }

  const hasPayments = new Set(periodPayments.map((p) => p.memberId));
  const visibleMembers = members.filter((m) => m.active || hasPayments.has(m.id)).sort(byName);

  const columnTotals = Object.fromEntries(months.map((m) => [m, 0]));
  const totals = { collected: 0, expectedToDate: 0, expectedFull: 0, arrears: 0 };

  const rows = visibleMembers.map((member) => {
    const row = { member, cells: {}, totalPaid: 0, arrears: 0, arrearMonths: 0 };
    for (const month of months) {
      const list = cellPayments.get(`${member.id}|${month}`) ?? [];
      const paid = list.reduce((sum, p) => sum + p.amount, 0);
      // Kewajiban iuran hanya untuk anggota aktif, mulai dari bulan "Mulai Iuran" mereka.
      const obligated = member.active && (!member.startMonth || month >= member.startMonth);

      let status;
      if (paid >= fee && paid > 0) status = 'paid';
      else if (paid > 0) status = 'partial';
      else if (!obligated) status = 'na';
      else status = month <= nowMonth ? 'due' : 'upcoming';

      let shortfall = 0;
      if (obligated) {
        totals.expectedFull += fee;
        if (month <= nowMonth) {
          totals.expectedToDate += fee;
          shortfall = Math.max(0, fee - paid);
        }
      }
      if (shortfall > 0) row.arrearMonths += 1;
      row.arrears += shortfall;
      row.totalPaid += paid;
      columnTotals[month] += paid;
      row.cells[month] = { month, paid, payments: list, status, shortfall, obligated };
    }
    totals.collected += row.totalPaid;
    totals.arrears += row.arrears;
    return row;
  });

  return { months, rows, columnTotals, totals, fee, endMonth: addMonths(period.startMonth, 11) };
}

/** Bulan saat ini jika berada dalam periode, selain itu null (untuk menyorot kolom). */
export function highlightMonth(period, nowMonth) {
  return periodMonths(period.startMonth).includes(nowMonth) ? nowMonth : null;
}

/** Pilih periode awal yang paling masuk akal: yang memuat bulan ini, kalau tidak ada yang terbaru. */
export function pickDefaultPeriod(periods, nowMonth) {
  if (!periods.length) return null;
  const current = periods.find((p) => periodMonths(p.startMonth).includes(nowMonth));
  if (current) return current;
  return [...periods].sort((a, b) => b.startMonth.localeCompare(a.startMonth))[0];
}
