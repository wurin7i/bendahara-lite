// Patungan: pengumpulan dana insidentil di luar iuran rutin, masing-masing dengan kantongnya sendiri.
//
// Aturan bisnis:
//  - Besaran ditentukan ("tetap"): tiap peserta wajib menyetor `amount`. Peserta = anggota aktif yang sudah
//    mulai iuran pada bulan patungan, kecuali yang ditandai tidak ikut. Boleh dicicil; kelebihan diterima.
//  - Sukarela: tanpa kewajiban dan tanpa tunggakan; siapa pun boleh menyetor berapa pun, berkali-kali.
//    Target dana (opsional) hanya untuk menampilkan kemajuan.
//  - Setoran masuk ke kantong patungan (akun kas khusus), terpisah dari kantong utama.
//  - Patungan yang ditutup tidak menerima setoran baru; kantongnya tetap bisa dipakai sampai saldonya nol.

import { isISODate, monthOfDate } from './months.js';

export const KIND_FIXED = 'tetap';
export const KIND_VOLUNTARY = 'sukarela';
export const COLLECTION_KINDS = [KIND_FIXED, KIND_VOLUNTARY];
export const KIND_LABELS = { [KIND_FIXED]: 'Besaran ditentukan', [KIND_VOLUNTARY]: 'Sukarela' };

export const isFixed = (collection) => collection.kind !== KIND_VOLUNTARY;

const byName = (a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' });
const byDateThenCreated = (a, b) => a.date.localeCompare(b.date) || String(a.createdAt).localeCompare(String(b.createdAt));

/** Apakah anggota termasuk peserta wajib patungan besaran ditentukan. */
export function isParticipant(collection, member) {
  if (!isFixed(collection) || !member.active || collection.excluded?.[member.id]) return false;
  const month = monthOfDate(collection.date);
  return !member.startMonth || !month || member.startMonth <= month;
}

/**
 * Tabel peserta satu patungan.
 * status: 'paid' | 'partial' | 'due' (lewat batas waktu) | 'pending' (belum, batas belum lewat) | 'gave' (menyetor
 * tanpa kewajiban) | 'none' (sukarela, belum menyetor) | 'na' (tidak ikut).
 * @param {object} args
 * @param {object} args.collection
 * @param {object[]} args.members
 * @param {object[]} args.contributions semua setoran aktif (akan disaring per patungan)
 * @param {string} args.today "YYYY-MM-DD"
 */
export function buildCollectionTable({ collection, members, contributions, today }) {
  const fixed = isFixed(collection);
  const list = contributions.filter((c) => c.collectionId === collection.id).sort(byDateThenCreated);
  const byMember = new Map();
  for (const c of list) {
    if (!byMember.has(c.memberId)) byMember.set(c.memberId, []);
    byMember.get(c.memberId).push(c);
  }
  const overdue = Boolean(collection.dueDate) && today > collection.dueDate;

  const totals = { collected: 0, expected: 0, outstanding: 0, participants: 0, paidCount: 0, contributors: 0 };
  const rows = members
    .filter((m) => m.active || byMember.has(m.id))
    .sort(byName)
    .map((member) => {
      const own = byMember.get(member.id) ?? [];
      const paid = own.reduce((sum, c) => sum + c.amount, 0);
      const participant = isParticipant(collection, member);
      const due = participant ? collection.amount : 0;

      let status;
      if (participant) {
        if (paid >= due && paid > 0) status = 'paid';
        else if (paid > 0) status = 'partial';
        else status = overdue ? 'due' : 'pending';
      } else if (paid > 0) status = 'gave';
      else status = fixed ? 'na' : 'none';

      const shortfall = Math.max(0, due - paid);
      if (participant) {
        totals.participants += 1;
        totals.expected += due;
        totals.outstanding += shortfall;
        if (status === 'paid') totals.paidCount += 1;
      }
      if (paid > 0) totals.contributors += 1;
      return { member, contributions: own, paid, due, participant, status, shortfall, surplus: participant ? Math.max(0, paid - due) : 0 };
    });

  // Setoran anggota yang barisnya sudah tidak ada tetap dihitung supaya uang tidak hilang dari total.
  totals.collected = list.reduce((sum, c) => sum + c.amount, 0);
  const target = fixed ? totals.expected : collection.target || 0;
  return { rows, contributions: list, totals, target, overdue, progress: target > 0 ? Math.min(1, totals.collected / target) : null };
}

/** Pesan galat untuk draf patungan, atau null bila bisa disimpan. `others` = patungan lain (untuk cek nama kembar). */
export function validateCollection(draft, others = []) {
  const name = String(draft.name ?? '').trim();
  if (!name) return 'Nama patungan wajib diisi.';
  const key = name.toLowerCase();
  if (others.some((c) => c.id !== draft.id && c.name.trim().toLowerCase() === key)) {
    return 'Sudah ada patungan dengan nama ini. Pakai nama lain supaya kantongnya mudah dibedakan.';
  }
  if (!COLLECTION_KINDS.includes(draft.kind)) return 'Jenis patungan tidak dikenal.';
  if (draft.kind === KIND_FIXED && !(Number.isSafeInteger(draft.amount) && draft.amount > 0)) {
    return 'Besaran per anggota harus lebih dari 0.';
  }
  if (draft.kind === KIND_VOLUNTARY && !(Number.isSafeInteger(draft.target ?? 0) && (draft.target ?? 0) >= 0)) {
    return 'Target dana harus berupa bilangan bulat tidak negatif.';
  }
  if (!isISODate(draft.date)) return 'Tanggal patungan tidak valid.';
  if (draft.dueDate && (!isISODate(draft.dueDate) || draft.dueDate < draft.date)) {
    return 'Batas waktu harus sama dengan atau setelah tanggal patungan.';
  }
  return null;
}

/** Urutan tampil: yang masih buka dulu, lalu yang terbaru. */
export const sortCollections = (collections) =>
  [...collections].sort((a, b) => Number(a.closed) - Number(b.closed) || b.date.localeCompare(a.date) || byName(a, b));
