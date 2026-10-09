import { useState } from 'react';
import { ConfirmButton, Field, Modal, MoneyInput, MonthPicker } from '../components/ui.jsx';
import { sumAmounts, validateAllocations } from '../lib/allocation.js';
import { formatNumber, formatRupiah } from '../lib/money.js';
import { addMonths, periodRangeLabel } from '../lib/months.js';
import { periodAllocationSummary, periodTitle } from '../lib/selectors.js';
import { useToast } from '../components/ui.jsx';
import {
  MODE_LABELS, canSwitchToSimple, collapseToSimple, defaultAccountName, pickPrimaryRow, primaryAccount, rowsFromAccounts,
  validateAccountRows,
} from '../lib/accountMode.js';
import { DriveNotice } from '../components/DriveNotice.jsx';
import { useApp } from '../state/AppContext.jsx';

export default function SettingsView() {
  return (
    <>
      <div className="page-head">
        <h1>Pengaturan</h1>
      </div>
      <CashSetupSection />
      <PeriodsSection />
      <FeaturesSection />
      <SpreadsheetSection />
    </>
  );
}

/* ------------------------------------------------------------------ Kas & akun kas */

const MODE_HINTS = {
  simple:
    'Satu akun kas untuk semua iuran. Pilih Multi akun kas bila uang iuran perlu dibagi ke beberapa “kantong”, mis. Kas Kelas dan Dana Darurat.',
  multi:
    'Iuran dibagi ke beberapa akun kas (“kantong”), mis. Kas Kelas, Dana Darurat, Tabungan Wisata. Urutan menentukan prioritas: bila anggota membayar sebagian, akun paling atas terisi lebih dulu.',
};

let rowSeq = 0;
const newRow = (name = '') => ({ key: `new-${++rowSeq}`, name, openingBalance: '', note: '', active: true });

function CashSetupSection() {
  const { data, orgName, accountMode } = useApp();
  // Draf di-reset (remount) setiap data tersimpan berubah, mis. setelah Simpan atau Muat ulang data.
  const savedKey = JSON.stringify([orgName, accountMode, data.info.account_mode ?? '', data.accounts]);
  return <CashSetupForm key={savedKey} />;
}

function CashSetupForm() {
  const { data, orgName, bookTitle, accountMode, actions } = useApp();
  const savedRows = rowsFromAccounts(data.accounts);
  const [org, setOrg] = useState(orgName || bookTitle || '');
  const [mode, setMode] = useState(accountMode);
  const [rows, setRows] = useState(() => (savedRows.length ? savedRows : [newRow(defaultAccountName(orgName || bookTitle))]));
  // Nama akun baru mengikuti "Iuran " + nama kas sampai diedit sendiri.
  const [autoKey, setAutoKey] = useState(() => (savedRows.length ? null : rows[0]?.key ?? null));
  const [modeError, setModeError] = useState('');
  const [saving, setSaving] = useState(false);

  const simple = mode === 'simple';
  const primary = simple ? pickPrimaryRow(rows) : null;
  const shown = simple ? (primary ? [primary] : []) : rows;
  const error = validateAccountRows(rows, mode);
  const dirty =
    org.trim() !== orgName || mode !== (data.info.account_mode ?? '') || JSON.stringify(rows) !== JSON.stringify(savedRows);
  const canSave = dirty && !error && !saving;

  function changeOrg(value) {
    setOrg(value);
    setRows((cur) => cur.map((r) => (r.key === autoKey ? { ...r, name: defaultAccountName(value) } : r)));
  }

  function patchRow(key, patch) {
    setModeError('');
    if (key === autoKey && 'name' in patch) setAutoKey(null);
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function moveRow(index, direction) {
    setRows((cur) => {
      const next = [...cur];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      return next;
    });
  }

  function toggleMode() {
    setModeError('');
    if (simple) {
      setMode('multi');
      return;
    }
    if (!canSwitchToSimple(rows)) {
      setModeError('Mode Sederhana hanya punya satu akun aktif. Nonaktifkan akun lain dulu, lalu tukar mode lagi.');
      return;
    }
    let next = collapseToSimple(rows);
    if (!pickPrimaryRow(next)) {
      const row = newRow(defaultAccountName(org));
      setAutoKey(row.key);
      next = [...next, row];
    }
    setRows(next);
    setMode('simple');
  }

  async function submit(e) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    await actions.saveCashSetup({ orgName: org, mode, rows });
    setSaving(false);
  }

  return (
    <section className="card" aria-labelledby="set-cash">
      <div className="card-head">
        <h2 id="set-cash">Kas & akun kas</h2>
      </div>
      <form onSubmit={submit}>
        <Field label="Nama kas / organisasi" hint="Tampil di bagian atas dan laporan, mis. “Kas RT 05” atau “Kelas XII IPA 2”.">
          <input type="text" value={org} onChange={(e) => changeOrg(e.target.value)} />
        </Field>

        <div className="mode-bar">
          <p className="small" style={{ margin: 0 }}>
            Mode: <strong>{MODE_LABELS[mode]}</strong>
            <span className="muted"> — {MODE_HINTS[mode]}</span>
          </p>
          <button type="button" className="btn" onClick={toggleMode}>Tukar mode</button>
        </div>
        {modeError && <div className="notice warn small" role="alert">{modeError}</div>}

        <div className="field-label">Akun kas</div>
        <div className={`acct-grid ${simple ? 'simple' : 'multi'}`}>
          <div className="acct-head" aria-hidden="true">
            <span>Nama akun</span>
            <span>Saldo awal</span>
            <span>Catatan (opsional)</span>
            {!simple && <span />}
          </div>
          {shown.map((row, i) => (
            <AccountRow
              key={row.key}
              row={row}
              multi={!simple}
              index={i}
              count={shown.length}
              onPatch={(patch) => patchRow(row.key, patch)}
              onMove={(direction) => moveRow(i, direction)}
              onRemove={() => setRows((cur) => cur.filter((r) => r.key !== row.key))}
            />
          ))}
        </div>
        {!simple && (
          <button type="button" className="btn small" onClick={() => setRows((cur) => [...cur, newRow()])}>+ Tambah akun</button>
        )}
        {dirty && error && <p className="hint bad" role="alert">{error}</p>}

        <div className="form-actions">
          <button type="submit" className="btn primary" disabled={!canSave}>{saving ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
      </form>
    </section>
  );
}

/** Satu baris akun kas: [nama] [saldo awal] [catatan] (+ urutan, aktif, hapus baris di mode Multi). */
function AccountRow({ row, multi, index, count, onPatch, onMove, onRemove }) {
  const n = multi ? ` ${index + 1}` : '';
  return (
    <div className="acct-row">
      <input
        type="text"
        aria-label={`Nama akun${n}`}
        placeholder="Nama akun"
        value={row.name}
        onChange={(e) => onPatch({ name: e.target.value })}
      />
      <MoneyInput
        aria-label={`Saldo awal${n}`}
        placeholder="0"
        value={row.openingBalance}
        onChange={(v) => onPatch({ openingBalance: v })}
      />
      <input
        type="text"
        aria-label={`Catatan${n}`}
        placeholder="Catatan (opsional)"
        value={row.note}
        onChange={(e) => onPatch({ note: e.target.value })}
      />
      {multi && (
        <div className="acct-tools">
          <button type="button" className="btn small ghost" aria-label={`Naikkan akun ${index + 1}`} disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
          <button type="button" className="btn small ghost" aria-label={`Turunkan akun ${index + 1}`} disabled={index === count - 1} onClick={() => onMove(1)}>↓</button>
          <label className="inline-check">
            <input type="checkbox" aria-label={`Akun ${index + 1} aktif`} checked={row.active} onChange={(e) => onPatch({ active: e.target.checked })} />
            Aktif
          </label>
          {!row.id && (
            <button type="button" className="btn small ghost" aria-label={`Hapus baris akun ${index + 1}`} onClick={onRemove}>×</button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Periode */

function PeriodsSection() {
  const { data, actions, accountMode } = useApp();
  const simple = accountMode === 'simple';
  const [modal, setModal] = useState(null);
  const periods = [...data.periods].sort((a, b) => b.startMonth.localeCompare(a.startMonth));

  return (
    <section className="card" aria-labelledby="set-periods">
      <div className="card-head">
        <h2 id="set-periods">{simple ? 'Periode & iuran' : 'Periode & alokasi iuran'}</h2>
        <button
          type="button"
          className="btn primary small"
          disabled={data.accounts.length === 0}
          title={data.accounts.length === 0 ? 'Simpan akun kas di atas dulu.' : undefined}
          onClick={() => setModal({})}
        >
          + Tambah periode
        </button>
      </div>
      <p className="muted small">
        {simple
          ? 'Satu periode = 12 bulan berturut-turut yang bisa dimulai dari bulan mana pun. Tiap periode punya besaran iuran per anggota per bulan.'
          : 'Satu periode = 12 bulan berturut-turut yang bisa dimulai dari bulan mana pun. Tiap periode punya besaran iuran dan pembagiannya ke akun kas; total alokasi tidak boleh melebihi iuran.'}
      </p>
      {periods.length === 0 ? (
        <p className="muted">Belum ada periode.</p>
      ) : (
        <div className="table-scroll">
          <table className="simple">
            <thead>
              <tr>
                <th>Periode</th>
                <th className="num">Iuran / bulan</th>
                {!simple && <th>Alokasi</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => {
                const s = periodAllocationSummary(data, p);
                const used = data.payments.some((x) => x.periodId === p.id);
                return (
                  <tr key={p.id}>
                    <td>
                      {periodTitle(p)}
                      {p.name && <div className="muted small">{periodRangeLabel(p.startMonth)}</div>}
                    </td>
                    <td className="num">{formatRupiah(p.fee)}</td>
                    {!simple && (
                      <td className="small">
                        {s.allocations.map((a) => (
                          <div key={a.accountId}>{data.accounts.find((x) => x.id === a.accountId)?.name ?? '?'}: {formatNumber(a.amount)}</div>
                        ))}
                        {s.remainder > 0 && <div className="muted">Umum: {formatNumber(s.remainder)}</div>}
                      </td>
                    )}
                    <td>
                      <div className="row-actions">
                        <button type="button" className="btn small" onClick={() => setModal({ period: p })}>Ubah</button>
                        <ConfirmButton disabled={used} onConfirm={() => actions.deletePeriod(p)} confirmLabel="Hapus?">
                          Hapus
                        </ConfirmButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {modal && <PeriodModal period={modal.period} onClose={() => setModal(null)} />}
    </section>
  );
}

function PeriodModal({ period, onClose }) {
  const { data, actions, nowMonth, accountMode } = useApp();
  const simple = accountMode === 'simple';
  const editing = Boolean(period);
  const latest = [...data.periods].sort((a, b) => b.startMonth.localeCompare(a.startMonth))[0];
  const hasPayments = editing && data.payments.some((p) => p.periodId === period.id);

  // Periode baru menyalin iuran & alokasi periode terakhir supaya tinggal disesuaikan.
  const source = editing ? period : latest;
  const sourceAlloc = new Map(
    data.allocations.filter((a) => a.periodId === source?.id).map((a) => [a.accountId, a.amount]),
  );
  const accounts = data.accounts.filter((a) => a.active || (editing && (sourceAlloc.get(a.id) ?? 0) > 0));

  const [name, setName] = useState(period?.name ?? '');
  const [startMonth, setStartMonth] = useState(period?.startMonth ?? (latest ? addMonths(latest.startMonth, 12) : nowMonth));
  const [fee, setFee] = useState(source?.fee ?? '');
  const [note, setNote] = useState(period?.note ?? '');
  const [amounts, setAmounts] = useState(() => Object.fromEntries(accounts.map((a) => [a.id, sourceAlloc.get(a.id) ?? ''])));
  const [saving, setSaving] = useState(false);

  const feeValue = Number(fee) || 0;
  // Mode Sederhana: seluruh iuran ke akun tunggal; akun lain 0 supaya alokasi lama (dari mode Multi) tidak ikut terhitung.
  const primary = primaryAccount(data.accounts);
  const allocations = simple
    ? data.accounts.map((a) => ({ accountId: a.id, amount: a.id === primary?.id ? feeValue : 0 }))
    : accounts.map((a) => ({ accountId: a.id, amount: Number(amounts[a.id]) || 0 }));
  const check = validateAllocations(feeValue, allocations);
  const valid = feeValue > 0 && check.ok;

  async function submit(e) {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    const ok = await actions.savePeriod({
      period: { ...(period ?? {}), name: name.trim(), startMonth, fee: feeValue, note: note.trim(), deleted: false },
      allocations,
    });
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Modal title={editing ? 'Ubah periode' : 'Tambah periode'} onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="row">
          <Field label="Nama periode (opsional)">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Tahun Ajaran 2026/2027" autoFocus />
          </Field>
          <Field
            label="Bulan mulai"
            hint={hasPayments ? 'Tidak bisa diubah karena sudah ada iuran tercatat.' : `Periode berjalan 12 bulan: ${periodRangeLabel(startMonth)}`}
          >
            <MonthPicker value={startMonth} onChange={setStartMonth} disabled={hasPayments} aria-label="Bulan mulai" />
          </Field>
        </div>

        <Field label="Iuran per anggota per bulan">
          <MoneyInput value={fee} onChange={setFee} />
        </Field>

        {!simple && (
          <>
            <div className="field-label">Alokasi per akun kas</div>
            {accounts.length === 0 && (
              <p className="muted small">Belum ada akun kas aktif. Seluruh iuran akan masuk ke “Umum”.</p>
            )}
            {accounts.map((a) => (
              <div className="alloc-row" key={a.id}>
                <label htmlFor={`alloc-${a.id}`}>{a.name}{!a.active && <span className="tag">nonaktif</span>}</label>
                <MoneyInput
                  id={`alloc-${a.id}`}
                  value={amounts[a.id]}
                  onChange={(v) => setAmounts((cur) => ({ ...cur, [a.id]: v }))}
                />
              </div>
            ))}
            <div className={`alloc-sum${check.ok ? '' : ' bad'}`} role="status">
              <span>Total alokasi: <strong>{formatRupiah(sumAmounts(allocations))}</strong> dari {formatRupiah(feeValue)}</span>
              <span>
                {check.ok
                  ? `Sisa ke Umum: ${formatRupiah(check.remaining)}`
                  : `${check.error} Lebih ${formatRupiah(-check.remaining)}.`}
              </span>
            </div>
          </>
        )}

        <Field label="Catatan (opsional)">
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Batal</button>
          <button type="submit" className="btn primary" disabled={!valid || saving}>
            {saving ? 'Menyimpan…' : 'Simpan periode'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Fitur tambahan */

const FEATURE_NOTES = {
  partial: 'Sheet Patungan tidak lengkap (mungkin terhapus di Google Sheets). Klik Lengkapi untuk membuat ulang yang hilang.',
  mismatched:
    'Ada sheet bernama “Patungan” atau “Setoran Patungan” yang strukturnya berbeda. Ganti nama sheet tersebut di Google Sheets, lalu aktifkan lagi.',
};

function FeaturesSection() {
  const { data, actions } = useApp();
  const state = data.features?.collections ?? 'off';
  const [saving, setSaving] = useState(false);

  async function enable() {
    setSaving(true);
    await actions.enableCollections();
    setSaving(false);
  }

  return (
    <section className="card" aria-labelledby="set-features">
      <div className="card-head">
        <h2 id="set-features">Fitur tambahan</h2>
      </div>
      <div className="feature-row">
        <div className="grow">
          <strong>Patungan</strong>
          {state === 'on' && <span className="tag in">aktif</span>}
          <p className="muted small" style={{ margin: '0.2rem 0 0' }}>
            Iuran insidentil di luar iuran rutin, mis. patungan perbaikan jalan (besaran ditentukan) atau menjenguk
            anggota yang sakit (sukarela). Tiap patungan punya kantong sendiri, terpisah dari kas utama.
          </p>
          {state === 'off' && (
            <p className="muted small" style={{ margin: '0.2rem 0 0' }}>
              Mengaktifkan akan menambah sheet <code>Patungan</code> dan <code>Setoran Patungan</code>; sheet lain tidak diubah.
            </p>
          )}
          {FEATURE_NOTES[state] && <div className="notice warn small" role="alert">{FEATURE_NOTES[state]}</div>}
        </div>
        {state !== 'on' && (
          <button type="button" className="btn primary small" onClick={enable} disabled={saving}>
            {saving ? 'Menyiapkan…' : state === 'partial' ? 'Lengkapi' : 'Aktifkan'}
          </button>
        )}
        {state === 'on' && <a className="btn small" href="#/patungan">Buka Patungan</a>}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ Spreadsheet */

function SpreadsheetSection() {
  const { sheetUrl, sheetId, actions, reload, user } = useApp();
  const toast = useToast();

  async function copyLink() {
    const link = `${window.location.origin}${window.location.pathname}?sheet=${sheetId}`;
    try {
      await navigator.clipboard.writeText(link);
      toast('Tautan disalin');
    } catch {
      window.prompt('Salin tautan ini:', link);
    }
  }

  return (
    <section className="card" aria-labelledby="set-sheet">
      <div className="card-head">
        <h2 id="set-sheet">Spreadsheet & akses</h2>
      </div>
      <div className="toolbar" style={{ marginBottom: '0.75rem' }}>
        <a className="btn" href={sheetUrl} target="_blank" rel="noopener noreferrer">Buka di Google Sheets ↗</a>
        <button type="button" className="btn" onClick={copyLink}>Salin tautan untuk anggota tim</button>
        <button type="button" className="btn" onClick={reload}>Muat ulang data</button>
        <button type="button" className="btn" onClick={actions.openSetup}>Kelola buku…</button>
      </div>
      <DriveNotice />
      <p className="muted small">
        Masuk sebagai <strong>{user.email}</strong>. Siapa pun yang diberi akses lewat tombol <em>Share</em> di Google Sheets
        (Editor untuk mencatat, Viewer untuk melihat) dapat masuk ke aplikasi ini dengan akun Google-nya. Mencabut akses di Google
        Sheets otomatis mencabut akses di sini.
      </p>
    </section>
  );
}
