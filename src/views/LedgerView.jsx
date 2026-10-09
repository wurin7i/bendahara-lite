import { useMemo, useState } from 'react';
import { ConfirmButton, Empty, Field, Modal, MoneyInput } from '../components/ui.jsx';
import { UNALLOCATED_ID, UNALLOCATED_NAME } from '../lib/allocation.js';
import { buildLedgerView } from '../lib/ledger.js';
import { formatNumber, formatRupiah } from '../lib/money.js';
import { formatDate, isISODate, periodRange, periodRangeLabel, todayISO } from '../lib/months.js';
import { useApp } from '../state/AppContext.jsx';

/** Akun yang boleh dipilih untuk transaksi: akun aktif (+ akun yang sedang dipakai), dan Umum bila relevan. */
function useAccountOptions(currentIds = []) {
  const { data, derived } = useApp();
  const options = data.accounts.filter((a) => a.active || currentIds.includes(a.id)).map((a) => ({ id: a.id, name: a.name }));
  if (derived.unallocatedAvailable || currentIds.includes(UNALLOCATED_ID)) {
    options.push({ id: UNALLOCATED_ID, name: UNALLOCATED_NAME });
  }
  return options;
}

export default function LedgerView() {
  const { data, derived, period, actions, accountMode } = useApp();
  const simple = accountMode === 'simple'; // satu akun: tanpa filter akun, kolom Akun, dan pindah saldo
  const [accountId, setAccountId] = useState('');
  const [scope, setScope] = useState('period');
  const [modal, setModal] = useState(null); // { mode: 'out' | 'in' | 'transfer', tx? }

  const range = scope === 'period' && period ? periodRange(period.startMonth) : { from: null, to: null };
  const view = useMemo(
    () => buildLedgerView(data.accounts, derived.lines, { accountId: accountId || null, ...range }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.accounts, derived.lines, accountId, range.from, range.to],
  );

  const nameOf = (id) => (id === UNALLOCATED_ID ? UNALLOCATED_NAME : data.accounts.find((a) => a.id === id)?.name ?? id);
  const filterOptions = useAccountOptions();
  const noAccounts = data.accounts.length === 0;
  const showAccountCol = !simple && !accountId;

  return (
    <>
      <div className="page-head">
        <h1>
          Buku Kas
          <span className="sub">
            {scope === 'period' && period ? periodRangeLabel(period.startMonth) : 'Semua waktu'}
            {!simple && (accountId ? ` · ${nameOf(accountId)}` : ' · semua akun')}
          </span>
        </h1>
        <div className="toolbar no-print">
          <button type="button" className="btn" onClick={() => setModal({ mode: 'out' })} disabled={noAccounts && !derived.unallocatedAvailable}>
            − Pengeluaran
          </button>
          <button type="button" className="btn" onClick={() => setModal({ mode: 'in' })} disabled={noAccounts && !derived.unallocatedAvailable}>
            + Pemasukan lain
          </button>
          {!simple && (
            <button type="button" className="btn" onClick={() => setModal({ mode: 'transfer' })} disabled={filterOptions.length < 2}>
              ⇄ Pindah saldo
            </button>
          )}
        </div>
      </div>

      <div className="toolbar no-print" style={{ marginBottom: '0.75rem' }}>
        {!simple && (
          <>
            <label className="sr-only" htmlFor="ledger-account">Akun</label>
            <select id="ledger-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Semua akun</option>
              {filterOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </>
        )}
        <label className="sr-only" htmlFor="ledger-scope">Rentang</label>
        <select id="ledger-scope" value={scope} onChange={(e) => setScope(e.target.value)} disabled={!period}>
          <option value="period">Periode terpilih</option>
          <option value="all">Semua waktu</option>
        </select>
        <button type="button" className="btn ghost" onClick={() => window.print()}>Cetak</button>
      </div>

      {noAccounts && (
        <Empty title="Belum ada akun kas">
          <p>Tambahkan akun kas di <a href="#/pengaturan">Pengaturan</a> sebelum mencatat transaksi.</p>
        </Empty>
      )}

      {!noAccounts && (
        <div className="table-scroll">
          <table className="simple">
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Keterangan</th>
                {showAccountCol && <th>Akun</th>}
                <th className="num">Masuk</th>
                <th className="num">Keluar</th>
                <th className="num">Saldo</th>
                <th className="no-print" />
              </tr>
            </thead>
            <tbody>
              <tr className="muted-row">
                <td />
                <td colSpan={showAccountCol ? 3 : 2}><em>Saldo awal</em></td>
                <td className="num" />
                <td className="num"><strong>{formatNumber(view.opening)}</strong></td>
                <td className="no-print" />
              </tr>
              {view.entries.length === 0 && (
                <tr><td colSpan={showAccountCol ? 7 : 6} className="muted" style={{ textAlign: 'center', padding: '1.5rem' }}>Belum ada transaksi pada rentang ini.</td></tr>
              )}
              {view.entries.map((e) => {
                const names = e.accountIds.map(nameOf);
                const original = e.source === 'dues' ? null : data.transactions.find((t) => t.id === e.ref);
                return (
                  <tr key={e.key}>
                    <td className="nowrap">{formatDate(e.date)}</td>
                    <td>
                      {e.description}
                      {e.source === 'dues' && <span className="tag dues">Iuran</span>}
                      {e.source === 'transfer' && <span className="tag">Pindah</span>}
                    </td>
                    {showAccountCol && (
                      <td className="small" title={names.join(', ')}>
                        {names[0]}{names.length > 1 ? ` +${names.length - 1}` : ''}
                      </td>
                    )}
                    <td className="num">{e.in ? formatNumber(e.in) : ''}</td>
                    <td className="num">{e.out ? formatNumber(e.out) : ''}</td>
                    <td className="num">{formatNumber(e.balance)}</td>
                    <td className="no-print">
                      {original && (
                        <div className="row-actions">
                          {original.groupId ? null : (
                            <button type="button" className="btn small ghost" onClick={() => setModal({ mode: original.type, tx: original })}>
                              Ubah
                            </button>
                          )}
                          <ConfirmButton onConfirm={() => actions.voidTransaction(original)} confirmLabel="Hapus?">
                            Hapus
                          </ConfirmButton>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={showAccountCol ? 3 : 2}>Total / Saldo akhir</th>
                <td className="num">{formatNumber(view.totalIn)}</td>
                <td className="num">{formatNumber(view.totalOut)}</td>
                <td className="num">{formatNumber(view.closing)}</td>
                <td className="no-print" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="hint">
        Iuran anggota masuk otomatis dari menu Iuran.
        {!simple && ' Pindah saldo antar akun tercatat sebagai pasangan keluar/masuk dan tidak mengubah total kas.'}
      </p>

      {modal && <TransactionModal {...modal} onClose={() => setModal(null)} />}
    </>
  );
}

const TITLES = { out: 'Catat pengeluaran', in: 'Catat pemasukan lain', transfer: 'Pindah saldo antar akun' };

function TransactionModal({ mode, tx, onClose }) {
  const { data, derived, actions, accountMode } = useApp();
  const editing = Boolean(tx);
  const options = useAccountOptions(tx ? [tx.accountId] : []);
  const pickAccount = accountMode !== 'simple' || options.length > 1;

  const [date, setDate] = useState(tx?.date ?? todayISO());
  const [accountId, setAccountId] = useState(tx?.accountId ?? options[0]?.id ?? '');
  const [toId, setToId] = useState(options.find((o) => o.id !== (tx?.accountId ?? options[0]?.id))?.id ?? '');
  const [amount, setAmount] = useState(tx?.amount ?? '');
  const [description, setDescription] = useState(tx?.description ?? '');
  const [saving, setSaving] = useState(false);

  const valid =
    Number.isSafeInteger(amount) && amount > 0 && isISODate(date) && accountId &&
    (mode === 'transfer' ? toId && toId !== accountId : description.trim().length > 0);

  // Peringatan (tidak memblokir) bila saldo akun akan menjadi minus.
  const balance = derived.overall.rows.find((r) => r.accountId === accountId)?.closing ?? 0;
  const releasing = editing && tx.accountId === accountId && tx.type === 'out' ? tx.amount : 0;
  const overdraw = mode !== 'in' && Number.isSafeInteger(amount) && amount > balance + releasing;
  const nameOf = (id) => options.find((o) => o.id === id)?.name ?? id;

  async function submit(e) {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    const ok =
      mode === 'transfer'
        ? await actions.addTransfer({ date, fromId: accountId, toId, amount, description, fromName: nameOf(accountId), toName: nameOf(toId) })
        : await actions.saveTransaction({ ...(tx ?? {}), date, type: mode, accountId, amount, description, groupId: tx?.groupId ?? '' });
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Modal title={editing ? `Ubah ${mode === 'out' ? 'pengeluaran' : 'pemasukan'}` : TITLES[mode]} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="row">
          <Field label="Tanggal">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          {pickAccount && (
            <Field label={mode === 'transfer' ? 'Dari akun' : 'Akun kas'}>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </Field>
          )}
        </div>
        {mode === 'transfer' && (
          <Field label="Ke akun">
            <select value={toId} onChange={(e) => setToId(e.target.value)}>
              <option value="">Pilih akun…</option>
              {options.filter((o) => o.id !== accountId).map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Jumlah" hint={mode !== 'in' ? `Saldo ${nameOf(accountId)} saat ini ${formatRupiah(balance)}` : undefined}>
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
        </Field>
        <Field label={mode === 'transfer' ? 'Keterangan (opsional)' : 'Keterangan'}>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={mode === 'out' ? 'mis. Beli spidol dan penghapus' : mode === 'in' ? 'mis. Donasi alumni' : 'mis. Pinjam untuk acara'}
            required={mode !== 'transfer'}
          />
        </Field>
        {overdraw && (
          <div className="notice warn small">Jumlah melebihi saldo akun ini; saldonya akan menjadi minus.</div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Batal</button>
          <button type="submit" className="btn primary" disabled={!valid || saving}>
            {saving ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
