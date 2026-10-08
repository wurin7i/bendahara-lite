import { beforeEach, describe, expect, it } from 'vitest';
import { AuthError, ApiError, ConflictError, SchemaError, friendlyMessage } from '../../src/google/errors.js';
import { createRepository, createSpreadsheet, parseSpreadsheetId } from '../../src/google/repository.js';
import { TABLES, columnLetter, decodeRow, encodeRecord } from '../../src/google/schema.js';
import { createSheetsApi } from '../../src/google/sheetsApi.js';
import { createFakeFetch, createFakeSheetsServer, fakeToken, parseRange } from '../../src/dev/fakeGoogle.js';

const ME = 'bendahara@example.com';

function setup(email = ME, server = createFakeSheetsServer()) {
  const sleeps = [];
  const api = createSheetsApi({
    getToken: async () => fakeToken(email),
    fetchImpl: createFakeFetch(server),
    sleep: async (ms) => { sleeps.push(ms); },
  });
  return { server, api, sleeps };
}

async function freshRepo() {
  const { server, api, sleeps } = setup();
  const { spreadsheetId } = await createSpreadsheet(api, 'Kas Test');
  const repo = createRepository({ api, spreadsheetId, user: { email: ME }, now: () => new Date('2026-10-08T03:00:00Z') });
  await repo.initialize();
  return { server, api, sleeps, repo, spreadsheetId };
}

describe('schema codecs', () => {
  it('columnLetter', () => {
    expect([1, 8, 26, 27, 52].map(columnLetter)).toEqual(['A', 'H', 'Z', 'AA', 'AZ']);
  });

  it('round trip record <-> row', () => {
    const rec = { id: 'iur_1', periodId: 'per_1', memberId: 'agt_1', month: '2026-07', amount: 100000, date: '2026-07-05',
      note: '=HYPERLINK("http://evil")', split: { akn_1: 70000, umum: 30000 }, deleted: false, createdBy: 'a@b.c', createdAt: 'x' };
    const row = encodeRecord(TABLES.payments, rec);
    expect(decodeRow(TABLES.payments, row)).toEqual(rec);
  });

  it('decode toleran terhadap sel yang diedit manual di Sheets', () => {
    const row = ['iur_1', 'per_1', 'agt_1', 46204 /* serial */, '100000', 46204, '', 'bukan json', 'TRUE', '', ''];
    const rec = decodeRow(TABLES.payments, row);
    expect(rec).toMatchObject({ month: '2026-07', amount: 100000, date: '2026-07-01', split: {}, deleted: true });
  });
});

describe('parseSpreadsheetId', () => {
  it('menerima URL maupun ID polos', () => {
    const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';
    expect(parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`)).toBe(id);
    expect(parseSpreadsheetId(`  ${id} `)).toBe(id);
    expect(parseSpreadsheetId('halo')).toBeNull();
    expect(parseSpreadsheetId('')).toBeNull();
  });
});

describe('fake A1 parser', () => {
  it('menangani nama sheet bertanda kutip dan rentang terbuka', () => {
    expect(parseRange("'Akun Kas'!A2:A")).toMatchObject({ sheet: 'Akun Kas', r1: 1, c1: 0, c2: 0, r2: Infinity });
    expect(parseRange("'Anggota'!A:H")).toMatchObject({ r1: 0, c1: 0, c2: 7, r2: Infinity });
    expect(parseRange("'Iuran'!A5:K5")).toMatchObject({ r1: 4, r2: 4, c2: 10 });
  });
});

describe('createSpreadsheet + initialize', () => {
  it('membuat semua sheet dan menulis header + info', async () => {
    const { server, spreadsheetId } = await freshRepo();
    expect(server.sheetTitles(spreadsheetId)).toEqual(Object.values(TABLES).map((t) => t.sheet));
    expect(server.dump(spreadsheetId, 'Anggota')[0]).toEqual(TABLES.members.columns.map((c) => c.header));
    const info = server.dump(spreadsheetId, 'Info');
    expect(info.map((r) => r[0])).toEqual(['Kunci', 'app', 'schema_version', 'created_at']);
  });

  it('idempoten: initialize kedua tidak menulis apa pun', async () => {
    const { server, repo } = await freshRepo();
    const before = server.calls.length;
    const state = await repo.initialize();
    expect(state.ready).toBe(true);
    const writes = server.calls.slice(before).filter((c) => c.method !== 'GET');
    expect(writes).toEqual([]);
  });

  it('melengkapi spreadsheet lain yang belum punya sheet aplikasi tanpa menyentuh isi yang ada', async () => {
    const { server, api } = setup();
    const { spreadsheetId } = await api.create({ properties: { title: 'Punya Orang' } });
    await api.batchUpdateValues(spreadsheetId, [{ range: "'Sheet1'!A1:B1", values: [['rahasia', 123]] }]);
    const repo = createRepository({ api, spreadsheetId, user: { email: ME } });

    const before = await repo.inspect();
    expect(before.ready).toBe(false);
    expect(before.missing).toHaveLength(Object.keys(TABLES).length);

    await repo.initialize();
    expect(server.dump(spreadsheetId, 'Sheet1')).toEqual([['rahasia', 123]]);
    expect((await repo.inspect()).ready).toBe(true);
  });

  it('menolak sheet bernama sama tetapi strukturnya beda, tanpa menimpanya', async () => {
    const { server, api } = setup();
    const { spreadsheetId } = await api.create({ properties: { title: 'X' }, sheets: [{ properties: { title: 'Anggota' } }] });
    await api.batchUpdateValues(spreadsheetId, [{ range: "'Anggota'!A1:C1", values: [['Nama', 'Telp', 'Alamat']] }]);
    const repo = createRepository({ api, spreadsheetId, user: { email: ME } });
    await expect(repo.initialize()).rejects.toBeInstanceOf(SchemaError);
    expect(server.dump(spreadsheetId, 'Anggota')).toEqual([['Nama', 'Telp', 'Alamat']]);
    expect(server.sheetTitles(spreadsheetId)).toEqual(['Anggota']); // tidak menambah sheet
  });
});

describe('repository CRUD', () => {
  let ctx;
  beforeEach(async () => { ctx = await freshRepo(); });

  it('add menghasilkan id & audit, dan load mengembalikannya', async () => {
    const { repo } = ctx;
    const [m] = await repo.add('members', [{ name: 'Ani', contact: '08123456789', active: true }]);
    expect(m.id).toMatch(/^agt_[0-9a-z]{10}$/);
    expect(m).toMatchObject({ createdBy: ME, createdAt: '2026-10-08T03:00:00.000Z' });
    const data = await repo.load();
    expect(data.members).toEqual([m]);
    expect(data.members[0].contact).toBe('08123456789'); // nol di depan tidak hilang
  });

  it('teks yang mirip rumus disimpan sebagai teks (RAW), bukan dievaluasi', async () => {
    const { repo, server, spreadsheetId } = ctx;
    await repo.add('members', [{ name: '=1+1', active: true }]);
    expect(server.dump(spreadsheetId, 'Anggota')[1][1]).toBe('=1+1');
    expect((await repo.load()).members[0].name).toBe('=1+1');
  });

  it('update mencari baris lewat ID sehingga tetap benar walau urutan baris berubah', async () => {
    const { repo, api, server, spreadsheetId } = ctx;
    const [a, b] = await repo.add('members', [{ name: 'Ani', active: true }, { name: 'Budi', active: true }]);

    // Seseorang mengurutkan ulang di Sheets: Budi pindah ke baris 2, Ani ke baris 3.
    const [, rowA, rowB] = server.dump(spreadsheetId, 'Anggota');
    await api.batchUpdateValues(spreadsheetId, [{ range: "'Anggota'!A2:H3", values: [rowB, rowA] }]);
    expect(server.dump(spreadsheetId, 'Anggota').slice(1).map((r) => r[1])).toEqual(['Budi', 'Ani']);

    await repo.update('members', [{ ...b, name: 'Budi S.' }]);

    const names = server.dump(spreadsheetId, 'Anggota').slice(1).map((r) => r[1]);
    expect(names).toEqual(['Budi S.', 'Ani']); // yang berubah memang baris Budi, Ani utuh
    expect(a.id).not.toBe(b.id);
  });

  it('update pada baris yang sudah tidak ada -> ConflictError', async () => {
    const { repo } = ctx;
    await expect(repo.update('members', [{ id: 'agt_hilang', name: 'x' }])).rejects.toBeInstanceOf(ConflictError);
  });

  it('remove menandai Dihapus; baris tetap ada di Sheets tetapi tidak dimuat', async () => {
    const { repo, server, spreadsheetId } = ctx;
    const [p] = await repo.add('periods', [{ name: 'P1', startMonth: '2026-07', fee: 100000 }]);
    await repo.remove('periods', [p]);
    expect((await repo.load()).periods).toEqual([]);
    expect(server.dump(spreadsheetId, 'Periode')).toHaveLength(2);
  });

  it('remove ditolak untuk tabel tanpa kolom Dihapus', async () => {
    await expect(ctx.repo.remove('members', [{ id: 'x' }])).rejects.toThrow();
  });

  it('upsert memperbarui yang ada dan menambah yang baru, tanpa baris ganda', async () => {
    const { repo } = ctx;
    await repo.upsert('allocations', [{ id: 'p1:a1', periodId: 'p1', accountId: 'a1', amount: 50000 }]);
    await repo.upsert('allocations', [
      { id: 'p1:a1', periodId: 'p1', accountId: 'a1', amount: 60000 },
      { id: 'p1:a2', periodId: 'p1', accountId: 'a2', amount: 10000 },
    ]);
    const { allocations } = await repo.load();
    expect(allocations.map((a) => [a.id, a.amount])).toEqual([['p1:a1', 60000], ['p1:a2', 10000]]);
  });

  it('akun diurutkan menurut kolom Urutan', async () => {
    const { repo } = ctx;
    await repo.add('accounts', [
      { name: 'C', order: 3, active: true },
      { name: 'A', order: 1, active: true },
      { name: 'B', order: 2, active: true },
    ]);
    expect((await repo.load()).accounts.map((a) => a.name)).toEqual(['A', 'B', 'C']);
  });

  it('load gagal jelas bila header diubah orang', async () => {
    const { repo, api, spreadsheetId } = ctx;
    await api.batchUpdateValues(spreadsheetId, [{ range: "'Iuran'!B1", values: [['Salah']] }]);
    await expect(repo.load()).rejects.toThrow(/Header sheet "Iuran"/);
  });

  it('load mengabaikan baris kosong dan menormalkan baris yang kurang kolom', async () => {
    const { repo, api, spreadsheetId } = ctx;
    await api.batchUpdateValues(spreadsheetId, [{ range: "'Anggota'!A3:B3", values: [['agt_manual', 'Dewi']] }]);
    const { members } = await repo.load();
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ id: 'agt_manual', name: 'Dewi', active: false, contact: '' });
  });
});

describe('akses & ketahanan', () => {
  it('akun tanpa izin mendapat 403 yang diterjemahkan jadi pesan ramah', async () => {
    const owner = setup();
    const { spreadsheetId } = await createSpreadsheet(owner.api, 'Rahasia');
    const intruder = setup('orang.lain@example.com', owner.server);
    const repo = createRepository({ api: intruder.api, spreadsheetId, user: { email: 'orang.lain@example.com' } });
    const err = await repo.load().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(friendlyMessage(err)).toMatch(/tidak punya akses/);
  });

  it('akun dengan akses baca bisa membaca tetapi gagal menulis', async () => {
    const owner = setup();
    const { spreadsheetId } = await createSpreadsheet(owner.api, 'Kas');
    await createRepository({ api: owner.api, spreadsheetId, user: { email: ME } }).initialize();
    owner.server.share(spreadsheetId, 'anggota@example.com', 'reader');

    const viewer = setup('anggota@example.com', owner.server);
    const repo = createRepository({ api: viewer.api, spreadsheetId, user: { email: 'anggota@example.com' } });
    await expect(repo.load()).resolves.toBeTruthy();
    const err = await repo.add('members', [{ name: 'X' }]).catch((e) => e);
    expect(err.status).toBe(403);
    expect(friendlyMessage(err)).toMatch(/hanya punya akses baca/);
  });

  it('spreadsheet yang tidak ada -> 404 dengan pesan ramah', async () => {
    const { api } = setup();
    const repo = createRepository({ api, spreadsheetId: 'tidakada', user: { email: ME } });
    const err = await repo.load().catch((e) => e);
    expect(err.status).toBe(404);
    expect(friendlyMessage(err)).toMatch(/tidak ditemukan/);
  });

  it('429 diulang dengan jeda, lalu berhasil', async () => {
    const { repo, server, sleeps } = await freshRepo();
    server.failNext(429, 'Quota exceeded', { times: 2 });
    await expect(repo.load()).resolves.toBeTruthy();
    expect(sleeps).toEqual([500, 1000]);
  });

  it('5xx pada GET diulang, tetapi pada append TIDAK diulang (hindari baris ganda)', async () => {
    const { repo, server, spreadsheetId } = await freshRepo();
    server.failNext(503, 'Backend error');
    await expect(repo.load()).resolves.toBeTruthy();

    server.failNext(503, 'Backend error');
    const err = await repo.add('members', [{ name: 'Ani' }]).catch((e) => e);
    expect(err.status).toBe(503);
    expect(server.dump(spreadsheetId, 'Anggota')).toHaveLength(1); // hanya header
  });

  it('401 menjadi AuthError dan memberi tahu pemanggil agar sesi dibatalkan', async () => {
    const server = createFakeSheetsServer();
    let rejected = 0;
    const api = createSheetsApi({
      getToken: async () => fakeToken(ME),
      fetchImpl: createFakeFetch(server),
      sleep: async () => {},
      onUnauthorized: () => { rejected += 1; },
    });
    const { spreadsheetId } = await createSpreadsheet(api, 'Kas');
    const repo = createRepository({ api, spreadsheetId, user: { email: ME } });
    await repo.initialize();
    expect(rejected).toBe(0);

    server.failNext(401, 'Invalid Credentials');
    const err = await repo.load().catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(rejected).toBe(1);
  });

  it('token palsu/tidak dikenal ditolak 401 oleh Google (kasus sisa sesi demo di mode sungguhan)', async () => {
    const server = createFakeSheetsServer();
    let rejected = 0;
    const api = createSheetsApi({
      getToken: async () => 'ya29.token-yang-tidak-valid',
      fetchImpl: createFakeFetch(server),
      onUnauthorized: () => { rejected += 1; },
    });
    const err = await createRepository({ api, spreadsheetId: 'apapun', user: { email: ME } }).load().catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(rejected).toBe(1);
  });
});
