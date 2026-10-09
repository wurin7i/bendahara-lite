// Lapisan data: membaca/menulis tabel-tabel aplikasi ke Google Spreadsheet.
//
// Prinsip:
//  - Baris tidak pernah dihapus. "Hapus" = menandai kolom Dihapus agar riwayat terjaga dan nomor baris stabil.
//  - Setiap pembaruan mencari baris berdasarkan ID di kolom A pada saat itu juga (bukan nomor baris yang
//    tersimpan), sehingga aman bila orang lain menyisipkan/mengurutkan baris di Sheets.
//  - Penulisan memakai valueInputOption=RAW.

import { newId } from '../lib/ids.js';
import { splitAccounts } from '../lib/pockets.js';
import { ConflictError, SchemaError } from './errors.js';
import {
  APP_ID, CORE_TABLE_KEYS, FEATURES, SCHEMA_VERSION, TABLES, TABLE_KEYS, appendRange, decodeRow, emptyRecord, encodeRecord,
  fullRange, hasDeletedColumn, headerMatches, headerRange, headersOf, idColumnRange, isBlankRow, rowRange,
} from './schema.js';

/** Ambil ID spreadsheet dari URL Google Sheets atau ID polos. */
export function parseSpreadsheetId(input) {
  const text = String(input ?? '').trim();
  const fromUrl = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(text);
  if (fromUrl) return fromUrl[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(text) ? text : null;
}

/** Buat spreadsheet baru berisi sheet inti aplikasi (header ditulis oleh initialize()). Sheet fitur opsional tidak ikut. */
export async function createSpreadsheet(api, title) {
  // Hanya judul dan sheet yang dikirim. Locale/zona waktu sengaja tidak diatur: aplikasi menulis nilai
  // mentah (RAW) sehingga tidak berpengaruh, dan Google menolak locale yang tidak didukung (mis. "id_ID").
  const created = await api.create({
    properties: { title },
    sheets: CORE_TABLE_KEYS.map((key) => ({
      properties: { title: TABLES[key].sheet, gridProperties: { frozenRowCount: 1 } },
    })),
  });
  return { spreadsheetId: created.spreadsheetId, url: created.spreadsheetUrl ?? null };
}

export function createRepository({ api, spreadsheetId, user, now = () => new Date() }) {
  const infoOf = (rows) => Object.fromEntries(rows.map((r) => [r.id, r.value]));

  // Status fitur opsional dari pemeriksaan terakhir; load() hanya membaca sheet fitur yang aktif, karena Sheets
  // menolak seluruh batchGet bila satu rentang menunjuk sheet yang tidak ada.
  let features = null;

  /**
   * Periksa kondisi spreadsheet tanpa mengubah apa pun. `missing`, `emptyHeader`, dan `mismatched` hanya untuk tabel
   * inti; tabel fitur opsional dilaporkan lewat `features` ('off' | 'on' | 'partial' | 'mismatched').
   * @returns {{title, url, missing: string[], emptyHeader: string[], mismatched: string[], ready: boolean,
   *   features: Record<string, string>, status: Record<string, string>}}
   */
  async function inspect() {
    const meta = await api.get(spreadsheetId, 'properties.title,spreadsheetUrl,sheets.properties(sheetId,title)');
    const existing = new Map((meta.sheets ?? []).map((s) => [s.properties.title, s.properties.sheetId]));
    const present = TABLE_KEYS.filter((k) => existing.has(TABLES[k].sheet));

    // status per tabel: 'missing' | 'empty' | 'mismatched' | 'ok'
    const status = Object.fromEntries(TABLE_KEYS.map((k) => [k, 'missing']));
    if (present.length) {
      const res = await api.batchGetValues(spreadsheetId, present.map((k) => headerRange(TABLES[k])));
      present.forEach((k, i) => {
        const row = res.valueRanges?.[i]?.values?.[0];
        status[k] = isBlankRow(row) ? 'empty' : headerMatches(TABLES[k], row) ? 'ok' : 'mismatched';
      });
    }
    const coreWith = (value) => CORE_TABLE_KEYS.filter((k) => status[k] === value);
    const missing = coreWith('missing');
    const emptyHeader = coreWith('empty');
    const mismatched = coreWith('mismatched');

    features = Object.fromEntries(
      Object.entries(FEATURES).map(([name, keys]) => {
        const states = keys.map((k) => status[k]);
        if (states.includes('mismatched')) return [name, 'mismatched'];
        if (states.every((s) => s === 'ok')) return [name, 'on'];
        if (states.every((s) => s === 'missing')) return [name, 'off'];
        return [name, 'partial'];
      }),
    );

    return {
      title: meta.properties?.title ?? '',
      url: meta.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
      sheetIds: existing,
      missing,
      emptyHeader,
      mismatched,
      ready: !missing.length && !emptyHeader.length && !mismatched.length,
      features: { ...features },
      status,
    };
  }

  /** Tambah sheet yang belum ada dan tulis header yang masih kosong untuk tabel `keys` (tidak menimpa isi). */
  async function ensureTables(keys, status) {
    const toAdd = keys.filter((k) => status[k] === 'missing');
    if (toAdd.length) {
      await api.batchUpdate(
        spreadsheetId,
        toAdd.map((k) => ({
          addSheet: { properties: { title: TABLES[k].sheet, gridProperties: { frozenRowCount: 1 } } },
        })),
      );
    }

    await api.batchUpdateValues(
      spreadsheetId,
      keys.map((k) => ({ range: headerRange(TABLES[k]), values: [headersOf(TABLES[k])] })),
    );

    // Format: header tebal, baris pertama dibekukan, kolom teks/tanggal bertipe teks supaya ID, nomor telepon
    // dan "2026-07" tidak diubah Sheets menjadi angka/tanggal bila seseorang mengetik manual.
    const after = await api.get(spreadsheetId, 'sheets.properties(sheetId,title)');
    const sheetIds = new Map((after.sheets ?? []).map((s) => [s.properties.title, s.properties.sheetId]));
    const requests = [];
    for (const k of keys) {
      const table = TABLES[k];
      const sheetId = sheetIds.get(table.sheet);
      if (sheetId === undefined) continue;
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: true },
              backgroundColor: { red: 0.88, green: 0.95, blue: 0.93 },
              numberFormat: { type: 'TEXT' },
            },
          },
          fields: 'userEnteredFormat(textFormat,backgroundColor,numberFormat)',
        },
      });
      requests.push({
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
          fields: 'gridProperties.frozenRowCount',
        },
      });
      table.columns.forEach((c, index) => {
        if (['number', 'bool'].includes(c.type)) return;
        requests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: 1, startColumnIndex: index, endColumnIndex: index + 1 },
            cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } },
            fields: 'userEnteredFormat.numberFormat',
          },
        });
      });
      requests.push({
        autoResizeDimensions: {
          dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: table.columns.length },
        },
      });
    }
    if (requests.length) await api.batchUpdate(spreadsheetId, requests);
  }

  /**
   * Lengkapi struktur inti: tambah sheet yang belum ada dan tulis header yang masih kosong.
   * Tidak pernah menimpa sheet/header yang sudah berisi, dan tidak membuat sheet fitur opsional.
   */
  async function initialize() {
    const state = await inspect();
    if (state.mismatched.length) {
      const names = state.mismatched.map((k) => `"${TABLES[k].sheet}"`).join(', ');
      throw new SchemaError(`Sheet ${names} sudah ada tetapi strukturnya tidak sesuai. Ganti nama sheet tersebut atau gunakan spreadsheet baru.`);
    }
    if (state.ready) return state;

    const toWrite = [...state.missing, ...state.emptyHeader];
    await ensureTables(toWrite, state.status);

    if (toWrite.includes('info')) {
      await add('info', [
        { id: 'app', value: APP_ID },
        { id: 'schema_version', value: String(SCHEMA_VERSION) },
        { id: 'created_at', value: now().toISOString() },
      ]);
    }
    return inspect();
  }

  /** Aktifkan fitur opsional: buat sheet-sheetnya (idempoten, melengkapi yang belum lengkap). */
  async function enableFeature(name) {
    const keys = FEATURES[name];
    if (!keys) throw new Error(`Fitur ${name} tidak dikenal.`);
    const state = await inspect();
    const bad = keys.filter((k) => state.status[k] === 'mismatched');
    if (bad.length) {
      const names = bad.map((k) => `"${TABLES[k].sheet}"`).join(', ');
      throw new SchemaError(`Sheet ${names} sudah ada tetapi strukturnya tidak sesuai. Ganti nama sheet tersebut lalu aktifkan lagi.`);
    }
    const toWrite = keys.filter((k) => state.status[k] !== 'ok');
    if (toWrite.length) await ensureTables(toWrite, state.status);
    return inspect();
  }

  /**
   * Muat seluruh tabel (tanpa baris yang ditandai dihapus). Tabel fitur yang tidak aktif dikembalikan kosong.
   * `refresh` memeriksa ulang sheet yang ada (mis. fitur diaktifkan dari perangkat lain).
   */
  async function load({ refresh = false } = {}) {
    if (refresh || !features) await inspect();
    const keys = TABLE_KEYS.filter((k) => !TABLES[k].feature || features[TABLES[k].feature] === 'on');
    const res = await api.batchGetValues(spreadsheetId, keys.map((k) => fullRange(TABLES[k])));
    const data = Object.fromEntries(TABLE_KEYS.map((k) => [k, []]));
    keys.forEach((key, i) => {
      const table = TABLES[key];
      const rows = res.valueRanges?.[i]?.values ?? [];
      if (isBlankRow(rows[0])) {
        throw new SchemaError(`Sheet "${table.sheet}" belum diinisialisasi. Hubungkan ulang spreadsheet untuk melengkapinya.`);
      }
      if (!headerMatches(table, rows[0])) {
        throw new SchemaError(`Header sheet "${table.sheet}" tidak sesuai. Jangan mengubah, menambah, atau memindah kolom pada baris judul.`);
      }
      let records = rows.slice(1).filter((r) => !isBlankRow(r)).map((r) => decodeRow(table, r));
      if (hasDeletedColumn(table)) records = records.filter((r) => !r.deleted);
      data[key] = records;
    });

    const version = Number(infoOf(data.info).schema_version);
    if (version > SCHEMA_VERSION) {
      throw new SchemaError('Spreadsheet ini dibuat dengan versi aplikasi yang lebih baru. Perbarui aplikasi terlebih dahulu.');
    }
    data.accounts.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'id'));
    Object.assign(data, splitAccounts(data.accounts)); // kantong patungan -> data.pockets
    data.info = infoOf(data.info);
    data.features = { ...features };
    return data;
  }

  function stamp(table, record) {
    const out = { ...emptyRecord(table), ...record };
    if (!out.id) out.id = newId(table.prefix);
    const keys = table.columns.map((c) => c.key);
    if (keys.includes('createdAt') && !out.createdAt) out.createdAt = now().toISOString();
    if (keys.includes('createdBy') && !out.createdBy) out.createdBy = user?.email ?? '';
    return out;
  }

  /** Tambah baris baru; mengembalikan record lengkap (dengan id & audit). */
  async function add(tableKey, records) {
    const table = TABLES[tableKey];
    const stamped = records.map((r) => stamp(table, r));
    if (!stamped.length) return [];
    await api.appendValues(spreadsheetId, appendRange(table), stamped.map((r) => encodeRecord(table, r)));
    return stamped;
  }

  async function locateRows(table) {
    const res = await api.getValues(spreadsheetId, idColumnRange(table));
    const rows = new Map();
    (res.values ?? []).forEach((row, i) => {
      const id = row?.[0];
      if (id !== undefined && id !== '' && !rows.has(String(id))) rows.set(String(id), i + 2);
    });
    return rows;
  }

  /** Timpa baris yang sudah ada (dicari lewat ID). */
  async function update(tableKey, records) {
    const table = TABLES[tableKey];
    if (!records.length) return;
    const rows = await locateRows(table);
    const data = records.map((r) => {
      const row = rows.get(String(r.id));
      if (!row) throw new ConflictError('Baris yang akan diubah sudah tidak ada di spreadsheet.');
      return { range: rowRange(table, row), values: [encodeRecord(table, r)] };
    });
    await api.batchUpdateValues(spreadsheetId, data);
  }

  /** Perbarui bila ID sudah ada, selain itu tambahkan. */
  async function upsert(tableKey, records) {
    const table = TABLES[tableKey];
    const rows = await locateRows(table);
    const existing = records.filter((r) => rows.has(String(r.id)));
    const fresh = records.filter((r) => !rows.has(String(r.id)));
    if (existing.length) {
      await api.batchUpdateValues(
        spreadsheetId,
        existing.map((r) => ({ range: rowRange(table, rows.get(String(r.id))), values: [encodeRecord(table, r)] })),
      );
    }
    if (fresh.length) await add(tableKey, fresh);
  }

  /** Tandai dihapus (baris tetap ada di Sheets). */
  async function remove(tableKey, records) {
    if (!hasDeletedColumn(TABLES[tableKey])) throw new Error(`Tabel ${tableKey} tidak mendukung penghapusan.`);
    await update(tableKey, records.map((r) => ({ ...r, deleted: true })));
  }

  return { inspect, initialize, enableFeature, load, add, update, upsert, remove };
}
