// Klien tipis untuk Google Sheets API v4 (tanpa library tambahan).
// Hanya mengimplementasikan endpoint yang dipakai aplikasi.

import { createHttp } from './http.js';

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/** @param {Parameters<typeof createHttp>[0]} deps */
export function createSheetsApi(deps) {
  const http = createHttp(deps);
  const request = (method, path, options) => http.request(method, BASE + path, options);
  const id = encodeURIComponent;

  return {
    create: (body) => request('POST', '', { body }),

    get: (spreadsheetId, fields) => request('GET', `/${id(spreadsheetId)}`, { query: { fields } }),

    batchUpdate: (spreadsheetId, requests) =>
      request('POST', `/${id(spreadsheetId)}:batchUpdate`, { body: { requests } }),

    /** @returns {Promise<{valueRanges: {values?: any[][]}[]}>} */
    batchGetValues: (spreadsheetId, ranges) =>
      request('GET', `/${id(spreadsheetId)}/values:batchGet`, {
        query: { ranges, valueRenderOption: 'UNFORMATTED_VALUE', majorDimension: 'ROWS' },
      }),

    getValues: (spreadsheetId, range) =>
      request('GET', `/${id(spreadsheetId)}/values/${id(range)}`, {
        query: { valueRenderOption: 'UNFORMATTED_VALUE', majorDimension: 'ROWS' },
      }),

    // RAW = nilai disimpan apa adanya; teks seperti "=1+1" tidak pernah dievaluasi sebagai rumus.
    appendValues: (spreadsheetId, range, values) =>
      request('POST', `/${id(spreadsheetId)}/values/${id(range)}:append`, {
        query: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' },
        body: { majorDimension: 'ROWS', values },
      }),

    batchUpdateValues: (spreadsheetId, data) =>
      request('POST', `/${id(spreadsheetId)}/values:batchUpdate`, {
        body: { valueInputOption: 'RAW', data: data.map((d) => ({ majorDimension: 'ROWS', ...d })) },
      }),
  };
}
