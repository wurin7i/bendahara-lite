import { describe, expect, it } from 'vitest';
import { ApiError, AuthError } from '../../src/google/errors.js';
import { createHttp } from '../../src/google/http.js';

const respond = (status, body = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function setup(responses, { onUnauthorized } = {}) {
  const calls = [];
  let tokenCount = 0;
  const http = createHttp({
    getToken: async () => `t${++tokenCount}`,
    fetchImpl: async (url, init) => {
      calls.push({ method: init.method, auth: init.headers.Authorization });
      return responses.shift();
    },
    sleep: async () => {},
    onUnauthorized,
  });
  return { http, calls };
}

describe('401 dari Google', () => {
  it('bila pemanggil memperbarui token (true), permintaan diulang sekali dengan token baru', async () => {
    let asked = 0;
    const { http, calls } = setup([respond(401), respond(200, { ok: true })], { onUnauthorized: () => { asked += 1; return true; } });
    await expect(http.request('GET', 'https://example.test/x')).resolves.toEqual({ ok: true });
    expect(asked).toBe(1);
    expect(calls.map((c) => c.auth)).toEqual(['Bearer t1', 'Bearer t2']); // token diminta ulang saat mengulang
  });

  it('POST (tulis) juga aman diulang setelah 401 karena permintaan belum diproses', async () => {
    const { http, calls } = setup([respond(401), respond(200, { updated: 1 })], { onUnauthorized: () => true });
    await expect(http.request('POST', 'https://example.test/append', { body: { v: 1 } })).resolves.toEqual({ updated: 1 });
    expect(calls.map((c) => c.method)).toEqual(['POST', 'POST']);
  });

  it('401 lagi setelah token baru: menyerah dengan AuthError dan tidak berputar tanpa akhir', async () => {
    let asked = 0;
    const { http, calls } = setup([respond(401), respond(401)], { onUnauthorized: () => { asked += 1; return true; } });
    await expect(http.request('GET', 'https://example.test/x')).rejects.toBeInstanceOf(AuthError);
    expect(asked).toBe(1);
    expect(calls).toHaveLength(2);
  });

  it('bila pemanggil tidak bisa memperbarui (false/tanpa handler), langsung AuthError tanpa mengulang', async () => {
    const withFalse = setup([respond(401)], { onUnauthorized: () => false });
    await expect(withFalse.http.request('GET', 'https://example.test/x')).rejects.toBeInstanceOf(AuthError);
    expect(withFalse.calls).toHaveLength(1);

    const without = setup([respond(401)]);
    await expect(without.http.request('GET', 'https://example.test/x')).rejects.toBeInstanceOf(AuthError);
  });

  it('handler yang menunggu pengguna (async) ditunggu sebelum mengulang', async () => {
    const order = [];
    const { http } = setup([respond(401), respond(200, {})], {
      onUnauthorized: async () => {
        order.push('menunggu pengguna');
        await new Promise((r) => setTimeout(r, 5));
        order.push('pengguna melanjutkan');
        return true;
      },
    });
    await http.request('GET', 'https://example.test/x');
    expect(order).toEqual(['menunggu pengguna', 'pengguna melanjutkan']);
  });
});

describe('galat lain tidak terpengaruh', () => {
  it('403 tetap ApiError dan tidak memicu handler 401', async () => {
    let asked = 0;
    const { http } = setup([respond(403, { error: { message: 'no', status: 'PERMISSION_DENIED' } })], { onUnauthorized: () => { asked += 1; return true; } });
    await expect(http.request('GET', 'https://example.test/x')).rejects.toBeInstanceOf(ApiError);
    expect(asked).toBe(0);
  });

  it('PATCH (idempoten) diulang pada 503, POST tidak', async () => {
    const patch = setup([respond(503), respond(200, { ok: 1 })]);
    await expect(patch.http.request('PATCH', 'https://example.test/x')).resolves.toEqual({ ok: 1 });
    const post = setup([respond(503)]);
    await expect(post.http.request('POST', 'https://example.test/x', { body: {} })).rejects.toBeInstanceOf(ApiError);
    expect(post.calls).toHaveLength(1);
  });
});
