import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { config } from '../config.js';
import * as auth from '../google/auth.js';
import { AuthError, ConflictError, friendlyMessage } from '../google/errors.js';
import { createDriveStore } from '../google/driveStore.js';
import { createRepository, createSpreadsheet, parseSpreadsheetId } from '../google/repository.js';
import { createSheetsApi } from '../google/sheetsApi.js';
import { useToast } from '../components/ui.jsx';
import { UNALLOCATED_ID, mergeSplits, splitPayment, validateAllocations } from '../lib/allocation.js';
import { pickDefaultPeriod } from '../lib/dues.js';
import { newId } from '../lib/ids.js';
import { accountStatement, buildLedgerLines } from '../lib/ledger.js';
import { currentMonthKey } from '../lib/months.js';
import { ACCOUNT_MODES, MODE_INFO_KEY, planAccountSave, resolveAccountMode } from '../lib/accountMode.js';
import { paymentAllocations } from '../lib/selectors.js';
import { KIND_FIXED, validateCollection } from '../lib/collections.js';
import { POCKET_PREFIX, splitLines, visiblePockets } from '../lib/pockets.js';
import { createRegistryService, needsUpdate, removeBook, touchBook } from './books.js';

auth.configureAuth(config.clientId);
const DEFAULT_SHEET = parseSpreadsheetId(config.defaultSpreadsheetId) ?? '';

// Galat saat masuk/melanjutkan sesi membawa alasan spesifik (popup diblokir/ditutup, izin tidak dicentang, dsb.);
// jangan diganti pesan umum "sesi berakhir" milik friendlyMessage.
const authMessage = (err) => (err instanceof AuthError && err.message ? err.message : friendlyMessage(err));

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

/* ---------- preferensi di localStorage (opsional; aplikasi tetap jalan bila tidak tersedia) ---------- */
const pref = {
  get(key) {
    try { return window.localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { window.localStorage.setItem(key, value); } catch { /* abaikan */ }
  },
};
const periodKey = (sheetId) => `${config.storagePrefix}.period.${sheetId}`;

// Tautan berbagi: https://aplikasi/?sheet=<ID> -> dibaca sekali lalu dibersihkan dari URL.
let pendingUrlSheet = (() => {
  try {
    const url = new URL(window.location.href);
    const id = parseSpreadsheetId(url.searchParams.get('sheet'));
    if (url.searchParams.has('sheet')) {
      url.searchParams.delete('sheet');
      window.history.replaceState(null, '', url.toString());
    }
    return id;
  } catch {
    return null;
  }
})();
// Dipakai sekali: setelah keluar lalu masuk lagi di halaman yang sama, tautan lama tidak boleh menimpa pilihan terakhir.
const takeUrlSheet = () => {
  const id = pendingUrlSheet;
  pendingUrlSheet = null;
  return id;
};

export function AppProvider({ children }) {
  const toast = useToast();
  const api = useMemo(
    // 401 = Google menolak token (dicabut/kedaluwarsa/tidak valid): minta pembaruan (dialog "Lanjutkan") lalu ulangi sekali.
    () => createSheetsApi({ getToken: auth.getAccessToken, onUnauthorized: auth.handleRejectedToken }),
    [],
  );

  const [session, setSession] = useState(() => auth.restoreSession());
  const [phase, setPhase] = useState(session ? 'loading' : 'signedOut');
  const [fatal, setFatal] = useState('');
  const [loginError, setLoginError] = useState('');
  const [initInfo, setInitInfo] = useState(null);
  const [sheetId, setSheetId] = useState('');
  const [repo, setRepo] = useState(null);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(0);
  const [periodId, setPeriodId] = useState(null);
  const [books, setBooks] = useState([]);
  const [driveStatus, setDriveStatus] = useState(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [reauthError, setReauthError] = useState('');
  const reauth = useSyncExternalStore(auth.subscribeReauth, auth.getReauth);

  const email = session?.user?.email ?? null;

  const repoRef = useRef(null);
  const dataRef = useRef(null);
  const seqRef = useRef(0);
  const sheetIdRef = useRef('');
  const sheetTitleRef = useRef('');
  const targetRef = useRef('');
  repoRef.current = repo;
  dataRef.current = data;
  sheetIdRef.current = sheetId;

  // Daftar buku: Drive (ikut akun) + cadangan browser. Dibuat ulang per akun karena Drive menyimpan ID berkas.
  const registry = useMemo(
    () =>
      createRegistryService({
        drive: createDriveStore({ getToken: auth.getAccessToken, onUnauthorized: auth.handleRejectedToken }),
        driveEnabled: () => Boolean(auth.getSession()?.driveAppData),
        storage: pref,
        prefix: config.storagePrefix,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [email],
  );

  useEffect(() => auth.subscribe(setSession), []);
  // Saat tab kembali aktif, periksa masa token supaya ajakan "Lanjutkan" muncul sebelum pengguna menyimpan sesuatu.
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === 'visible') auth.checkExpiry();
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);
  useEffect(() => {
    if (config.clientId || config.demo) auth.preload(config.clientId);
  }, []);

  const failFatal = useCallback((err) => {
    if (err instanceof AuthError) return; // sesi sudah dihapus -> layar masuk
    setFatal(friendlyMessage(err));
    setPhase('error');
  }, []);

  /** Catat buku sebagai aktif (tampil seketika; penyimpanan ke Drive/browser menyusul, gagal pun tidak mengganggu). */
  const remember = useCallback(
    async (user, id, title) => {
      setBooks((cur) => touchBook({ current: id, books: cur }, { id, title }).books);
      try {
        const { registry: reg, status } = await registry.update(user.email, (base) =>
          needsUpdate(base, { id, title }) ? touchBook(base, { id, title }) : base,
        );
        setBooks(reg.books);
        setDriveStatus(status);
      } catch {
        // AuthError: sesi sudah dibatalkan dan layar masuk tampil; galat Drive lain sudah ditangani layanan.
      }
    },
    [registry],
  );

  const connect = useCallback(
    async (id, user, { autoInit = false } = {}) => {
      const seq = ++seqRef.current;
      targetRef.current = id;
      setPhase('loading');
      setFatal('');
      const next = createRepository({ api, spreadsheetId: id, user });
      try {
        const state = await next.inspect();
        if (seq !== seqRef.current) return;
        if (!state.ready) {
          if (!autoInit && !state.mismatched.length) {
            setInitInfo({ id, state, user });
            setPhase('needInit');
            return;
          }
          await next.initialize(); // melempar SchemaError bila ada sheet bentrok
        }
        const loaded = await next.load();
        if (seq !== seqRef.current) return;
        sheetTitleRef.current = state.title || '';
        setSheetId(id);
        setRepo(next);
        setData(loaded);
        setInitInfo(null);
        setSetupOpen(false);
        setPhase('ready');
        remember(user, id, loaded.info.org_name || state.title || '');
      } catch (err) {
        if (seq !== seqRef.current || err instanceof AuthError) return; // AuthError: sesi batal -> layar masuk
        if (repoRef.current && dataRef.current) {
          // Gagal berpindah dari buku yang masih berfungsi: kembali ke daftar buku, jangan terdampar di layar galat.
          toast(friendlyMessage(err), 'error');
          setSetupOpen(true);
          setPhase('ready');
          return;
        }
        failFatal(err);
      }
    },
    [api, failFatal, remember, toast],
  );

  // Mulai/akhiri alur sesuai siapa yang sedang masuk.
  useEffect(() => {
    if (!email) {
      seqRef.current += 1;
      setRepo(null);
      setData(null);
      setSheetId('');
      setInitInfo(null);
      setBooks([]);
      setDriveStatus(null);
      setSetupOpen(false);
      setPhase('signedOut');
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setPhase('loading');
      let loaded;
      try {
        loaded = await registry.load(email);
      } catch (err) {
        if (!cancelled) failFatal(err);
        return;
      }
      if (cancelled) return;
      setBooks(loaded.registry.books);
      setDriveStatus(loaded.status);
      // Urutan: tautan berbagi (?sheet=) > buku terakhir (Drive/browser) > bawaan konfigurasi.
      const id = takeUrlSheet() || loaded.registry.current || DEFAULT_SHEET;
      if (!id) {
        setPhase('noSheet');
        return;
      }
      connect(id, auth.getSession().user);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  /* ---------- eksekusi tulis + muat ulang ---------- */
  const run = useCallback(
    async (write, success) => {
      setBusy((n) => n + 1);
      try {
        await write(repoRef.current, dataRef.current);
      } catch (err) {
        // Keluar selagi permintaan menunggu bukan galat yang perlu ditampilkan.
        if (!(err instanceof AuthError && !auth.getSession())) toast(friendlyMessage(err), 'error');
        if (err instanceof ConflictError) {
          try { setData(await repoRef.current.load()); } catch { /* biarkan */ }
        }
        setBusy((n) => n - 1);
        return false;
      }
      try {
        setData(await repoRef.current.load());
        if (success) toast(success);
      } catch (err) {
        toast(`Tersimpan, tetapi gagal memuat ulang data: ${friendlyMessage(err)}`, 'error');
      }
      setBusy((n) => n - 1);
      return true;
    },
    [toast],
  );

  const reload = useCallback(async () => {
    setBusy((n) => n + 1);
    try {
      setData(await repoRef.current.load({ refresh: true })); // kenali juga fitur yang diaktifkan dari perangkat lain
      toast('Data dimuat ulang');
    } catch (err) {
      toast(friendlyMessage(err), 'error');
    } finally {
      setBusy((n) => n - 1);
    }
  }, [toast]);

  /* ---------- aksi bisnis ---------- */
  const actions = useMemo(() => {
    const need = (cond, message) => {
      if (!cond) throw new Error(message);
    };

    return {
      async signIn() {
        setLoginError('');
        try {
          await auth.signIn(config.clientId);
        } catch (err) {
          setLoginError(authMessage(err));
        }
      },
      signOut: () => auth.signOut(),
      /** Lanjutkan sesi yang tokennya habis (dari ketukan pada dialog "Lanjutkan"). */
      async renewSession() {
        setReauthError('');
        try {
          await auth.renew(config.clientId);
        } catch (err) {
          setReauthError(authMessage(err));
        }
      },

      async connectExisting(input) {
        const id = parseSpreadsheetId(input);
        if (!id) {
          toast('URL atau ID spreadsheet tidak valid.', 'error');
          return;
        }
        await connect(id, auth.getSession().user);
      },
      async createNew(title) {
        setPhase('loading');
        try {
          const { spreadsheetId } = await createSpreadsheet(api, title.trim() || 'Bendahara Lite');
          await connect(spreadsheetId, auth.getSession().user, { autoInit: true });
        } catch (err) {
          toast(friendlyMessage(err), 'error');
          setPhase(dataRef.current ? 'ready' : 'noSheet'); // tetap di daftar buku, tidak kehilangan buku aktif
        }
      },
      async confirmInit() {
        if (initInfo) await connect(initInfo.id, initInfo.user, { autoInit: true });
      },
      /** Buka layar daftar buku (pilih / tambah / hubungkan). Buku aktif tidak terganggu sampai ada yang dipilih. */
      openSetup() {
        seqRef.current += 1; // batalkan sambungan yang masih berjalan
        setInitInfo(null);
        setSetupOpen(true);
        setPhase(dataRef.current ? 'ready' : 'noSheet');
      },
      closeSetup: () => setSetupOpen(false),
      switchBook(id) {
        if (id === sheetIdRef.current && dataRef.current) {
          setSetupOpen(false);
          return Promise.resolve();
        }
        return connect(id, auth.getSession().user);
      },
      /** Muat ulang daftar buku dari Drive (mis. setelah Drive API diaktifkan atau izin diberikan). */
      async refreshBooks() {
        const user = auth.getSession()?.user;
        if (!user) return;
        try {
          const { registry: reg, status } = await registry.load(user.email);
          setBooks(reg.books);
          setDriveStatus(status);
          if (status.state === 'ok') {
            toast('Tersinkron dengan Google Drive');
            // pastikan buku aktif ikut tercatat di Drive
            remember(user, sheetIdRef.current, sheetTitleRef.current);
          }
        } catch (err) {
          toast(friendlyMessage(err), 'error');
        }
      },
      /** Hapus dari daftar saja; spreadsheet-nya sendiri tidak disentuh. Buku aktif tidak bisa dihapus dari daftar. */
      async forgetBook(id) {
        if (id === sheetIdRef.current) return;
        try {
          const { registry: reg, status } = await registry.update(auth.getSession().user.email, (base) => removeBook(base, id));
          setBooks(reg.books);
          setDriveStatus(status);
          toast('Dihapus dari daftar. Spreadsheet-nya sendiri tidak dihapus.');
        } catch (err) {
          toast(friendlyMessage(err), 'error');
        }
      },
      retry() {
        const id = targetRef.current || sheetIdRef.current || DEFAULT_SHEET;
        if (id) connect(id, auth.getSession().user);
        else setPhase('noSheet');
      },

      /** Simpan form Pengaturan: nama kas, mode akun, dan akun kas sekaligus (akun ditulis lebih dulu, mode terakhir). */
      async saveCashSetup({ orgName: name, mode, rows }) {
        const ok = await run(async (r, d) => {
          need(ACCOUNT_MODES.includes(mode), 'Mode akun tidak dikenal.');
          const { toUpdate, toAdd } = planAccountSave(rows, d.accounts, mode);
          if (toUpdate.length) await r.update('accounts', toUpdate);
          if (toAdd.length) await r.add('accounts', toAdd);
          await r.upsert('info', [
            { id: 'org_name', value: name.trim() },
            { id: MODE_INFO_KEY, value: mode },
          ]);
        }, 'Pengaturan disimpan');
        if (ok) remember(auth.getSession().user, sheetIdRef.current, name.trim() || sheetTitleRef.current);
        return ok;
      },

      /* anggota */
      saveMember: (member) =>
        run((r) => {
          need(member.name.trim(), 'Nama anggota wajib diisi.');
          const record = { ...member, name: member.name.trim() };
          return member.id ? r.update('members', [record]) : r.add('members', [record]);
        }, 'Anggota disimpan'),
      addMembers: (names, startMonth) =>
        run((r) => r.add('members', names.map((name) => ({ name, active: true, startMonth }))), `${names.length} anggota ditambahkan`),

      /* periode */
      savePeriod: ({ period, allocations }) =>
        run(async (r, d) => {
          need(period.fee > 0, 'Iuran bulanan harus lebih dari 0.');
          const check = validateAllocations(period.fee, allocations);
          need(check.ok, check.error);
          let id = period.id;
          if (id) {
            const hasPayments = d.payments.some((p) => p.periodId === id);
            const old = d.periods.find((p) => p.id === id);
            need(!hasPayments || old.startMonth === period.startMonth, 'Bulan mulai tidak bisa diubah setelah ada iuran tercatat.');
            await r.update('periods', [period]);
          } else {
            id = newId('per');
            await r.add('periods', [{ ...period, id }]);
          }
          await r.upsert(
            'allocations',
            allocations.map((a) => ({ id: `${id}:${a.accountId}`, periodId: id, accountId: a.accountId, amount: a.amount })),
          );
        }, 'Periode disimpan'),
      deletePeriod: (period) =>
        run((r, d) => {
          need(!d.payments.some((p) => p.periodId === period.id), 'Periode yang sudah memiliki iuran tidak bisa dihapus.');
          return r.remove('periods', [period]);
        }, 'Periode dihapus'),

      /* iuran */
      addPayment: ({ period, memberId, month, amount, date, note }) =>
        run((r, d) => {
          need(Number.isSafeInteger(amount) && amount > 0, 'Jumlah harus lebih dari 0.');
          const prior = d.payments.filter((p) => p.periodId === period.id && p.memberId === memberId && p.month === month);
          const allocations = paymentAllocations(d, period.id, resolveAccountMode(d.info, d.accounts));
          const split = splitPayment(amount, allocations, mergeSplits(prior.map((p) => p.split)));
          return r.add('payments', [{ periodId: period.id, memberId, month, amount, date, note: note.trim(), split }]);
        }, 'Iuran dicatat'),
      voidPayment: (payment) => run((r) => r.remove('payments', [payment]), 'Pembayaran dibatalkan'),

      /* buku kas */
      saveTransaction: (tx) =>
        run((r) => {
          need(Number.isSafeInteger(tx.amount) && tx.amount > 0, 'Jumlah harus lebih dari 0.');
          need(tx.description.trim(), 'Keterangan wajib diisi.');
          const record = { ...tx, description: tx.description.trim() };
          return tx.id ? r.update('transactions', [record]) : r.add('transactions', [record]);
        }, 'Transaksi disimpan'),
      addTransfer: ({ date, fromId, toId, amount, description, fromName, toName }) =>
        run((r) => {
          need(fromId !== toId, 'Akun asal dan tujuan harus berbeda.');
          need(Number.isSafeInteger(amount) && amount > 0, 'Jumlah harus lebih dari 0.');
          const groupId = newId('pdh');
          const extra = description.trim() ? `: ${description.trim()}` : '';
          return r.add('transactions', [
            { date, type: 'out', accountId: fromId, amount, description: `Pindah ke ${toName}${extra}`, groupId },
            { date, type: 'in', accountId: toId, amount, description: `Pindah dari ${fromName}${extra}`, groupId },
          ]);
        }, 'Perpindahan saldo dicatat'),
      /* patungan */
      enableCollections: () => run((r) => r.enableFeature('collections'), 'Fitur Patungan diaktifkan'),
      /** Buat patungan baru (sekaligus kantongnya) atau ubah yang ada. Nama kantong mengikuti nama patungan. */
      saveCollection: (draft) =>
        run(async (r, d) => {
          need(d.features.collections === 'on', 'Fitur Patungan belum diaktifkan.');
          const fixed = draft.kind === KIND_FIXED;
          const fields = {
            name: String(draft.name ?? '').trim(),
            kind: draft.kind,
            amount: fixed ? draft.amount : 0,
            target: fixed ? 0 : draft.target || 0,
            date: draft.date,
            dueDate: draft.dueDate || '',
            excluded: fixed ? draft.excluded ?? {} : {},
            note: String(draft.note ?? '').trim(),
          };
          const error = validateCollection({ ...fields, id: draft.id }, d.collections);
          need(!error, error);
          if (draft.id) {
            const existing = d.collections.find((c) => c.id === draft.id);
            need(existing, 'Patungan sudah tidak ada di spreadsheet. Muat ulang data lalu ulangi.');
            await r.update('collections', [{ ...existing, ...fields }]);
            const pocket = d.pockets.find((p) => p.id === existing.accountId);
            if (pocket && pocket.name !== fields.name) await r.update('accounts', [{ ...pocket, name: fields.name }]);
            return;
          }
          // Kantong ditulis lebih dulu: bila langkah kedua gagal, yang tersisa hanya kantong kosong yang tersembunyi.
          const accountId = newId(POCKET_PREFIX);
          await r.add('accounts', [
            { id: accountId, name: fields.name, order: 1000 + d.pockets.length, openingBalance: 0, active: true, note: 'Kantong patungan' },
          ]);
          await r.add('collections', [{ ...fields, accountId, closed: false }]);
        }, 'Patungan disimpan'),
      setCollectionClosed: (collection, closed) =>
        run((r) => r.update('collections', [{ ...collection, closed }]), closed ? 'Patungan ditutup' : 'Patungan dibuka lagi'),
      /** Hapus hanya bila belum ada setoran dan kantongnya belum pernah dipakai; kantongnya ikut dinonaktifkan. */
      deleteCollection: (collection) =>
        run(async (r, d) => {
          need(!d.contributions.some((c) => c.collectionId === collection.id), 'Patungan yang sudah ada setorannya tidak bisa dihapus. Tutup saja.');
          need(!d.transactions.some((t) => t.accountId === collection.accountId), 'Kantong patungan ini sudah punya transaksi, jadi tidak bisa dihapus. Tutup saja.');
          await r.remove('collections', [collection]);
          const pocket = d.pockets.find((p) => p.id === collection.accountId);
          if (pocket) await r.update('accounts', [{ ...pocket, active: false }]);
        }, 'Patungan dihapus'),
      addContribution: ({ collection, memberId, amount, date, note }) =>
        run((r, d) => {
          const current = d.collections.find((c) => c.id === collection.id);
          need(current, 'Patungan sudah tidak ada di spreadsheet. Muat ulang data lalu ulangi.');
          need(!current.closed, 'Patungan sudah ditutup, tidak menerima setoran baru.');
          need(d.members.some((m) => m.id === memberId), 'Pilih anggota.');
          need(Number.isSafeInteger(amount) && amount > 0, 'Jumlah harus lebih dari 0.');
          return r.add('contributions', [{ collectionId: collection.id, memberId, amount, date, note: String(note ?? '').trim() }]);
        }, 'Setoran dicatat'),
      voidContribution: (contribution) => run((r) => r.remove('contributions', [contribution]), 'Setoran dibatalkan'),

      voidTransaction: (tx) =>
        run((r, d) => {
          const targets = tx.groupId ? d.transactions.filter((t) => t.groupId === tx.groupId) : [tx];
          return r.remove('transactions', targets);
        }, 'Transaksi dihapus'),
    };
  }, [api, connect, initInfo, registry, remember, run, toast]);

  /* ---------- turunan ---------- */
  const nowMonth = currentMonthKey();
  const period = useMemo(() => {
    if (!data) return null;
    return data.periods.find((p) => p.id === periodId) ?? pickDefaultPeriod(data.periods, nowMonth);
  }, [data, periodId, nowMonth]);

  const selectPeriod = useCallback(
    (id) => {
      setPeriodId(id);
      if (sheetId) pref.set(periodKey(sheetId), id);
    },
    [sheetId],
  );
  useEffect(() => {
    if (sheetId) setPeriodId(pref.get(periodKey(sheetId)));
  }, [sheetId]);

  const derived = useMemo(() => {
    if (!data) return null;
    // Kantong patungan ikut dihitung di buku kas, tetapi rekapnya terpisah dari kantong utama.
    const lines = buildLedgerLines({ ...data, accounts: [...data.accounts, ...data.pockets] });
    const parts = splitLines(lines, data.pockets);
    const overall = accountStatement(data.accounts, parts.main);
    const pocketsOverall = accountStatement(data.pockets, parts.pocket);
    const balances = new Map([...overall.rows, ...pocketsOverall.rows].map((r) => [r.accountId, r.closing]));
    const shownPockets = visiblePockets(data.pockets, data.collections, balances);
    const hasRemainder = data.periods.some((p) => {
      const used = data.allocations.filter((a) => a.periodId === p.id).reduce((s, a) => s + a.amount, 0);
      return p.fee - used > 0;
    });
    const umumRow = overall.rows.find((r) => r.accountId === UNALLOCATED_ID);
    return { lines, parts, overall, pocketsOverall, balances, shownPockets, unallocatedAvailable: hasRemainder || Boolean(umumRow) };
  }, [data]);

  // Tanpa sesi selalu tampil layar masuk, tanpa menunggu efek mengubah `phase` (menghindari satu render
  // dengan user === null saat keluar atau sesi berakhir).
  const value = {
    phase: session ? phase : 'signedOut', fatal, books, driveStatus, setupOpen, reauth, reauthError,
    bookTitle: books.find((b) => b.id === sheetId)?.title || data?.info?.org_name || sheetTitleRef.current, loginError, initInfo, session, user: session?.user ?? null,
    sheetId, sheetUrl: sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit` : '',
    data, derived, period, selectPeriod, nowMonth, busy: busy > 0,
    orgName: data?.info?.org_name || '',
    accountMode: data ? resolveAccountMode(data.info, data.accounts) : 'simple',
    collectionsEnabled: data?.features?.collections === 'on',
    reload, actions, config,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
