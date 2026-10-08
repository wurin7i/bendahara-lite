// Klien tipis untuk Google Sheets API v4 (tanpa library tambahan).
// Hanya mengimplementasikan endpoint yang dipakai aplikasi.

import { ApiError, AuthError } from './errors.js';

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const MAX_RETRIES = 3;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {object} deps
 * @param {() => Promise<string>} deps.getToken mengembalikan access token yang masih berlaku
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 */
export function createSheetsApi({ getToken, fetchImpl = (...args) => globalThis.fetch(...args), sleep = defaultSleep }) {
  async function request(method, path, { query, body } = {}) {
    const url = new URL(BASE + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, v));
      else if (value !== undefined) url.searchParams.set(key, value);
    }

    for (let attempt = 0; ; attempt += 1) {
      const token = await getToken();
      let res;
      try {
        res = await fetchImpl(url.toString(), {
          method,
          headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch {
        throw new ApiError('Gagal terhubung', { status: 0, method });
      }
      if (res.ok) return res.status === 204 ? null : res.json();

      // 429 berarti permintaan belum diproses sehingga aman diulang. Galat 5xx hanya diulang untuk
      // GET/PUT yang idempoten; mengulang POST (append) berisiko menggandakan baris.
      const retryable = res.status === 429 || (res.status >= 500 && (method === 'GET' || method === 'PUT'));
      if (retryable && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt);
        continue;
      }
      throw await toApiError(res, method);
    }
  }

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

async function toApiError(res, method) {
  let message = res.statusText || 'Kesalahan tak dikenal';
  let reason = '';
  try {
    const json = await res.json();
    message = json?.error?.message ?? message;
    reason = json?.error?.status ?? json?.error?.errors?.[0]?.reason ?? '';
  } catch {
    // Badan respons bukan JSON; pakai statusText.
  }
  if (res.status === 401) return new AuthError(message);
  return new ApiError(message, { status: res.status, method, reason });
}
