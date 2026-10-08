// Penyimpanan kecil di Google Drive pengguna: folder tersembunyi "appDataFolder" (scope drive.appdata).
// Hanya aplikasi dengan Client ID ini yang bisa melihatnya; pengguna lain dan aplikasi Drive lain tidak.
// Dipakai menyimpan daftar buku (ID spreadsheet) supaya terbawa ke semua perangkat dengan akun Google yang sama.
//
// Menurut dokumentasi Google, folder dibuat otomatis saat berkas pertama ditulis, dan bisa dihapus pengguna
// (mis. dengan memutus aplikasi dari Drive). Karena itu isinya tidak boleh jadi satu-satunya salinan data penting.

import { createHttp } from './http.js';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

export const REGISTRY_FILE = 'bendahara-lite.json';

/** @param {Parameters<typeof createHttp>[0]} deps */
export function createDriveStore(deps) {
  const http = createHttp(deps);
  let fileId = null; // di-cache agar pembacaan berikutnya tidak perlu mencari lagi

  async function find() {
    if (fileId) return fileId;
    const res = await http.request('GET', FILES, {
      query: {
        spaces: 'appDataFolder',
        q: `name = '${REGISTRY_FILE}' and trashed = false`,
        orderBy: 'createdTime', // bila dua perangkat sempat membuat berkas bersamaan, yang tertua dipakai
        fields: 'files(id,name)',
        pageSize: '10',
      },
    });
    fileId = res?.files?.[0]?.id ?? null;
    return fileId;
  }

  async function create() {
    const created = await http.request('POST', FILES, {
      query: { fields: 'id' },
      body: { name: REGISTRY_FILE, parents: ['appDataFolder'], mimeType: 'application/json' },
    });
    fileId = created.id;
    return fileId;
  }

  const upload = (id, value) =>
    http.request('PATCH', `${UPLOAD}/${encodeURIComponent(id)}`, { query: { uploadType: 'media', fields: 'id' }, body: value });

  return {
    /** @returns {Promise<unknown|null>} isi berkas (belum divalidasi), atau null bila belum ada/rusak */
    async read() {
      const id = await find();
      if (!id) return null;
      let text;
      try {
        text = await http.request('GET', `${FILES}/${encodeURIComponent(id)}`, { query: { alt: 'media' }, as: 'text' });
      } catch (err) {
        if (err.status === 404) {
          fileId = null; // dihapus pengguna di sela-sela
          return null;
        }
        throw err;
      }
      try {
        return JSON.parse(text);
      } catch {
        return null; // berkas kosong (create berhasil, upload belum) atau rusak
      }
    },

    async write(value) {
      let id = (await find()) ?? (await create());
      try {
        await upload(id, value);
      } catch (err) {
        if (err.status !== 404) throw err;
        // berkas hilang sejak dicari: buat ulang sekali
        fileId = null;
        id = await create();
        await upload(id, value);
      }
    },
  };
}
