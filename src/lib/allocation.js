// Pembagian uang iuran ke akun kas.
//
// Aturan bisnis:
//  - Tiap periode punya iuran bulanan (fee) dan daftar alokasi per akun kas.
//  - Total alokasi tidak boleh melebihi iuran. Selisihnya (jika ada) masuk ke "Umum".
//  - Pembayaran dibagi berurutan sesuai urutan akun (prioritas), masing-masing maksimal
//    sebesar alokasinya. Sisa pembayaran (selisih alokasi / kelebihan bayar) masuk ke "Umum".
//  - Hasil pembagian disimpan (snapshot) pada baris pembayaran, sehingga mengubah alokasi di
//    kemudian hari tidak mengubah riwayat buku kas.

export const UNALLOCATED_ID = 'umum';
export const UNALLOCATED_NAME = 'Umum (belum dialokasikan)';

export const sumAmounts = (items) => items.reduce((total, it) => total + (Number(it.amount) || 0), 0);

export function validateAllocations(fee, allocations) {
  const total = sumAmounts(allocations);
  const remaining = fee - total;
  if (allocations.some((a) => !Number.isSafeInteger(a.amount) || a.amount < 0)) {
    return { ok: false, total, remaining, error: 'Alokasi harus berupa bilangan bulat tidak negatif.' };
  }
  if (remaining < 0) {
    return { ok: false, total, remaining, error: 'Total alokasi melebihi iuran bulanan.' };
  }
  return { ok: true, total, remaining, error: null };
}

/**
 * Bagi `amount` ke akun-akun menurut alokasi berurutan.
 * @param {number} amount pembayaran baru
 * @param {{accountId: string, amount: number}[]} allocations urut prioritas
 * @param {Record<string, number>} alreadySplit bagian yang sudah terisi dari pembayaran sebelumnya
 *        pada anggota+bulan yang sama
 * @returns {Record<string, number>} accountId -> jumlah (hanya yang > 0)
 */
export function splitPayment(amount, allocations, alreadySplit = {}) {
  let remaining = amount;
  const result = {};
  for (const alloc of allocations) {
    if (remaining <= 0) break;
    const capacity = Math.max(0, alloc.amount - (alreadySplit[alloc.accountId] || 0));
    const take = Math.min(remaining, capacity);
    if (take > 0) {
      result[alloc.accountId] = (result[alloc.accountId] || 0) + take;
      remaining -= take;
    }
  }
  if (remaining > 0) result[UNALLOCATED_ID] = (result[UNALLOCATED_ID] || 0) + remaining;
  return result;
}

/** Jumlahkan beberapa snapshot pembagian. */
export function mergeSplits(splits) {
  const out = {};
  for (const split of splits) {
    for (const [accountId, value] of Object.entries(split || {})) {
      out[accountId] = (out[accountId] || 0) + (Number(value) || 0);
    }
  }
  return out;
}

/**
 * Pastikan snapshot pembagian konsisten dengan jumlah pembayaran. Baris yang diedit manual di
 * Sheets bisa saja kosong/rusak; dalam kasus itu seluruh nominal dianggap "Umum" agar uang tidak hilang.
 */
export function normalizeSplit(amount, split) {
  const clean = {};
  let sum = 0;
  for (const [accountId, value] of Object.entries(split || {})) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) {
      clean[accountId] = n;
      sum += n;
    }
  }
  if (sum > amount) return { [UNALLOCATED_ID]: amount };
  if (sum < amount) clean[UNALLOCATED_ID] = (clean[UNALLOCATED_ID] || 0) + (amount - sum);
  return clean;
}
