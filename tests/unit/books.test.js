import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError, AuthError } from '../../src/google/errors.js';
import { createDriveStore } from '../../src/google/driveStore.js';
import { createFakeFetch, createFakeSheetsServer, fakeToken } from '../../src/dev/fakeGoogle.js';
import {
  MAX_BOOKS, classifyDriveError, createRegistryService, emptyRegistry, needsUpdate, normalizeRegistry, removeBook, touchBook,
} from '../../src/state/books.js';

const ME = 'bendahara@example.com';
const id = (n) => `book${String(n).padStart(2, '0')}${'x'.repeat(20)}`;
const NOW = new Date('2026-10-08T03:00:00Z');

describe('normalizeRegistry', () => {
  it('membuang data rusak, ID tidak valid, duplikat, dan current yang tidak ada di daftar', () => {
    const reg = normalizeRegistry({
      current: 'tidak-ada',
      books: [
        { id: id(1), title: '  Kas RT  ', lastOpened: '2026-01-01' },
        { id: id(1), title: 'duplikat' },
        { id: 'pendek', title: 'ID tidak valid' },
        { id: 123, title: 'bukan string' },
        null,
        'sampah',
        { id: id(2), title: 42 },
      ],
    });
    expect(reg.books.map((b) => b.id)).toEqual([id(1), id(2)]);
    expect(reg.books[0].title).toBe('Kas RT');
    expect(reg.books[1].title).toBe('');
    expect(reg.current).toBe('');
  });

  it('tahan terhadap masukan bukan objek', () => {
    for (const bad of [null, undefined, 'x', 5, [], { books: 'x' }]) {
      expect(normalizeRegistry(bad)).toEqual(emptyRegistry());
    }
  });

  it('membatasi jumlah buku dan memotong judul panjang', () => {
    const many = Array.from({ length: MAX_BOOKS + 10 }, (_, i) => ({ id: id(i), title: 'x'.repeat(500) }));
    const reg = normalizeRegistry({ books: many });
    expect(reg.books).toHaveLength(MAX_BOOKS);
    expect(reg.books[0].title).toHaveLength(120);
  });
});

describe('touchBook / removeBook / needsUpdate', () => {
  it('buku baru ditambahkan di akhir dan menjadi aktif; urutan tidak melompat saat berpindah', () => {
    let reg = touchBook(emptyRegistry(), { id: id(1), title: 'A' }, NOW);
    reg = touchBook(reg, { id: id(2), title: 'B' }, NOW);
    reg = touchBook(reg, { id: id(1), title: 'A' }, NOW);
    expect(reg.books.map((b) => b.title)).toEqual(['A', 'B']);
    expect(reg.current).toBe(id(1));
  });

  it('judul kosong tidak menimpa judul yang sudah ada', () => {
    const reg = touchBook(touchBook(emptyRegistry(), { id: id(1), title: 'Kas RT' }, NOW), { id: id(1), title: '' }, NOW);
    expect(reg.books[0].title).toBe('Kas RT');
  });

  it('saat penuh, buku paling lama dibuka dibuang, bukan yang sedang dibuka', () => {
    let reg = emptyRegistry();
    for (let i = 0; i < MAX_BOOKS; i += 1) reg = touchBook(reg, { id: id(i), title: `B${i}` }, new Date(2026, 0, i + 1));
    reg = touchBook(reg, { id: id(99), title: 'Baru' }, new Date(2026, 11, 1));
    expect(reg.books).toHaveLength(MAX_BOOKS);
    expect(reg.books.some((b) => b.id === id(0))).toBe(false); // terlama
    expect(reg.books.some((b) => b.id === id(99))).toBe(true);
    expect(reg.current).toBe(id(99));
  });

  it('removeBook mengosongkan current hanya bila yang dihapus adalah yang aktif', () => {
    const reg = touchBook(touchBook(emptyRegistry(), { id: id(1), title: 'A' }, NOW), { id: id(2), title: 'B' }, NOW);
    expect(removeBook(reg, id(1)).current).toBe(id(2));
    expect(removeBook(reg, id(2)).current).toBe('');
    expect(removeBook(reg, id(2)).books.map((b) => b.id)).toEqual([id(1)]);
  });

  it('needsUpdate: tidak menulis ulang bila tidak ada perubahan bermakna', () => {
    const reg = touchBook(emptyRegistry(), { id: id(1), title: 'A' }, NOW);
    expect(needsUpdate(reg, { id: id(1), title: 'A' })).toBe(false);
    expect(needsUpdate(reg, { id: id(1), title: '' })).toBe(false);
    expect(needsUpdate(reg, { id: id(1), title: 'A baru' })).toBe(true);
    expect(needsUpdate(reg, { id: id(2), title: 'B' })).toBe(true);
    expect(needsUpdate({ ...reg, current: '' }, { id: id(1), title: 'A' })).toBe(true);
  });
});

describe('classifyDriveError', () => {
  it('membedakan Drive API mati, izin kurang, dan galat lain', () => {
    expect(classifyDriveError(new ApiError('Google Drive API has not been used in project 1', { status: 403 })).state).toBe('api-disabled');
    expect(classifyDriveError(new ApiError('Request had insufficient authentication scopes.', { status: 403 })).state).toBe('no-scope');
    expect(classifyDriveError(new ApiError('Backend error', { status: 503 })).state).toBe('error');
    expect(classifyDriveError(new Error('putus')).state).toBe('error');
  });
});

/* ---------- layanan: Drive palsu + penyimpanan browser palsu ---------- */

function memoryStorage() {
  const map = new Map();
  return { get: (k) => map.get(k) ?? null, set: (k, v) => map.set(k, v), map };
}

function device({ server, email = ME, drive = true, storage = memoryStorage() }) {
  const store = createDriveStore({ getToken: async () => fakeToken(email, { drive }), fetchImpl: createFakeFetch(server), sleep: async () => {} });
  const service = createRegistryService({ drive: store, driveEnabled: () => drive, storage, prefix: 'bendahara', now: () => NOW });
  return { service, storage, email };
}

describe('layanan daftar buku', () => {
  let server;
  beforeEach(() => { server = createFakeSheetsServer(); });

  it('perangkat kedua dengan akun yang sama langsung menemukan buku dari perangkat pertama', async () => {
    const macbook = device({ server });
    await macbook.service.update(ME, (r) => touchBook(r, { id: id(1), title: 'Kas RT 05' }, NOW));

    const thinkpad = device({ server }); // penyimpanan browser kosong
    const { registry, status } = await thinkpad.service.load(ME);
    expect(status.state).toBe('ok');
    expect(registry.current).toBe(id(1));
    expect(registry.books).toEqual([{ id: id(1), title: 'Kas RT 05', lastOpened: NOW.toISOString() }]);
  });

  it('akun Google berbeda tidak melihat daftar akun lain', async () => {
    await device({ server }).service.update(ME, (r) => touchBook(r, { id: id(1), title: 'Rahasia' }, NOW));
    const other = device({ server, email: 'lain@example.com' });
    expect((await other.service.load('lain@example.com')).registry.books).toEqual([]);
  });

  it('pengguna lama: pilihan satu-spreadsheet di browser dipindahkan ke Drive saat pertama kali', async () => {
    const macbook = device({ server });
    macbook.storage.set(`bendahara.sheet.${ME}`, id(7)); // kunci versi lama
    const { registry } = await macbook.service.load(ME);
    expect(registry.current).toBe(id(7));
    expect(server.dumpDrive(ME)[0].content.current).toBe(id(7));

    // perangkat lain kini mengenalinya
    expect((await device({ server }).service.load(ME)).registry.current).toBe(id(7));
  });

  it('bila Drive sudah punya data, Drive menjadi acuan dan data browser yang usang tidak menghidupkan lagi buku yang dihapus', async () => {
    const a = device({ server });
    await a.service.update(ME, (r) => touchBook(touchBook(r, { id: id(1), title: 'A' }, NOW), { id: id(2), title: 'B' }, NOW));
    const b = device({ server });
    await b.service.load(ME); // b mengingat A dan B di browsernya

    await a.service.update(ME, (r) => removeBook(r, id(1))); // A dihapus dari daftar di perangkat a
    const reloaded = await b.service.load(ME);
    expect(reloaded.registry.books.map((x) => x.id)).toEqual([id(2)]);
  });

  it('baca-ubah-tulis: perubahan dari dua perangkat tidak saling menimpa', async () => {
    const a = device({ server });
    const b = device({ server });
    await a.service.load(ME);
    await b.service.load(ME); // keduanya mulai dari daftar kosong
    await a.service.update(ME, (r) => touchBook(r, { id: id(1), title: 'A' }, NOW));
    await b.service.update(ME, (r) => touchBook(r, { id: id(2), title: 'B' }, NOW)); // b tidak tahu soal A
    const { registry } = await a.service.load(ME);
    expect(registry.books.map((x) => x.title)).toEqual(['A', 'B']);
    expect(registry.current).toBe(id(2));
  });

  it('tidak menulis ke Drive bila tidak ada perubahan', async () => {
    const a = device({ server });
    await a.service.update(ME, (r) => touchBook(r, { id: id(1), title: 'A' }, NOW));
    const writes = () => server.calls.filter((c) => c.method !== 'GET').length;
    const before = writes();
    await a.service.update(ME, (r) => (needsUpdate(r, { id: id(1), title: 'A' }) ? touchBook(r, { id: id(1), title: 'A' }, NOW) : r));
    expect(writes()).toBe(before);
  });

  it('izin Drive tidak diberikan: tetap bekerja lewat browser, status no-scope, tanpa memanggil Drive', async () => {
    const d = device({ server, drive: false });
    const result = await d.service.update(ME, (r) => touchBook(r, { id: id(1), title: 'A' }, NOW));
    expect(result.status.state).toBe('no-scope');
    expect((await d.service.load(ME)).registry.current).toBe(id(1));
    expect(server.calls.filter((c) => c.path.includes('/drive/'))).toEqual([]);
  });

  it('Drive API belum diaktifkan di proyek Cloud: jatuh ke browser dengan status api-disabled', async () => {
    server.setDriveApiEnabled(false);
    const d = device({ server });
    const result = await d.service.update(ME, (r) => touchBook(r, { id: id(1), title: 'A' }, NOW));
    expect(result.status.state).toBe('api-disabled');
    expect(result.registry.current).toBe(id(1)); // tetap tersimpan di browser
    expect((await d.service.load(ME)).status.state).toBe('api-disabled');
  });

  it('galat sementara (503) pada Drive tidak merusak: memakai cadangan browser', async () => {
    const d = device({ server });
    await d.service.update(ME, (r) => touchBook(r, { id: id(1), title: 'A' }, NOW));
    server.failNext(503, 'Backend error', { times: 10 });
    const { registry, status } = await d.service.load(ME);
    expect(status.state).toBe('error');
    expect(registry.current).toBe(id(1));
  });

  it('401 dari Drive dilempar ulang (sesi harus dibatalkan), bukan ditelan', async () => {
    const d = device({ server });
    server.failNext(401, 'Invalid Credentials');
    await expect(d.service.load(ME)).rejects.toBeInstanceOf(AuthError);
  });

  it('berkas rusak/kosong di Drive diperlakukan sebagai belum ada, bukan membuat aplikasi gagal', async () => {
    const a = device({ server });
    await a.service.update(ME, (r) => touchBook(r, { id: id(1), title: 'A' }, NOW));
    // rusakkan isi berkas langsung lewat API
    const store = createDriveStore({ getToken: async () => fakeToken(ME), fetchImpl: createFakeFetch(server) });
    await store.write({ books: 'sampah', current: 5 });
    const b = device({ server });
    const { registry, status } = await b.service.load(ME);
    expect(status.state).toBe('ok');
    expect(registry).toEqual(emptyRegistry());
  });

  it('berkas yang dihapus pengguna di sela-sela dibuat ulang saat menulis', async () => {
    const a = device({ server });
    await a.service.update(ME, (r) => touchBook(r, { id: id(1), title: 'A' }, NOW));
    server.reset(); // meniru folder appData dihapus pengguna
    const result = await a.service.update(ME, (r) => touchBook(r, { id: id(2), title: 'B' }, NOW));
    expect(result.status.state).toBe('ok');
    expect(server.dumpDrive(ME)[0].content.current).toBe(id(2));
  });
});

describe('driveStore', () => {
  it('memakai ulang ID berkas (tidak mencari lagi) dan hanya membuat satu berkas', async () => {
    const server = createFakeSheetsServer();
    const store = createDriveStore({ getToken: async () => fakeToken(ME), fetchImpl: createFakeFetch(server) });
    await store.write({ a: 1 });
    await store.write({ a: 2 });
    expect(await store.read()).toEqual({ a: 2 });
    expect(server.dumpDrive(ME)).toHaveLength(1);
    expect(server.calls.filter((c) => c.method === 'GET' && c.path === '/drive/v3/files')).toHaveLength(1); // satu kali mencari
  });
});
