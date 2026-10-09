import { useMemo } from 'react';
import { Empty, Stat } from '../components/ui.jsx';
import { buildDuesTable } from '../lib/dues.js';
import { accountStatement } from '../lib/ledger.js';
import { formatDate, monthLabel, periodRange, todayISO } from '../lib/months.js';
import { formatNumber, formatRupiah } from '../lib/money.js';
import { periodSubtitle } from '../lib/selectors.js';
import { useApp } from '../state/AppContext.jsx';

export default function ReportView() {
  const { data, derived, period, nowMonth, orgName } = useApp();

  const range = period ? periodRange(period.startMonth) : { from: null, to: null };
  const statement = useMemo(
    () => accountStatement(data.accounts, derived.lines, range),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.accounts, derived.lines, range.from, range.to],
  );
  const dues = useMemo(
    () => (period ? buildDuesTable({ period, members: data.members, payments: data.payments, nowMonth }) : null),
    [period, data.members, data.payments, nowMonth],
  );

  if (!period) {
    return (
      <Empty title="Belum ada periode">
        <p>Buat periode di <a href="#/pengaturan">Pengaturan</a> untuk melihat laporan.</p>
      </Empty>
    );
  }

  const income = statement.total.in - statement.transferIn;
  const expense = statement.total.out - statement.transferOut;
  const arrearsRows = dues.rows.filter((r) => r.arrears > 0).sort((a, b) => b.arrears - a.arrears);

  return (
    <>
      <div className="page-head">
        <h1>
          Laporan Saldo Akhir
          <span className="sub">
            {orgName ? `${orgName} · ` : ''}{periodSubtitle(period)}
          </span>
        </h1>
        <div className="toolbar no-print">
          <button type="button" className="btn" onClick={() => window.print()}>Cetak / simpan PDF</button>
        </div>
      </div>

      <div className="stats">
        <Stat label="Saldo kas saat ini" value={formatRupiah(derived.overall.total.closing)} sub="seluruh transaksi yang tercatat" />
        <Stat label="Saldo akhir periode" value={formatRupiah(statement.total.closing)} sub={`per ${formatDate(range.to)}`} tone="good" />
        <Stat label="Pemasukan periode" value={formatRupiah(income)} sub="iuran + pemasukan lain" />
        <Stat label="Pengeluaran periode" value={formatRupiah(expense)} />
      </div>

      <section className="card" aria-labelledby="rep-accounts">
        <div className="card-head">
          <h2 id="rep-accounts">Saldo per akun kas</h2>
        </div>
        <div className="table-scroll">
          <table className="simple">
            <thead>
              <tr>
                <th>Akun kas</th>
                <th className="num">Saldo awal</th>
                <th className="num">Masuk</th>
                <th className="num">Keluar</th>
                <th className="num">Saldo akhir</th>
              </tr>
            </thead>
            <tbody>
              {statement.rows.map((r) => (
                <tr key={r.accountId} className={r.active ? '' : 'muted-row'}>
                  <td>{r.name}{!r.active && <span className="tag">nonaktif</span>}</td>
                  <td className="num">{formatNumber(r.opening)}</td>
                  <td className="num">{formatNumber(r.in)}</td>
                  <td className="num">{formatNumber(r.out)}</td>
                  <td className="num"><strong style={r.closing < 0 ? { color: 'var(--danger)' } : undefined}>{formatNumber(r.closing)}</strong></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>Total</th>
                <td className="num">{formatNumber(statement.total.opening)}</td>
                <td className="num">{formatNumber(statement.total.in)}</td>
                <td className="num">{formatNumber(statement.total.out)}</td>
                <td className="num">{formatNumber(statement.total.closing)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {statement.transferIn > 0 && (
          <p className="hint">
            Kolom Masuk/Keluar sudah termasuk perpindahan saldo antar akun sebesar {formatRupiah(statement.transferIn)} yang
            saling meniadakan pada total.
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="rep-dues">
        <div className="card-head">
          <h2 id="rep-dues">Iuran periode ini</h2>
        </div>
        <div className="stats" style={{ marginBottom: '0.75rem' }}>
          <Stat label="Terkumpul" value={formatRupiah(dues.totals.collected)} />
          <Stat label="Target s.d. bulan ini" value={formatRupiah(dues.totals.expectedToDate)} />
          <Stat label="Tunggakan" value={formatRupiah(dues.totals.arrears)} tone={dues.totals.arrears ? 'bad' : 'good'} />
        </div>
        {arrearsRows.length === 0 ? (
          <p className="muted">Tidak ada tunggakan sampai {monthLabel(nowMonth)}.</p>
        ) : (
          <div className="table-scroll">
            <table className="simple">
              <thead>
                <tr>
                  <th>Anggota</th>
                  <th className="num">Bulan menunggak</th>
                  <th className="num">Jumlah</th>
                </tr>
              </thead>
              <tbody>
                {arrearsRows.map((r) => (
                  <tr key={r.member.id}>
                    <td>{r.member.name}</td>
                    <td className="num">{r.arrearMonths}</td>
                    <td className="num">{formatNumber(r.arrears)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="hint">Dicetak {formatDate(todayISO())}</p>
    </>
  );
}
