// Rupiah selalu bilangan bulat; tidak ada sen.

const group = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** 1500000 -> "1.500.000" */
export function formatNumber(value) {
  const n = Math.round(Number(value) || 0);
  return (n < 0 ? '-' : '') + group(String(Math.abs(n)));
}

/** 1500000 -> "Rp 1.500.000"; -5000 -> "-Rp 5.000" */
export function formatRupiah(value) {
  const n = Math.round(Number(value) || 0);
  return `${n < 0 ? '-' : ''}Rp ${group(String(Math.abs(n)))}`;
}

/** Ambil angka dari input teks ("Rp 1.500.000" -> 1500000). Teks tanpa angka menghasilkan 0. */
export function parseAmount(text) {
  const digits = String(text ?? '').replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

export const isPositiveInteger = (n) => Number.isSafeInteger(n) && n > 0;
