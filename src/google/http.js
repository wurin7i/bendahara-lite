// Mesin HTTP bersama untuk Google API (Sheets, Drive): token Bearer, ulang-coba yang aman, pemetaan galat.

import { ApiError, AuthError } from './errors.js';

const MAX_RETRIES = 3;
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {object} deps
 * @param {() => Promise<string>} deps.getToken mengembalikan access token yang masih berlaku
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 * @param {() => boolean | Promise<boolean>} [deps.onUnauthorized] dipanggil saat Google membalas 401 (token ditolak).
 *   Bila mengembalikan true, token dianggap sudah diperbarui dan permintaan diulang SEKALI (401 berarti permintaan belum
 *   diproses, jadi aman diulang termasuk POST). Selain itu galat AuthError dilempar.
 */
export function createHttp({
  getToken,
  fetchImpl = (...args) => globalThis.fetch(...args),
  sleep = defaultSleep,
  onUnauthorized,
}) {
  /**
   * @param {string} method
   * @param {string} baseUrl URL lengkap tanpa query
   * @param {{query?: object, body?: any, as?: 'json' | 'text'}} [options] body dikirim sebagai JSON
   */
  async function request(method, baseUrl, { query, body, as = 'json' } = {}) {
    const url = new URL(baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, v));
      else if (value !== undefined) url.searchParams.set(key, value);
    }

    let retriedAfter401 = false;
    for (let attempt = 0; ; attempt += 1) {
      const token = await getToken();
      let res;
      try {
        res = await fetchImpl(url.toString(), {
          method,
          headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch {
        throw new ApiError('Gagal terhubung', { status: 0, method });
      }
      if (res.ok) {
        if (res.status === 204) return null;
        return as === 'text' ? res.text() : res.json();
      }

      if (res.status === 401 && !retriedAfter401) {
        retriedAfter401 = true;
        if (await onUnauthorized?.()) continue; // token baru akan diminta lewat getToken() pada putaran berikutnya
      }

      // 429 berarti permintaan belum diproses sehingga aman diulang. Galat 5xx hanya diulang untuk metode
      // idempoten (GET/PUT/PATCH); mengulang POST (append, create) berisiko menggandakan data.
      const idempotent = method === 'GET' || method === 'PUT' || method === 'PATCH';
      const retryable = res.status === 429 || (res.status >= 500 && idempotent);
      if (retryable && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt);
        continue;
      }
      throw await toApiError(res, method);
    }
  }

  return { request };
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
