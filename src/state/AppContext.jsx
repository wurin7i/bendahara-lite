import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { config } from '../config.js';
import * as auth from '../google/auth.js';
import { AuthError, ConflictError, friendlyMessage } from '../google/errors.js';
import { createRepository, createSpreadsheet, parseSpreadsheetId } from '../google/repository.js';
import { createSheetsApi } from '../google/sheetsApi.js';
import { useToast } from '../components/ui.jsx';
import { UNALLOCATED_ID, mergeSplits, splitPayment, validateAllocations } from '../lib/allocation.js';
import { pickDefaultPeriod } from '../lib/dues.js';
import { newId } from '../lib/ids.js';
import { accountStatement, buildLedgerLines } from '../lib/ledger.js';
import { currentMonthKey } from '../lib/months.js';
import { periodAllocations } from '../lib/selectors.js';

auth.configureAuth(config.clientId);
const DEFAULT_SHEET = parseSpreadsheetId(config.defaultSpreadsheetId) ?? '';

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
const sheetKey = (email) => `${config.storagePrefix}.sheet.${email}`;
const periodKey = (sheetId) => `${config.storagePrefix}.period.${sheetId}`;

// Tautan berbagi: https://aplikasi/?sheet=<ID> -> dibaca sekali lalu dibersihkan dari URL.
const sheetFromUrl = (() => {
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

export function AppProvider({ children }) {
  const toast = useToast();
  const api = useMemo(
    // 401 = Google menolak token (dicabut/kedaluwarsa/tidak valid): batalkan sesi agar kembali ke layar masuk.
    () => createSheetsApi({ getToken: auth.getAccessToken, onUnauthorized: auth.invalidateSession }),
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

  const repoRef = useRef(null);
  const dataRef = useRef(null);
  const seqRef = useRef(0);
  repoRef.current = repo;
  dataRef.current = data;

  useEffect(() => auth.subscribe(setSession), []);
  useEffect(() => {
    if (config.clientId || config.demo) auth.preload(config.clientId);
  }, []);

  const failFatal = useCallback((err) => {
    if (err instanceof AuthError) return; // sesi sudah dihapus -> layar masuk
    setFatal(friendlyMessage(err));
    setPhase('error');
  }, []);

  const connect = useCallback(
    async (id, user, { autoInit = false } = {}) => {
      const seq = ++seqRef.current;
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
        pref.set(sheetKey(user.email), id);
        setSheetId(id);
        setRepo(next);
        setData(loaded);
        setInitInfo(null);
        setPhase('ready');
      } catch (err) {
        if (seq === seqRef.current) failFatal(err);
      }
    },
    [api, failFatal],
  );

  // Mulai/akhiri alur sesuai siapa yang sedang masuk.
  const email = session?.user?.email ?? null;
  useEffect(() => {
    if (!email) {
      seqRef.current += 1;
      setRepo(null);
      setData(null);
      setSheetId('');
      setInitInfo(null);
      setPhase('signedOut');
      return;
    }
    const id = sheetFromUrl || pref.get(sheetKey(email)) || DEFAULT_SHEET;
    if (!id) {
      setPhase('noSheet');
      return;
    }
    connect(id, auth.getSession().user);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  /* ---------- eksekusi tulis + muat ulang ---------- */
  const run = useCallback(
    async (write, success) => {
      setBusy((n) => n + 1);
      try {
        await write(repoRef.current, dataRef.current);
      } catch (err) {
        toast(friendlyMessage(err), 'error');
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
      setData(await repoRef.current.load());
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
          setLoginError(friendlyMessage(err));
        }
      },
      signOut: () => auth.signOut(),

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
          setPhase('noSheet');
        }
      },
      async confirmInit() {
        if (initInfo) await connect(initInfo.id, initInfo.user, { autoInit: true });
      },
      changeSpreadsheet() {
        seqRef.current += 1;
        setRepo(null);
        setData(null);
        setInitInfo(null);
        setPhase('noSheet');
      },
      retry() {
        const id = sheetId || pref.get(sheetKey(email)) || DEFAULT_SHEET;
        if (id) connect(id, auth.getSession().user);
        else setPhase('noSheet');
      },

      setOrgName: (name) => run((r) => r.upsert('info', [{ id: 'org_name', value: name.trim() }]), 'Nama disimpan'),

      /* anggota */
      saveMember: (member) =>
        run((r) => {
          need(member.name.trim(), 'Nama anggota wajib diisi.');
          const record = { ...member, name: member.name.trim() };
          return member.id ? r.update('members', [record]) : r.add('members', [record]);
        }, 'Anggota disimpan'),
      addMembers: (names, startMonth) =>
        run((r) => r.add('members', names.map((name) => ({ name, active: true, startMonth }))), `${names.length} anggota ditambahkan`),

      /* akun kas */
      saveAccount: (account) =>
        run((r, d) => {
          need(account.name.trim(), 'Nama akun wajib diisi.');
          const record = { ...account, name: account.name.trim() };
          if (account.id) return r.update('accounts', [record]);
          const order = d.accounts.reduce((m, a) => Math.max(m, a.order), 0) + 1;
          return r.add('accounts', [{ ...record, order }]);
        }, 'Akun kas disimpan'),
      moveAccount: (id, direction) =>
        run((r, d) => {
          const list = [...d.accounts];
          const from = list.findIndex((a) => a.id === id);
          const to = from + direction;
          if (from < 0 || to < 0 || to >= list.length) return Promise.resolve();
          [list[from], list[to]] = [list[to], list[from]];
          const changed = list
            .map((a, i) => ({ ...a, order: i + 1 }))
            .filter((a) => d.accounts.find((x) => x.id === a.id).order !== a.order);
          return r.update('accounts', changed);
        }),

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
          const split = splitPayment(amount, periodAllocations(d, period.id), mergeSplits(prior.map((p) => p.split)));
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
      voidTransaction: (tx) =>
        run((r, d) => {
          const targets = tx.groupId ? d.transactions.filter((t) => t.groupId === tx.groupId) : [tx];
          return r.remove('transactions', targets);
        }, 'Transaksi dihapus'),
    };
  }, [api, connect, email, initInfo, run, sheetId, toast]);

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
    const lines = buildLedgerLines(data);
    const overall = accountStatement(data.accounts, lines);
    const hasRemainder = data.periods.some((p) => {
      const used = data.allocations.filter((a) => a.periodId === p.id).reduce((s, a) => s + a.amount, 0);
      return p.fee - used > 0;
    });
    const umumRow = overall.rows.find((r) => r.accountId === UNALLOCATED_ID);
    return { lines, overall, unallocatedAvailable: hasRemainder || Boolean(umumRow) };
  }, [data]);

  // Tanpa sesi selalu tampil layar masuk, tanpa menunggu efek mengubah `phase` (menghindari satu render
  // dengan user === null saat keluar atau sesi berakhir).
  const value = {
    phase: session ? phase : 'signedOut', fatal, loginError, initInfo, session, user: session?.user ?? null,
    sheetId, sheetUrl: sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit` : '',
    data, derived, period, selectPeriod, nowMonth, busy: busy > 0,
    orgName: data?.info?.org_name || '',
    reload, actions, config,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
