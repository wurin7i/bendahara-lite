import { useMemo, useState } from 'react';
import { AccountOptions, TransactionModal, useAccountOptions } from '../components/TransactionModal.jsx';
import { ConfirmButton, Empty } from '../components/ui.jsx';
import { UNALLOCATED_ID, UNALLOCATED_NAME } from '../lib/allocation.js';
import { buildLedgerView } from '../lib/ledger.js';
import { formatNumber } from '../lib/money.js';
import { formatDate, periodRange, periodRangeLabel } from '../lib/months.js';
import { useApp } from '../state/AppContext.jsx';

const ALL = '__semua__'; // filter: kas utama + seluruh kantong patungan

export default function LedgerView() {
  const { data, derived, period, actions, accountMode } = useApp();
  // Mode Sederhana tanpa kantong patungan: tanpa filter akun, kolom Akun, dan pindah saldo.
  const simple = accountMode === 'simple';
  const [accountId, setAccountId] = useState(''); // '' = kas utama, ALL = semua, selain itu satu akun
  const [scope, setScope] = useState('period');
  const [modal, setModal] = useState(null); // { mode: 'out' | 'in' | 'transfer', tx? }

  const allAccounts = useMemo(() => [...data.accounts, ...data.pockets], [data.accounts, data.pockets]);
  // Kantong untuk filter: yang masih tampil, plus yang pernah punya mutasi (riwayat patungan yang sudah ditutup).
  const pocketsWithLines = new Set(derived.lines.map((l) => l.accountId));
  const filterOptions = useAccountOptions(data.pockets.filter((p) => pocketsWithLines.has(p.id)).map((p) => p.id));
  const transferOptions = useAccountOptions();
  const hasPockets = filterOptions.some((o) => o.pocket);
  const showFilter = !simple || hasPockets;
  const canTransfer = !simple || transferOptions.some((o) => o.pocket);

  const range = scope === 'period' && period ? periodRange(period.startMonth) : { from: null, to: null };
  const single = accountId && accountId !== ALL ? accountId : null;
  const view = useMemo(
    () => buildLedgerView(accountId === '' ? data.accounts : allAccounts, derived.lines, { accountId: single, ...range }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.accounts, allAccounts, derived.lines, accountId, range.from, range.to],
  );

  const nameOf = (id) => (id === UNALLOCATED_ID ? UNALLOCATED_NAME : allAccounts.find((a) => a.id === id)?.name ?? id);
  const noAccounts = data.accounts.length === 0;
  const showAccountCol = !single && (!simple || accountId === ALL);
  const scopeLabel = single ? nameOf(single) : accountId === ALL ? 'semua kantong' : hasPockets ? 'kas utama' : 'semua akun';

  return (
    <>
      <div className="page-head">
        <h1>
          Buku Kas
          <span className="sub">
            {scope === 'period' && period ? periodRangeLabel(period.startMonth) : 'Semua waktu'}
            {showFilter && ` · ${scopeLabel}`}
          </span>
        </h1>
        <div className="toolbar no-print">
          <button type="button" className="btn" onClick={() => setModal({ mode: 'out' })} disabled={noAccounts && !derived.unallocatedAvailable}>
            − Pengeluaran
          </button>
          <button type="button" className="btn" onClick={() => setModal({ mode: 'in' })} disabled={noAccounts && !derived.unallocatedAvailable}>
            + Pemasukan lain
          </button>
          {canTransfer && (
            <button type="button" className="btn" onClick={() => setModal({ mode: 'transfer' })} disabled={transferOptions.length < 2}>
              ⇄ Pindah saldo
            </button>
          )}
        </div>
      </div>

      <div className="toolbar no-print" style={{ marginBottom: '0.75rem' }}>
        {showFilter && (
          <>
            <label className="sr-only" htmlFor="ledger-account">Akun</label>
            <select id="ledger-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">{hasPockets ? 'Kas utama (tanpa patungan)' : 'Semua akun'}</option>
              {hasPockets && <option value={ALL}>Semua, termasuk patungan</option>}
              {simple ? (
                <optgroup label="Kantong patungan">
                  {filterOptions.filter((o) => o.pocket).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </optgroup>
              ) : (
                <AccountOptions options={filterOptions} />
              )}
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
                const original = e.source === 'manual' || e.source === 'transfer' ? data.transactions.find((t) => t.id === e.ref) : null;
                return (
                  <tr key={e.key}>
                    <td className="nowrap">{formatDate(e.date)}</td>
                    <td>
                      {e.description}
                      {e.source === 'dues' && <span className="tag dues">Iuran</span>}
                      {e.source === 'collection' && <span className="tag pocket">Patungan</span>}
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
        Iuran anggota masuk otomatis dari menu Iuran{hasPockets ? ', setoran patungan dari menu Patungan ke kantongnya masing-masing' : ''}.
        {canTransfer && ' Pindah saldo antar akun tercatat sebagai pasangan keluar/masuk dan tidak mengubah total kas.'}
      </p>

      {modal && <TransactionModal {...modal} onClose={() => setModal(null)} />}
    </>
  );
}
