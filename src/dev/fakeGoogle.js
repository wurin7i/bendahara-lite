// Google palsu (Sheets API + Google Identity Services) untuk pengujian dan mode demo.
// Tidak bergantung pada API Node, sehingga bisa dipakai di browser maupun Vitest.
//
// Perilaku yang ditiru dari Sheets API asli (sejauh dipakai aplikasi):
//  - A1 notation dengan nama sheet bertanda kutip, rentang terbuka (A2:A, A:H)
//  - baris kosong di ujung dibuang dari hasil values.get; sel kosong di tengah menjadi ""
//  - append menambah setelah baris terakhir yang berisi
//  - valueInputOption=RAW menyimpan tipe JSON apa adanya
//  - 403 untuk akun tanpa izin / tanpa hak tulis, 404 untuk spreadsheet yang tidak ada
//  - Drive appDataFolder per akun (berkas penunjuk buku), 403 bila izin Drive tidak diberikan atau Drive API mati

const TOKEN_PREFIX = 'fake-token:';

/** Token palsu memuat email dan apakah izin Drive diberikan: "fake-token:email" atau "fake-token:email|sheets". */
export const fakeToken = (email, { drive = true } = {}) => `${TOKEN_PREFIX}${email}${drive ? '' : '|sheets'}`;

function parseToken(token) {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const [email, flag] = token.slice(TOKEN_PREFIX.length).split('|');
  return { email, drive: flag !== 'sheets' };
}

function httpError(status, message, errStatus = '') {
  const e = new Error(message);
  e.status = status;
  e.errStatus = errStatus;
  return e;
}

function colToIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** "'Akun Kas'!A2:H5" -> { sheet, r1, r2, c1, c2 } (indeks 0-based; r2/c2 = Infinity bila terbuka) */
export function parseRange(range) {
  const m = /^(?:'((?:[^']|'')+)'|([^!']+))(?:!(.+))?$/.exec(range);
  if (!m) throw httpError(400, `Unable to parse range: ${range}`, 'INVALID_ARGUMENT');
  const sheet = (m[1] ?? m[2]).replace(/''/g, "'");
  const ref = m[3];
  if (!ref) return { sheet, r1: 0, r2: Infinity, c1: 0, c2: Infinity };
  const cell = (s) => {
    const c = /^([A-Z]*)(\d*)$/.exec(s);
    if (!c) throw httpError(400, `Unable to parse range: ${range}`, 'INVALID_ARGUMENT');
    return { col: c[1] ? colToIndex(c[1]) : null, row: c[2] ? Number(c[2]) - 1 : null };
  };
  const [a, b = a] = ref.split(':').map(cell);
  return {
    sheet,
    r1: a.row ?? 0,
    r2: b.row ?? Infinity,
    c1: a.col ?? 0,
    c2: b.col ?? Infinity,
  };
}

const isEmptyCell = (v) => v === undefined || v === null || v === '';

function trimRows(rows) {
  const out = rows.map((row) => {
    const copy = [...row];
    while (copy.length && isEmptyCell(copy[copy.length - 1])) copy.pop();
    return copy;
  });
  while (out.length && out[out.length - 1].length === 0) out.pop();
  return out;
}

const columnLetters = (index) => {
  let s = '';
  for (let x = index + 1; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

/**
 * @param {{persistKey?: string, latency?: number}} [options]
 */
export function createFakeSheetsServer({ persistKey = null, latency = 0 } = {}) {
  const freshDb = () => ({ counter: 0, sheetCounter: 100, driveCounter: 0, spreadsheets: {}, drive: {} });
  let db = freshDb();
  if (persistKey && typeof localStorage !== 'undefined') {
    try {
      db = { ...freshDb(), ...(JSON.parse(localStorage.getItem(persistKey)) ?? {}) };
    } catch {
      // abaikan data rusak
    }
  }
  let driveApiEnabled = true;
  const save = () => {
    if (persistKey && typeof localStorage !== 'undefined') localStorage.setItem(persistKey, JSON.stringify(db));
  };

  const calls = [];
  let failures = [];

  function userOf(headers) {
    const auth = headers.get('authorization') ?? '';
    const parsed = parseToken(auth.replace(/^Bearer /, ''));
    if (!parsed) throw httpError(401, 'Request had invalid authentication credentials.', 'UNAUTHENTICATED');
    return parsed;
  }

  /** Drive appDataFolder: berkas per akun. */
  function driveRoute(method, url, body, rawBody, user) {
    if (!driveApiEnabled) {
      throw httpError(403, 'Google Drive API has not been used in project 123456 before or it is disabled. Enable it by visiting the Google Cloud console.', 'PERMISSION_DENIED');
    }
    if (!user.drive) throw httpError(403, 'Request had insufficient authentication scopes.', 'PERMISSION_DENIED');
    const files = (db.drive[user.email] ??= []);
    const path = url.pathname;

    if (method === 'GET' && path === '/drive/v3/files') {
      const spaces = (url.searchParams.get('spaces') ?? 'drive').split(',');
      const name = /name\s*=\s*'([^']+)'/.exec(url.searchParams.get('q') ?? '')?.[1];
      const found = spaces.includes('appDataFolder') ? files.filter((f) => !name || f.name === name) : [];
      return { files: found.map(({ id, name: n }) => ({ id, name: n })) };
    }
    if (method === 'POST' && path === '/drive/v3/files') {
      if (!(body?.parents ?? []).includes('appDataFolder')) {
        throw httpError(400, 'Only appDataFolder is supported by this fake', 'INVALID_ARGUMENT');
      }
      db.driveCounter += 1;
      const file = { id: `fakeDriveFile${String(db.driveCounter).padStart(3, '0')}${'z'.repeat(20)}`, name: body.name, content: '' };
      files.push(file);
      return { id: file.id };
    }
    const m = /^\/(?:upload\/)?drive\/v3\/files\/([^/]+)$/.exec(path);
    if (m) {
      const file = files.find((f) => f.id === decodeURIComponent(m[1]));
      if (!file) throw httpError(404, 'File not found: ' + m[1], 'NOT_FOUND');
      if (method === 'GET' && url.searchParams.get('alt') === 'media') return { __text: file.content };
      if (method === 'PATCH' && path.startsWith('/upload/') && url.searchParams.get('uploadType') === 'media') {
        file.content = rawBody ?? '';
        return { id: file.id };
      }
    }
    throw httpError(404, `Unsupported fake Drive endpoint: ${method} ${path}`, 'NOT_FOUND');
  }

  function sheetOf(ss, name) {
    const sheet = ss.sheets.find((s) => s.title === name);
    if (!sheet) throw httpError(400, `Unable to parse range: ${name}`, 'INVALID_ARGUMENT');
    return sheet;
  }

  function access(id, email, write) {
    const ss = db.spreadsheets[id];
    if (!ss) throw httpError(404, `Requested entity was not found.`, 'NOT_FOUND');
    const role = ss.acl[email];
    if (!role || (write && role === 'reader')) {
      throw httpError(403, 'The caller does not have permission', 'PERMISSION_DENIED');
    }
    return ss;
  }

  const sheetsMeta = (ss) =>
    ss.sheets.map((s, index) => ({ properties: { sheetId: s.sheetId, title: s.title, index, gridProperties: { frozenRowCount: 1 } } }));

  function addSheet(ss, title) {
    if (ss.sheets.some((s) => s.title === title)) {
      throw httpError(400, `A sheet with the name "${title}" already exists. Please enter another name.`, 'INVALID_ARGUMENT');
    }
    db.sheetCounter += 1;
    const sheet = { sheetId: db.sheetCounter, title, rows: [] };
    ss.sheets.push(sheet);
    return sheet;
  }

  function readRange(ss, range) {
    const r = parseRange(range);
    const sheet = sheetOf(ss, r.sheet);
    const rows = sheet.rows.slice(r.r1, r.r2 === Infinity ? undefined : r.r2 + 1).map((row) => row.slice(r.c1, r.c2 === Infinity ? undefined : r.c2 + 1));
    const trimmed = trimRows(rows);
    const result = { range: `${range}`, majorDimension: 'ROWS' };
    if (trimmed.length) result.values = trimmed;
    return result;
  }

  function writeRows(sheet, startRow, startCol, values) {
    values.forEach((row, i) => {
      const target = (sheet.rows[startRow + i] ??= []);
      row.forEach((value, j) => {
        target[startCol + j] = value;
      });
    });
  }

  function writeRange(ss, range, values) {
    const r = parseRange(range);
    const sheet = sheetOf(ss, r.sheet);
    writeRows(sheet, r.r1, r.c1, values);
    const width = Math.max(...values.map((v) => v.length), 1);
    return {
      updatedRange: `'${r.sheet}'!${columnLetters(r.c1)}${r.r1 + 1}:${columnLetters(r.c1 + width - 1)}${r.r1 + values.length}`,
      updatedRows: values.length,
      updatedCells: values.reduce((n, v) => n + v.length, 0),
    };
  }

  function route(method, url, body, email) {
    const path = url.pathname.replace(/^\/v4\/spreadsheets/, '');

    if (method === 'POST' && path === '') {
      // Google asli menolak locale yang tidak didukung (galat ini dilaporkan pengguna untuk "id_ID").
      const locale = body?.properties?.locale;
      if (locale === 'id_ID') {
        throw httpError(400, `Invalid properties: Unsupported locale: ${locale}`, 'INVALID_ARGUMENT');
      }
      db.counter += 1;
      const id = `fakeSheet${String(db.counter).padStart(3, '0')}${'x'.repeat(24)}`;
      const ss = { title: body?.properties?.title ?? 'Untitled spreadsheet', sheets: [], acl: { [email]: 'owner' } };
      db.spreadsheets[id] = ss;
      const wanted = body?.sheets?.length ? body.sheets.map((s) => s.properties.title) : ['Sheet1'];
      wanted.forEach((title) => addSheet(ss, title));
      return {
        spreadsheetId: id,
        properties: { title: ss.title },
        sheets: sheetsMeta(ss),
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`,
      };
    }

    const m = /^\/([^/:]+)(.*)$/.exec(path);
    if (!m) throw httpError(404, 'Not found', 'NOT_FOUND');
    const id = decodeURIComponent(m[1]);
    const rest = m[2];

    if (method === 'GET' && rest === '') {
      const ss = access(id, email, false);
      return {
        spreadsheetId: id,
        properties: { title: ss.title },
        sheets: sheetsMeta(ss),
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`,
      };
    }

    if (method === 'POST' && rest === ':batchUpdate') {
      const ss = access(id, email, true);
      const replies = (body.requests ?? []).map((req) => {
        if (req.addSheet) {
          const sheet = addSheet(ss, req.addSheet.properties.title);
          return { addSheet: { properties: { sheetId: sheet.sheetId, title: sheet.title } } };
        }
        return {}; // format, freeze, resize: tidak berpengaruh pada data
      });
      return { spreadsheetId: id, replies };
    }

    if (method === 'GET' && rest === '/values:batchGet') {
      const ss = access(id, email, false);
      return { spreadsheetId: id, valueRanges: url.searchParams.getAll('ranges').map((r) => readRange(ss, r)) };
    }

    if (method === 'POST' && rest === '/values:batchUpdate') {
      const ss = access(id, email, true);
      const responses = body.data.map((d) => writeRange(ss, d.range, d.values));
      return { spreadsheetId: id, totalUpdatedRows: responses.reduce((n, r) => n + r.updatedRows, 0), responses };
    }

    const v = /^\/values\/(.+?)(:append)?$/.exec(rest);
    if (v) {
      const range = decodeURIComponent(v[1]);
      const isAppend = Boolean(v[2]);
      if (method === 'GET' && !isAppend) {
        return readRange(access(id, email, false), range);
      }
      if (method === 'PUT' && !isAppend) {
        const ss = access(id, email, true);
        return { spreadsheetId: id, ...writeRange(ss, range, body.values) };
      }
      if (method === 'POST' && isAppend) {
        const ss = access(id, email, true);
        const r = parseRange(range);
        const sheet = sheetOf(ss, r.sheet);
        let last = -1;
        sheet.rows.forEach((row, i) => {
          if (row.slice(r.c1, r.c2 === Infinity ? undefined : r.c2 + 1).some((c) => !isEmptyCell(c))) last = i;
        });
        const start = last + 1;
        writeRows(sheet, start, r.c1, body.values);
        const width = Math.max(...body.values.map((x) => x.length), 1);
        return {
          spreadsheetId: id,
          updates: {
            updatedRange: `'${r.sheet}'!${columnLetters(r.c1)}${start + 1}:${columnLetters(r.c1 + width - 1)}${start + body.values.length}`,
            updatedRows: body.values.length,
          },
        };
      }
    }
    throw httpError(404, `Unsupported fake endpoint: ${method} ${url.pathname}`, 'NOT_FOUND');
  }

  /** Tangani satu permintaan HTTP ke host sheets.googleapis.com. */
  async function handle(rawUrl, init = {}) {
    const url = new URL(rawUrl);
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers ?? {});
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url.pathname, query: url.search, body });
    if (latency) await new Promise((r) => setTimeout(r, latency));

    try {
      const failure = failures.shift();
      if (failure) throw Object.assign(httpError(failure.status, failure.message ?? 'Injected failure', failure.errStatus), { headers: failure.headers });
      const user = userOf(headers);
      const isDrive = url.hostname === 'www.googleapis.com';
      const result = isDrive ? driveRoute(method, url, body, init.body, user) : route(method, url, body, user.email);
      if (method !== 'GET') save();
      if (result && typeof result.__text === 'string') {
        return new Response(result.__text, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return json(200, result);
    } catch (e) {
      if (e.status) {
        return json(e.status, { error: { code: e.status, message: e.message, status: e.errStatus } }, e.headers);
      }
      throw e;
    }
  }

  return {
    handle,
    calls,
    /** Sisipkan kegagalan untuk N permintaan berikutnya. */
    failNext(status, message, { times = 1, headers } = {}) {
      for (let i = 0; i < times; i += 1) failures.push({ status, message, headers });
    },
    /** Beri akses ke spreadsheet. role: 'writer' | 'reader' */
    share(id, email, role = 'writer') {
      db.spreadsheets[id].acl[email] = role;
      save();
    },
    /** Akses langsung ke isi sheet (untuk asersi pada tes). */
    dump(id, sheetTitle) {
      return trimRows(db.spreadsheets[id].sheets.find((s) => s.title === sheetTitle).rows);
    },
    /** Berkas appDataFolder milik satu akun, isinya sudah di-parse (untuk asersi pada tes). */
    dumpDrive: (email) => (db.drive[email] ?? []).map((f) => ({ name: f.name, content: f.content ? JSON.parse(f.content) : null })),
    /** Matikan/hidupkan Drive API seperti proyek Cloud yang belum mengaktifkannya. */
    setDriveApiEnabled(enabled) {
      driveApiEnabled = enabled;
    },
    sheetTitles: (id) => db.spreadsheets[id].sheets.map((s) => s.title),
    spreadsheetIds: () => Object.keys(db.spreadsheets),
    reset() {
      db = freshDb();
      driveApiEnabled = true;
      failures = [];
      calls.length = 0;
      save();
    },
  };
}

function json(status, body, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(extraHeaders ?? {}) },
  });
}

/** fetch palsu: meneruskan host Google ke server palsu, selain itu ke fetch asli (bila ada). */
export function createFakeFetch(server, { baseFetch } = {}) {
  return async function fakeFetch(input, init) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.hostname === 'sheets.googleapis.com') return server.handle(url.toString(), init);
    if (url.hostname === 'www.googleapis.com' && /^\/(upload\/)?drive\/v3\//.test(url.pathname)) {
      return server.handle(url.toString(), init);
    }
    if (url.hostname === 'www.googleapis.com' && url.pathname === '/oauth2/v3/userinfo') {
      const auth = new Headers(init?.headers ?? {}).get('authorization') ?? '';
      const parsed = parseToken(auth.replace(/^Bearer /, ''));
      if (!parsed) return json(401, { error: 'invalid_token' });
      const { email } = parsed;
      const name = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      return json(200, { sub: email, email, email_verified: true, name, picture: '' });
    }
    if (baseFetch) return baseFetch(input, init);
    throw new Error(`Fake fetch: host tidak dikenal ${url.hostname}`);
  };
}

/**
 * Pasang Google palsu di window (mode demo / e2e):
 *  - window.google.accounts.oauth2 (Google Identity Services)
 *  - window.fetch untuk host googleapis
 */
export function installFakeGoogle({ email = 'bendahara.demo@example.com', persistKey = 'bendahara-demo.fakeGoogle', latency = 120 } = {}) {
  const server = createFakeSheetsServer({ persistKey, latency });
  const realFetch = window.fetch.bind(window);
  window.fetch = createFakeFetch(server, { baseFetch: realFetch });

  window.google = {
    accounts: {
      oauth2: {
        initTokenClient(config) {
          return {
            requestAccessToken() {
              window.__fakeGoogleTokenRequests = (window.__fakeGoogleTokenRequests ?? 0) + 1;
              if (window.__fakeGoogleBlockPopup) {
                setTimeout(() => config.error_callback?.({ type: 'popup_failed_to_open' }), latency);
                return;
              }
              // window.__fakeGoogleDenyDrive meniru pengguna yang tidak mencentang izin Drive (izin granular).
              const drive = !window.__fakeGoogleDenyDrive;
              const scope = drive ? config.scope : config.scope.split(' ').filter((s) => !s.includes('/drive')).join(' ');
              setTimeout(
                () => config.callback({ access_token: fakeToken(email, { drive }), expires_in: 3600, scope, token_type: 'Bearer' }),
                latency,
              );
            },
          };
        },
        revoke(_token, done) {
          done?.({ successful: true });
        },
      },
    },
  };
  window.__fakeGoogle = server;
  return server;
}
