// Daftar "buku" = spreadsheet-spreadsheet (satu per organisasi/kelompok) yang dikelola seorang pengguna.
//
// Penyimpanan, dari yang utama ke cadangan:
//  1. Google Drive appDataFolder (ikut akun Google ke semua perangkat) bila izin drive.appdata diberikan
//  2. localStorage browser (cermin & cadangan; satu-satunya bila Drive tidak tersedia)
//
// Isi berkas dianggap TIDAK TEPERCAYA (bisa rusak/diubah): selalu lewat normalizeRegistry().

import { ApiError, AuthError, friendlyMessage } from '../google/errors.js';

export const MAX_BOOKS = 30;
const ID_PATTERN = /^[a-zA-Z0-9_-]{20,}$/;

export const emptyRegistry = () => ({ version: 1, current: '', books: [] });

/** Bersihkan data mentah menjadi { version, current, books[{id,title,lastOpened}] } yang valid. */
export function normalizeRegistry(raw) {
  if (!raw || typeof raw !== 'object') return emptyRegistry();
  const seen = new Set();
  const books = [];
  for (const b of Array.isArray(raw.books) ? raw.books : []) {
    const id = typeof b?.id === 'string' ? b.id.trim() : '';
    if (!ID_PATTERN.test(id) || seen.has(id)) continue;
    seen.add(id);
    books.push({
      id,
      title: typeof b.title === 'string' ? b.title.trim().slice(0, 120) : '',
      lastOpened: typeof b.lastOpened === 'string' ? b.lastOpened.slice(0, 40) : '',
    });
    if (books.length >= MAX_BOOKS) break;
  }
  const current = typeof raw.current === 'string' && seen.has(raw.current) ? raw.current : '';
  return { version: 1, current, books };
}

/** Apakah mencatat buku ini sebagai aktif mengubah sesuatu yang bermakna (selain waktu buka)? */
export function needsUpdate(reg, { id, title }) {
  const existing = reg.books.find((b) => b.id === id);
  return reg.current !== id || !existing || (Boolean(title) && existing.title !== title);
}

/** Tandai buku sebagai aktif; tambahkan di akhir bila baru. Urutan buku stabil (tidak melompat saat berpindah). */
export function touchBook(reg, { id, title }, now = new Date()) {
  const index = reg.books.findIndex((b) => b.id === id);
  const entry = { id, title: title || reg.books[index]?.title || '', lastOpened: now.toISOString() };
  let books = index >= 0 ? reg.books.map((b, i) => (i === index ? entry : b)) : [...reg.books, entry];
  if (books.length > MAX_BOOKS) {
    // Buang yang paling lama tidak dibuka, jangan pernah buku yang sedang dibuka.
    const evict = books.filter((b) => b.id !== id).sort((a, b) => a.lastOpened.localeCompare(b.lastOpened))[0];
    books = books.filter((b) => b !== evict);
  }
  return { ...reg, current: id, books };
}

export function removeBook(reg, id) {
  return { ...reg, current: reg.current === id ? '' : reg.current, books: reg.books.filter((b) => b.id !== id) };
}

/**
 * Kondisi sinkronisasi Drive:
 *  ok | no-scope (izin tidak diberikan) | api-disabled (Drive API belum diaktifkan) | error (sementara gagal)
 */
export function classifyDriveError(err) {
  // Pesan asli Google ikut dibawa: memuat mis. nomor proyek Cloud, sehingga penyebabnya bisa dilacak pengguna.
  const detail = err instanceof ApiError ? `${err.status}${err.reason ? ` ${err.reason}` : ''}: ${err.message}`.slice(0, 400) : undefined;
  if (err instanceof ApiError && err.status === 403) {
    return /has not been used|is disabled|accessNotConfigured/i.test(`${err.message} ${err.reason}`)
      ? { state: 'api-disabled', detail }
      : { state: 'no-scope', detail };
  }
  return { state: 'error', message: friendlyMessage(err), detail };
}

/**
 * @param {object} deps
 * @param {{read(): Promise<unknown>, write(v: unknown): Promise<void>}} deps.drive
 * @param {() => boolean} deps.driveEnabled apakah izin Drive diberikan pada sesi ini
 * @param {{get(k: string): string|null, set(k: string, v: string): void}} deps.storage
 * @param {string} deps.prefix awalan kunci penyimpanan (membedakan mode demo dan sungguhan)
 * @param {() => Date} [deps.now]
 */
export function createRegistryService({ drive, driveEnabled, storage, prefix, now = () => new Date() }) {
  const booksKey = (email) => `${prefix}.books.${email}`;
  const legacyKey = (email) => `${prefix}.sheet.${email}`; // versi lama hanya mengingat satu spreadsheet

  function readLocal(email) {
    let raw = null;
    try {
      raw = JSON.parse(storage.get(booksKey(email)) ?? 'null');
    } catch {
      // abaikan data rusak
    }
    let reg = normalizeRegistry(raw);
    if (!reg.books.length) {
      const legacy = String(storage.get(legacyKey(email)) ?? '').trim();
      if (ID_PATTERN.test(legacy)) reg = touchBook(reg, { id: legacy, title: '' }, now());
    }
    return reg;
  }
  const writeLocal = (email, reg) => storage.set(booksKey(email), JSON.stringify(reg));

  const OK = { state: 'ok' };
  const NO_SCOPE = { state: 'no-scope' };

  return {
    /**
     * Muat daftar buku. Drive bila ada (menjadi acuan), selain itu browser.
     * Bila Drive belum punya berkas tetapi browser punya data (mis. pengguna lama), data browser dipindahkan ke Drive.
     * AuthError dilempar ulang; galat Drive lain jatuh ke cadangan browser.
     */
    async load(email) {
      const local = readLocal(email);
      if (!driveEnabled()) return { registry: local, status: NO_SCOPE };
      try {
        const remote = await drive.read();
        if (remote) {
          const reg = normalizeRegistry(remote);
          writeLocal(email, reg);
          return { registry: reg, status: OK };
        }
        if (local.books.length) await drive.write(local);
        return { registry: local, status: OK };
      } catch (err) {
        if (err instanceof AuthError) throw err;
        return { registry: local, status: classifyDriveError(err) };
      }
    },

    /**
     * Ubah daftar dengan pola baca-ubah-tulis (membaca versi terbaru dulu supaya perubahan perangkat lain tidak
     * tertimpa). `change` menerima daftar terkini dan mengembalikan daftar baru, atau objek yang sama bila tidak ada
     * perubahan (tidak ada yang ditulis).
     */
    async update(email, change) {
      let base = readLocal(email);
      let status = driveEnabled() ? OK : NO_SCOPE;
      if (status === OK) {
        try {
          const remote = await drive.read();
          if (remote) base = normalizeRegistry(remote);
        } catch (err) {
          if (err instanceof AuthError) throw err;
          status = classifyDriveError(err);
        }
      }
      const next = change(base);
      if (next === base) return { registry: base, status };

      writeLocal(email, next);
      if (status === OK) {
        try {
          await drive.write(next);
        } catch (err) {
          if (err instanceof AuthError) throw err;
          status = classifyDriveError(err);
        }
      }
      return { registry: next, status };
    },
  };
}
