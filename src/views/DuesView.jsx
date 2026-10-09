import { useMemo, useState } from 'react';
import { ConfirmButton, Field, Modal, MoneyInput, Stat } from '../components/ui.jsx';
import { UNALLOCATED_ID, UNALLOCATED_NAME, mergeSplits, splitPayment } from '../lib/allocation.js';
import { buildDuesTable, highlightMonth } from '../lib/dues.js';
import { formatNumber, formatRupiah } from '../lib/money.js';
import { formatDate, isISODate, monthLabel, todayISO } from '../lib/months.js';
import { paymentAllocations, periodAllocationSummary, periodSubtitle } from '../lib/selectors.js';
import { useApp } from '../state/AppContext.jsx';
import { Onboarding } from './Onboarding.jsx';

const STATUS_TEXT = { paid: 'lunas', partial: 'sebagian', due: 'belum bayar', upcoming: 'belum jatuh tempo', na: 'tidak ditagih' };

export default function DuesView() {
  const { data, period, nowMonth, accountMode } = useApp();
  const simple = accountMode === 'simple';
  const [target, setTarget] = useState(null); // { member, month }

  const table = useMemo(
    () => (period ? buildDuesTable({ period, members: data.members, payments: data.payments, nowMonth }) : null),
    [period, data.members, data.payments, nowMonth],
  );

  const setupDone = data.accounts.length > 0 && data.periods.length > 0 && data.members.length > 0;
  if (!period || !table) {
    return (
      <>
        <h1 style={{ marginBottom: '1rem' }}>Iuran</h1>
        <Onboarding />
      </>
    );
  }

  const summary = periodAllocationSummary(data, period);
  const current = highlightMonth(period, nowMonth);
  const activeMembers = data.members.filter((m) => m.active).length;
  const paidThisMonth = current ? table.rows.filter((r) => r.cells[current].status === 'paid' && r.cells[current].obligated).length : null;
  const obligatedThisMonth = current ? table.rows.filter((r) => r.cells[current].obligated).length : null;

  return (
    <>
      <div className="page-head">
        <h1>
          Iuran Bulanan
          <span className="sub">{periodSubtitle(period)}</span>
        </h1>
      </div>

      {!setupDone && <Onboarding />}

      <div className="stats">
        <Stat label="Iuran per anggota / bulan" value={formatRupiah(period.fee)} sub={`${activeMembers} anggota aktif`} />
        <Stat
          label="Terkumpul"
          value={formatRupiah(table.totals.collected)}
          sub={`Target setahun ${formatRupiah(table.totals.expectedFull)}`}
          tone="good"
        />
        <Stat
          label="Tunggakan s.d. bulan ini"
          value={formatRupiah(table.totals.arrears)}
          sub={table.totals.arrears ? `${table.rows.filter((r) => r.arrears > 0).length} anggota menunggak` : 'Tidak ada tunggakan'}
          tone={table.totals.arrears ? 'bad' : undefined}
        />
        {current && (
          <Stat label={`Lunas ${monthLabel(current)}`} value={`${paidThisMonth} / ${obligatedThisMonth}`} sub="anggota" />
        )}
      </div>

      {!simple && (
        <div className="alloc-line">
          <span>Pembagian iuran:</span>
          {summary.allocations.map((a) => (
            <span key={a.accountId}>
              {data.accounts.find((x) => x.id === a.accountId)?.name} <b>{formatNumber(a.amount)}</b>
            </span>
          ))}
          {summary.remainder > 0 && (
            <span>Umum <b>{formatNumber(summary.remainder)}</b></span>
          )}
          {summary.allocations.length === 0 && <span>belum diatur (semua masuk Umum), atur di Pengaturan</span>}
        </div>
      )}

      {table.rows.length === 0 ? (
        <div className="empty card">
          <h2>Belum ada anggota</h2>
          <p>Tambahkan anggota di menu Anggota untuk mulai mencatat iuran.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="dues">
            <thead>
              <tr>
                <th className="sticky">Anggota</th>
                {table.months.map((m) => (
                  <th key={m} className={`month${m === current ? ' current' : ''}`}>{monthLabel(m)}</th>
                ))}
                <th className="num">Total</th>
                <th className="num">Tunggakan</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.member.id}>
                  <th scope="row" className="sticky">
                    {row.member.name}
                    {!row.member.active && <span className="tag">nonaktif</span>}
                  </th>
                  {table.months.map((m) => {
                    const cell = row.cells[m];
                    return (
                      <td key={m}>
                        <button
                          type="button"
                          className={`cell ${cell.status}`}
                          aria-label={`${row.member.name}, ${monthLabel(m)}: ${STATUS_TEXT[cell.status]}${cell.paid ? ` ${formatRupiah(cell.paid)}` : ''}`}
                          onClick={() => setTarget({ member: row.member, month: m })}
                        >
                          {cell.paid > 0 ? formatNumber(cell.paid) : cell.status === 'due' ? 'belum' : cell.status === 'na' ? '–' : ''}
                        </button>
                      </td>
                    );
                  })}
                  <td className="num total">{formatNumber(row.totalPaid)}</td>
                  <td className="num total" style={row.arrears ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>
                    {row.arrears ? formatNumber(row.arrears) : '–'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th className="sticky">Total</th>
                {table.months.map((m) => (
                  <td key={m}>{table.columnTotals[m] ? formatNumber(table.columnTotals[m]) : '–'}</td>
                ))}
                <td>{formatNumber(table.totals.collected)}</td>
                <td>{formatNumber(table.totals.arrears)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="legend">
        <span className="l-paid">Lunas</span>
        <span className="l-partial">Sebagian</span>
        <span className="l-due">Belum bayar (sudah jatuh tempo)</span>
        <span>Klik sel untuk mencatat atau membatalkan pembayaran</span>
      </div>

      {target && (
        <PaymentDialog period={period} member={target.member} month={target.month} onClose={() => setTarget(null)} />
      )}
    </>
  );
}

function PaymentDialog({ period, member, month, onClose }) {
  const { data, actions, accountMode } = useApp();
  const simple = accountMode === 'simple';
  const payments = data.payments
    .filter((p) => p.periodId === period.id && p.memberId === member.id && p.month === month)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(0, period.fee - paid);

  const [amount, setAmount] = useState(remaining || '');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const valid = Number.isSafeInteger(amount) && amount > 0 && isISODate(date);
  const preview = valid
    ? splitPayment(amount, paymentAllocations(data, period.id, accountMode), mergeSplits(payments.map((p) => p.split)))
    : null;
  const nameOf = (id) => (id === UNALLOCATED_ID ? UNALLOCATED_NAME : data.accounts.find((a) => a.id === id)?.name ?? id);

  async function submit(e) {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    const ok = await actions.addPayment({ period, memberId: member.id, month, amount, date, note });
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Modal title={`${member.name} · ${monthLabel(month, { long: true })}`} onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>
        Iuran {formatRupiah(period.fee)} · terbayar <strong>{formatRupiah(paid)}</strong>
        {remaining > 0 ? <> · kurang <strong>{formatRupiah(remaining)}</strong></> : paid > 0 ? ' · lunas' : ''}
      </p>

      {payments.length > 0 && (
        <ul className="pay-list" aria-label="Pembayaran tercatat">
          {payments.map((p) => (
            <li key={p.id}>
              <div className="grow">
                <div><strong>{formatRupiah(p.amount)}</strong> <span className="muted small">· {formatDate(p.date)}</span></div>
                {(p.note || p.createdBy) && (
                  <div className="muted small">{[p.note, p.createdBy && `dicatat ${p.createdBy}`].filter(Boolean).join(' · ')}</div>
                )}
              </div>
              <ConfirmButton onConfirm={() => actions.voidPayment(p)} confirmLabel="Ya, batalkan">Batalkan</ConfirmButton>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit}>
        <h3 style={{ marginBottom: '0.6rem' }}>Catat pembayaran</h3>
        <div className="row">
          <Field label="Jumlah">
            <MoneyInput value={amount} onChange={setAmount} autoFocus aria-label="Jumlah" />
          </Field>
          <Field label="Tanggal bayar">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        </div>
        <Field label="Catatan (opsional)">
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. transfer BCA" />
        </Field>

        {preview && !simple && (
          <div className="split-preview" aria-label="Pembagian ke akun kas">
            <div className="muted small" style={{ marginBottom: '0.2rem' }}>Akan dibagi ke akun kas:</div>
            {Object.entries(preview).map(([id, value]) => (
              <div key={id}><span>{nameOf(id)}</span><b>{formatRupiah(value)}</b></div>
            ))}
          </div>
        )}
        {valid && amount > remaining && (
          <div className="notice warn small">
            {simple
              ? 'Jumlah melebihi kekurangan bulan ini. Untuk membayar bulan lain, catat di sel bulan tersebut.'
              : 'Jumlah melebihi kekurangan bulan ini. Kelebihannya masuk ke “Umum”. Untuk membayar bulan lain, catat di sel bulan tersebut.'}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Tutup</button>
          <button type="submit" className="btn primary" disabled={!valid || saving}>
            {saving ? 'Menyimpan…' : 'Simpan pembayaran'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
