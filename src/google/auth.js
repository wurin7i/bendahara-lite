// Login Google memakai Google Identity Services (token model, tanpa backend).
//
// Alur: tombol "Masuk dengan Google" -> popup persetujuan -> access token (berlaku ~1 jam) ->
// token dipakai langsung memanggil Sheets API. Hak akses ke spreadsheet = hak akun Google yang login,
// jadi siapa pun yang tidak diberi akses di Google Sheets otomatis tidak bisa membaca data.
//
// Token disimpan di sessionStorage (hilang saat tab ditutup), bukan localStorage.

import { config } from '../config.js';
import { AuthError } from './errors.js';

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
// Opsional: folder tersembunyi di Drive untuk mengingat daftar buku lintas perangkat (scope non-sensitif).
// Bila pengguna tidak mencentangnya, aplikasi tetap berjalan dan hanya mengingat daftar di browser.
export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const SCOPES = ['openid', 'email', 'profile', SHEETS_SCOPE, DRIVE_APPDATA_SCOPE];

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SESSION_KEY = `${config.storagePrefix}.session`;
const EXPIRY_MARGIN_MS = 60_000;
const SILENT_TIMEOUT_MS = 15_000;

let session = null; // { accessToken, expiresAt, user: {email, name, picture}, driveAppData: boolean }
let tokenClient = null;
let pending = null; // { resolve, reject } untuk permintaan token yang sedang berjalan
let inflight = null; // promise permintaan token agar tidak ada dua popup sekaligus
const listeners = new Set();

const safeStorage = {
  get: (k) => {
    try { return window.sessionStorage.getItem(k); } catch { return null; }
  },
  set: (k, v) => {
    try { window.sessionStorage.setItem(k, v); } catch { /* penyimpanan tidak tersedia */ }
  },
  remove: (k) => {
    try { window.sessionStorage.removeItem(k); } catch { /* penyimpanan tidak tersedia */ }
  },
};

function emit() {
  listeners.forEach((fn) => fn(session));
}

export const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const getSession = () => session;

const isFresh = (s) => Boolean(s && s.expiresAt - EXPIRY_MARGIN_MS > Date.now());

function setSession(next) {
  session = next;
  if (next) safeStorage.set(SESSION_KEY, JSON.stringify(next));
  else safeStorage.remove(SESSION_KEY);
  emit();
}

/** Pulihkan sesi dari sessionStorage (mis. setelah halaman dimuat ulang). */
export function restoreSession() {
  try {
    const stored = JSON.parse(safeStorage.get(SESSION_KEY) ?? 'null');
    session = isFresh(stored) ? stored : null;
  } catch {
    session = null;
  }
  if (!session) safeStorage.remove(SESSION_KEY);
  return session;
}

export function loadGoogleScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Gagal memuat Google Sign-In. Periksa koneksi internet atau pemblokir iklan Anda.'));
    document.head.append(script);
  });
}

async function ensureTokenClient(clientId) {
  if (tokenClient) return tokenClient;
  await loadGoogleScript();
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES.join(' '),
    callback: (response) => {
      const p = pending;
      pending = null;
      if (!p) return;
      if (response.error) p.reject(new AuthError(response.error_description || response.error));
      else p.resolve(response);
    },
    error_callback: (err) => {
      const p = pending;
      pending = null;
      if (!p) return;
      const reason = err?.type === 'popup_closed' ? 'Jendela login ditutup sebelum selesai.' : 'Popup login Google diblokir atau gagal dibuka.';
      p.reject(new AuthError(reason));
    },
  });
  return tokenClient;
}

/**
 * Muat skrip Google & siapkan token client lebih awal. Dengan begitu saat tombol "Masuk" diklik,
 * popup langsung dibuka di dalam gestur klik (kalau skrip baru diunduh saat itu, browser bisa memblokir popup).
 */
export function preload(clientId) {
  return ensureTokenClient(clientId).catch(() => {});
}

async function fetchUser(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new AuthError('Gagal membaca profil akun Google.');
  const info = await res.json();
  return { email: info.email, name: info.name || info.email, picture: info.picture || '' };
}

function requestToken(clientId, { prompt, hint, timeoutMs } = {}) {
  if (inflight) return inflight;
  inflight = (async () => {
    const client = await ensureTokenClient(clientId);
    const response = await new Promise((resolve, reject) => {
      let timer;
      const done = (fn) => (value) => {
        clearTimeout(timer);
        fn(value);
      };
      pending = { resolve: done(resolve), reject: done(reject) };
      if (timeoutMs) {
        timer = setTimeout(() => {
          pending = null;
          reject(new AuthError('Login otomatis tidak berhasil.'));
        }, timeoutMs);
      }
      client.requestAccessToken({ prompt, ...(hint ? { login_hint: hint } : {}) });
    });

    const granted = String(response.scope ?? '').split(' ');
    if (!granted.includes(SHEETS_SCOPE)) {
      throw new AuthError('Izin akses Google Sheets tidak diberikan. Centang izin Spreadsheet saat masuk.');
    }
    const accessToken = response.access_token;
    const user = session?.user && session.user.email ? session.user : await fetchUser(accessToken);
    setSession({
      accessToken,
      expiresAt: Date.now() + Number(response.expires_in ?? 3600) * 1000,
      user,
      driveAppData: granted.includes(DRIVE_APPDATA_SCOPE),
    });
    return session;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Login interaktif (harus dipanggil dari klik pengguna agar popup tidak diblokir). */
export function signIn(clientId) {
  return requestToken(clientId, { prompt: session ? '' : 'select_account' });
}

let rememberedClientId = '';
export function configureAuth(clientId) {
  rememberedClientId = clientId;
}

/** Token yang masih berlaku; memperbarui diam-diam bila hampir habis. */
export async function getAccessToken() {
  if (isFresh(session)) return session.accessToken;
  if (!session) throw new AuthError('Belum masuk');
  try {
    const renewed = await requestToken(rememberedClientId, {
      prompt: '',
      hint: session.user?.email,
      timeoutMs: SILENT_TIMEOUT_MS,
    });
    return renewed.accessToken;
  } catch (err) {
    setSession(null);
    throw err instanceof AuthError ? err : new AuthError('Sesi berakhir');
  }
}

/** Buang sesi lokal tanpa mencabut izin di Google (dipakai saat Google menolak token dengan 401). */
export function invalidateSession() {
  setSession(null);
}

export function signOut() {
  const token = session?.accessToken;
  setSession(null);
  if (token && window.google?.accounts?.oauth2?.revoke) {
    window.google.accounts.oauth2.revoke(token, () => {});
  }
}
