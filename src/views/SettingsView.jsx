import { useState } from 'react';
import { ConfirmButton, Field, Modal, MoneyInput, MonthPicker } from '../components/ui.jsx';
import { sumAmounts, validateAllocations } from '../lib/allocation.js';
import { formatNumber, formatRupiah } from '../lib/money.js';
import { addMonths, periodRangeLabel } from '../lib/months.js';
import { periodAllocationSummary, periodTitle } from '../lib/selectors.js';
import { useToast } from '../components/ui.jsx';
import { DriveNotice } from '../components/DriveNotice.jsx';
import { useApp } from '../state/AppContext.jsx';

export default function SettingsView() {
  return (
    <>
      <div className="page-head">
        <h1>Pengaturan</h1>
      </div>
      <AccountsSection />
      <PeriodsSection />
      <SpreadsheetSection />
    </>
  );
}

/* ------------------------------------------------------------------ Akun kas */

function AccountsSection() {
  const { data, actions } = useApp();
  const [modal, setModal] = useState(null);

  return (
    <section className="card" aria-labelledby="set-accounts">
      <div className="card-head">
        <h2 id="set-accounts">Akun kas</h2>
        <button type="button" className="btn primary small" onClick={() => setModal({})}>+ Tambah akun</button>
      </div>
      <p className="muted small">
        Akun kas adalah “kantong” tempat iuran dialokasikan, mis. Kas Kelas, Dana Darurat, Tabungan Wisata. Urutan menentukan
        prioritas: bila anggota membayar sebagian, akun paling atas terisi lebih dulu.
      </p>
      {data.accounts.length === 0 ? (
        <p className="muted">Belum ada akun kas.</p>
      ) : (
        <div className="table-scroll">
          <table className="simple">
            <thead>
              <tr>
                <th>Urutan</th>
                <th>Nama</th>
                <th className="num">Saldo awal</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((a, i) => (
                <tr key={a.id} className={a.active ? '' : 'muted-row'}>
                  <td className="nowrap">
                    <button type="button" className="btn small ghost" aria-label={`Naikkan ${a.name}`} disabled={i === 0} onClick={() => actions.moveAccount(a.id, -1)}>↑</button>
                    <button type="button" className="btn small ghost" aria-label={`Turunkan ${a.name}`} disabled={i === data.accounts.length - 1} onClick={() => actions.moveAccount(a.id, 1)}>↓</button>
                  </td>
                  <td>{a.name}{!a.active && <span className="tag">nonaktif</span>}{a.note && <div className="muted small">{a.note}</div>}</td>
                  <td className="num">{formatNumber(a.openingBalance)}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="btn small" onClick={() => setModal({ account: a })}>Ubah</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal && <AccountModal account={modal.account} onClose={() => setModal(null)} />}
    </section>
  );
}

function AccountModal({ account, onClose }) {
  const { actions } = useApp();
  const [name, setName] = useState(account?.name ?? '');
  const [opening, setOpening] = useState(account?.openingBalance ?? 0);
  const [active, setActive] = useState(account?.active ?? true);
  const [note, setNote] = useState(account?.note ?? '');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    const ok = await actions.saveAccount({
      ...(account ?? {}),
      name,
      openingBalance: opening === '' ? 0 : opening,
      active,
      note: note.trim(),
    });
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Modal title={account ? 'Ubah akun kas' : 'Tambah akun kas'} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Nama akun">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Dana Darurat" autoFocus required />
        </Field>
        <Field label="Saldo awal" hint="Isi bila akun sudah punya saldo sebelum dicatat di aplikasi ini.">
          <MoneyInput value={opening} onChange={setOpening} />
        </Field>
        <Field label="Catatan (opsional)">
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <label className="inline-check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Akun aktif (bisa dipilih untuk transaksi baru)
        </label>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Batal</button>
          <button type="submit" className="btn primary" disabled={!name.trim() || saving}>
            {saving ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Periode */

function PeriodsSection() {
  const { data, actions } = useApp();
  const [modal, setModal] = useState(null);
  const periods = [...data.periods].sort((a, b) => b.startMonth.localeCompare(a.startMonth));

  return (
    <section className="card" aria-labelledby="set-periods">
      <div className="card-head">
        <h2 id="set-periods">Periode & alokasi iuran</h2>
        <button type="button" className="btn primary small" onClick={() => setModal({})}>+ Tambah periode</button>
      </div>
      <p className="muted small">
        Satu periode = 12 bulan berturut-turut yang bisa dimulai dari bulan mana pun. Tiap periode punya besaran iuran dan
        pembagiannya ke akun kas; total alokasi tidak boleh melebihi iuran.
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
                <th>Alokasi</th>
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
                    <td className="small">
                      {s.allocations.map((a) => (
                        <div key={a.accountId}>{data.accounts.find((x) => x.id === a.accountId)?.name ?? '?'}: {formatNumber(a.amount)}</div>
                      ))}
                      {s.remainder > 0 && <div className="muted">Umum: {formatNumber(s.remainder)}</div>}
                    </td>
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
  const { data, actions, nowMonth } = useApp();
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

  const allocations = accounts.map((a) => ({ accountId: a.id, amount: Number(amounts[a.id]) || 0 }));
  const feeValue = Number(fee) || 0;
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

/* ------------------------------------------------------------------ Spreadsheet */

function SpreadsheetSection() {
  const { sheetUrl, sheetId, orgName, actions, reload, user } = useApp();
  const toast = useToast();
  const [org, setOrg] = useState(orgName);

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
        <h2 id="set-sheet">Buku aktif, spreadsheet & akses</h2>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          actions.setOrgName(org);
        }}
        style={{ marginBottom: '1rem' }}
      >
        <Field label="Nama kas / organisasi" hint="Tampil di bagian atas dan laporan, mis. “Kas RT 05” atau “Kelas XII IPA 2”.">
          <div className="row" style={{ gap: '0.5rem' }}>
            <input type="text" value={org} onChange={(e) => setOrg(e.target.value)} />
            <button type="submit" className="btn" style={{ flex: 'none' }} disabled={org.trim() === orgName}>Simpan</button>
          </div>
        </Field>
      </form>

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
