// Lapisan data: membaca/menulis tabel-tabel aplikasi ke Google Spreadsheet.
//
// Prinsip:
//  - Baris tidak pernah dihapus. "Hapus" = menandai kolom Dihapus agar riwayat terjaga dan nomor baris stabil.
//  - Setiap pembaruan mencari baris berdasarkan ID di kolom A pada saat itu juga (bukan nomor baris yang
//    tersimpan), sehingga aman bila orang lain menyisipkan/mengurutkan baris di Sheets.
//  - Penulisan memakai valueInputOption=RAW.

import { newId } from '../lib/ids.js';
import { ConflictError, SchemaError } from './errors.js';
import {
  APP_ID, SCHEMA_VERSION, TABLES, TABLE_KEYS, appendRange, decodeRow, emptyRecord, encodeRecord,
  fullRange, hasDeletedColumn, headerMatches, headerRange, headersOf, idColumnRange, isBlankRow, rowRange,
} from './schema.js';

/** Ambil ID spreadsheet dari URL Google Sheets atau ID polos. */
export function parseSpreadsheetId(input) {
  const text = String(input ?? '').trim();
  const fromUrl = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(text);
  if (fromUrl) return fromUrl[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(text) ? text : null;
}

/** Buat spreadsheet baru berisi semua sheet aplikasi (header ditulis oleh initialize()). */
export async function createSpreadsheet(api, title) {
  // Hanya judul dan sheet yang dikirim. Locale/zona waktu sengaja tidak diatur: aplikasi menulis nilai
  // mentah (RAW) sehingga tidak berpengaruh, dan Google menolak locale yang tidak didukung (mis. "id_ID").
  const created = await api.create({
    properties: { title },
    sheets: TABLE_KEYS.map((key) => ({
      properties: { title: TABLES[key].sheet, gridProperties: { frozenRowCount: 1 } },
    })),
  });
  return { spreadsheetId: created.spreadsheetId, url: created.spreadsheetUrl ?? null };
}

export function createRepository({ api, spreadsheetId, user, now = () => new Date() }) {
  const infoOf = (rows) => Object.fromEntries(rows.map((r) => [r.id, r.value]));

  /**
   * Periksa kondisi spreadsheet tanpa mengubah apa pun.
   * @returns {{title, url, missing: string[], emptyHeader: string[], mismatched: string[], ready: boolean}}
   */
  async function inspect() {
    const meta = await api.get(spreadsheetId, 'properties.title,spreadsheetUrl,sheets.properties(sheetId,title)');
    const existing = new Map((meta.sheets ?? []).map((s) => [s.properties.title, s.properties.sheetId]));
    const missing = TABLE_KEYS.filter((k) => !existing.has(TABLES[k].sheet));
    const present = TABLE_KEYS.filter((k) => existing.has(TABLES[k].sheet));

    const emptyHeader = [];
    const mismatched = [];
    if (present.length) {
      const res = await api.batchGetValues(spreadsheetId, present.map((k) => headerRange(TABLES[k])));
      present.forEach((k, i) => {
        const row = res.valueRanges?.[i]?.values?.[0];
        if (isBlankRow(row)) emptyHeader.push(k);
        else if (!headerMatches(TABLES[k], row)) mismatched.push(k);
      });
    }
    return {
      title: meta.properties?.title ?? '',
      url: meta.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
      sheetIds: existing,
      missing,
      emptyHeader,
      mismatched,
      ready: !missing.length && !emptyHeader.length && !mismatched.length,
    };
  }

  /**
   * Lengkapi struktur: tambah sheet yang belum ada dan tulis header yang masih kosong.
   * Tidak pernah menimpa sheet/header yang sudah berisi.
   */
  async function initialize() {
    const state = await inspect();
    if (state.mismatched.length) {
      const names = state.mismatched.map((k) => `"${TABLES[k].sheet}"`).join(', ');
      throw new SchemaError(`Sheet ${names} sudah ada tetapi strukturnya tidak sesuai. Ganti nama sheet tersebut atau gunakan spreadsheet baru.`);
    }
    if (state.ready) return state;

    if (state.missing.length) {
      await api.batchUpdate(
        spreadsheetId,
        state.missing.map((k) => ({
          addSheet: { properties: { title: TABLES[k].sheet, gridProperties: { frozenRowCount: 1 } } },
        })),
      );
    }

    const toWrite = [...state.missing, ...state.emptyHeader];
    await api.batchUpdateValues(
      spreadsheetId,
      toWrite.map((k) => ({ range: headerRange(TABLES[k]), values: [headersOf(TABLES[k])] })),
    );

    // Format: header tebal, baris pertama dibekukan, kolom teks/tanggal bertipe teks supaya ID, nomor telepon
    // dan "2026-07" tidak diubah Sheets menjadi angka/tanggal bila seseorang mengetik manual.
    const after = await api.get(spreadsheetId, 'sheets.properties(sheetId,title)');
    const sheetIds = new Map((after.sheets ?? []).map((s) => [s.properties.title, s.properties.sheetId]));
    const requests = [];
    for (const k of toWrite) {
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

    if (toWrite.includes('info')) {
      await add('info', [
        { id: 'app', value: APP_ID },
        { id: 'schema_version', value: String(SCHEMA_VERSION) },
        { id: 'created_at', value: now().toISOString() },
      ]);
    }
    return inspect();
  }

  /** Muat seluruh tabel (tanpa baris yang ditandai dihapus). */
  async function load() {
    const res = await api.batchGetValues(spreadsheetId, TABLE_KEYS.map((k) => fullRange(TABLES[k])));
    const data = {};
    TABLE_KEYS.forEach((key, i) => {
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
    data.info = infoOf(data.info);
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

  return { inspect, initialize, load, add, update, upsert, remove };
}
