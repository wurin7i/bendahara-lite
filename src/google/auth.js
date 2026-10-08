// Login Google memakai Google Identity Services (token model, tanpa backend).
//
// Alur: tombol "Masuk dengan Google" -> popup persetujuan -> access token (berlaku ~1 jam) -> token dipakai
// langsung memanggil Sheets API. Hak akses ke spreadsheet = hak akun Google yang login, jadi siapa pun yang tidak
// diberi akses di Google Sheets otomatis tidak bisa membaca data.
//
// Umur sesi:
//  - Token Google hanya berlaku ~1 jam dan jenis login ini tidak punya refresh token. Ini batas dari Google.
//  - Sesi disimpan di localStorage (bukan sessionStorage) supaya tidak hilang saat tab ditutup/dibuang browser
//    (sering terjadi di ponsel) atau tautan dibuka di tab baru; antar tab disinkronkan lewat event "storage".
//  - Saat token habis, sesi TIDAK dibuang. Identitas dipertahankan dan pengguna cukup mengetuk "Lanjutkan"
//    (popup Google yang menutup sendiri). Permintaan yang sedang menunggu otomatis dilanjutkan, tanpa mengulang aksi.

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
// Identitas (bukan token) yang sudah kedaluwarsa dipertahankan selama ini agar pengguna cukup mengetuk "Lanjutkan".
const MAX_IDLE_MS = 30 * 24 * 60 * 60 * 1000;

/** @type {{accessToken: string, expiresAt: number, user: {email, name, picture}, driveAppData: boolean} | null} */
let session = null;
let reauth = false; // true = token habis dan menunggu pengguna mengetuk "Lanjutkan"
let tokenClient = null;
let pending = null; // { resolve, reject } untuk permintaan token yang sedang berjalan
let inflight = null; // promise permintaan token agar tidak ada dua popup sekaligus
let waiter = null; // permintaan API yang menunggu token baru: { promise, resolve, reject }
let rememberedClientId = '';
const listeners = new Set();
const reauthListeners = new Set();

const storage = {
  get: (k) => {
    try { return window.localStorage.getItem(k); } catch { return null; }
  },
  set: (k, v) => {
    try { window.localStorage.setItem(k, v); } catch { /* penyimpanan tidak tersedia */ }
  },
  remove: (k) => {
    try { window.localStorage.removeItem(k); } catch { /* penyimpanan tidak tersedia */ }
  },
};

const parse = (text) => {
  try { return JSON.parse(text ?? 'null'); } catch { return null; }
};

const isFresh = (s) => Boolean(s && s.expiresAt - EXPIRY_MARGIN_MS > Date.now());

const isUsable = (s) =>
  Boolean(s && typeof s.accessToken === 'string' && s.user?.email && Number.isFinite(s.expiresAt) && Date.now() - s.expiresAt < MAX_IDLE_MS);

export const configureAuth = (clientId) => { rememberedClientId = clientId; };

/* ---------- pengamat ---------- */
export const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const getSession = () => session;

export const subscribeReauth = (fn) => {
  reauthListeners.add(fn);
  return () => reauthListeners.delete(fn);
};
export const getReauth = () => reauth;

function setReauth(value) {
  if (reauth === value) return;
  reauth = value;
  reauthListeners.forEach((fn) => fn(value));
}

function setSession(next) {
  session = next;
  if (next) storage.set(SESSION_KEY, JSON.stringify(next));
  else storage.remove(SESSION_KEY);
  listeners.forEach((fn) => fn(session));
}

/* ---------- permintaan yang menunggu token baru ---------- */
function waitForReauth() {
  setReauth(true);
  if (!waiter) {
    waiter = {};
    waiter.promise = new Promise((resolve, reject) => {
      waiter.resolve = resolve;
      waiter.reject = reject;
    });
    waiter.promise.catch(() => {}); // pemanggil menangani sendiri; cegah unhandled rejection bila tak ada yang menunggu
  }
  return waiter.promise;
}
function settleWaiter(token) {
  if (waiter) waiter.resolve(token);
  waiter = null;
}
function failWaiter(err) {
  if (waiter) waiter.reject(err);
  waiter = null;
}

/** Pulihkan sesi dari localStorage (setelah dimuat ulang, tab baru, atau browser dibuka lagi). */
export function restoreSession() {
  try { window.sessionStorage.removeItem(SESSION_KEY); } catch { /* sisa versi lama: tak terpakai lagi */ }
  const stored = parse(storage.get(SESSION_KEY));
  session = isUsable(stored) ? stored : null;
  if (!session) storage.remove(SESSION_KEY);
  return session;
}

// Sinkron antar tab: keluar / pembaruan token di satu tab berlaku di tab lain. Event ini hanya terkirim ke tab LAIN.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== SESSION_KEY) return;
    const next = parse(e.newValue);
    if (!isUsable(next)) {
      failWaiter(new AuthError('Keluar'));
      setReauth(false);
      session = null;
      listeners.forEach((fn) => fn(session));
      return;
    }
    session = next;
    listeners.forEach((fn) => fn(session));
    if (isFresh(next)) {
      settleWaiter(next.accessToken);
      setReauth(false);
    }
  });
}

/* ---------- Google Identity Services ---------- */
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
    // Selalu baca ulang profil: pada layar pilih akun, pengguna bisa saja memilih akun Google yang berbeda.
    const user = await fetchUser(accessToken);
    setSession({
      accessToken,
      expiresAt: Date.now() + Number(response.expires_in ?? 3600) * 1000,
      user,
      driveAppData: granted.includes(DRIVE_APPDATA_SCOPE),
    });
    setReauth(false);
    settleWaiter(accessToken);
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

/** Lanjutkan sesi yang tokennya habis. Dipanggil dari ketukan pengguna pada dialog "Lanjutkan". */
export function renew(clientId = rememberedClientId) {
  return requestToken(clientId, { prompt: '', hint: session?.user?.email });
}

// Popup tanpa gestur pengguna biasanya diblokir (terutama di ponsel) atau tampil berkedip. Karena itu pembaruan senyap
// hanya dicoba bila baru saja ada ketukan/tombol NYATA pada dokumen ini (mis. klik "Simpan"). Sengaja tidak memakai
// navigator.userActivation: di Chromium statusnya bisa terbawa melewati muat ulang halaman, sehingga saat boot
// (tanpa ketukan sama sekali) aplikasi kadang mencoba popup dan kadang tidak.
const GESTURE_WINDOW_MS = 4000;
let lastGestureAt = -Infinity;
if (typeof window !== 'undefined') {
  for (const type of ['pointerdown', 'touchend', 'keydown', 'click']) {
    window.addEventListener(
      type,
      (e) => {
        if (e.isTrusted) lastGestureAt = performance.now();
      },
      { capture: true, passive: true },
    );
  }
}
const canTrySilent = () => performance.now() - lastGestureAt < GESTURE_WINDOW_MS;

/**
 * Token yang masih berlaku. Bila habis: coba perbarui diam-diam (hanya jika popup mungkin diizinkan), kalau
 * tidak berhasil minta pengguna mengetuk "Lanjutkan" dan TUNGGU, sehingga permintaan yang sedang berjalan tidak gagal.
 */
export async function getAccessToken() {
  if (!session) throw new AuthError('Belum masuk');
  if (isFresh(session)) return session.accessToken;
  if (canTrySilent()) {
    try {
      const renewed = await requestToken(rememberedClientId, { prompt: '', hint: session?.user?.email, timeoutMs: SILENT_TIMEOUT_MS });
      return renewed.accessToken;
    } catch {
      // jatuh ke permintaan manual di bawah
    }
  }
  if (!session) throw new AuthError('Belum masuk'); // keluar selagi menunggu
  return waitForReauth();
}

/** Google menolak token (401): tandai tidak berlaku. Mengembalikan true agar permintaan diulang setelah token baru. */
export function handleRejectedToken() {
  if (!session) return false;
  setSession({ ...session, expiresAt: 0 });
  return true;
}

/** Dipanggil saat tab kembali aktif: bila token sudah habis, tampilkan ajakan melanjutkan sebelum pengguna menyimpan sesuatu. */
export function checkExpiry() {
  if (session && !isFresh(session) && !inflight) setReauth(true);
}

export function signOut() {
  const token = session?.accessToken;
  failWaiter(new AuthError('Keluar'));
  setReauth(false);
  setSession(null);
  if (token && window.google?.accounts?.oauth2?.revoke) {
    window.google.accounts.oauth2.revoke(token, () => {});
  }
}
