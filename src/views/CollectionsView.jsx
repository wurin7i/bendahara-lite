import { useMemo, useState } from 'react';
import { TransactionModal } from '../components/TransactionModal.jsx';
import { ConfirmButton, Empty, Field, Modal, MoneyInput, Stat } from '../components/ui.jsx';
import { UNALLOCATED_ID } from '../lib/allocation.js';
import { primaryAccount } from '../lib/accountMode.js';
import {
  KIND_FIXED, KIND_LABELS, KIND_VOLUNTARY, buildCollectionTable, isFixed, sortCollections, validateCollection,
} from '../lib/collections.js';
import { formatNumber, formatRupiah } from '../lib/money.js';
import { formatDate, isISODate, todayISO } from '../lib/months.js';
import { useApp } from '../state/AppContext.jsx';

const STATUS = {
  paid: { label: 'Lunas', tone: 'paid' },
  partial: { label: 'Kurang', tone: 'partial' },
  due: { label: 'Belum (lewat batas)', tone: 'due' },
  pending: { label: 'Belum', tone: 'upcoming' },
  gave: { label: 'Menyetor', tone: 'paid' },
  none: { label: '–', tone: 'upcoming' },
  na: { label: 'Tidak ikut', tone: 'na' },
};

/** Terpakai = pengeluaran nyata dari kantong (pindah saldo tidak dihitung). */
function useSpent(accountId) {
  const { derived } = useApp();
  return derived.lines.filter((l) => l.accountId === accountId && l.source === 'manual').reduce((s, l) => s + l.out, 0);
}

export default function CollectionsView() {
  const { data, collectionsEnabled } = useApp();
  const [selectedId, setSelectedId] = useState(null);
  const [editing, setEditing] = useState(null); // { collection? }

  if (!collectionsEnabled) {
    return (
      <Empty title="Fitur Patungan belum aktif">
        <p>Aktifkan di <a href="#/pengaturan">Pengaturan → Fitur tambahan</a> bila perlu mencatat iuran insidentil.</p>
      </Empty>
    );
  }

  const selected = data.collections.find((c) => c.id === selectedId);
  return (
    <>
      {selected ? (
        <CollectionDetail collection={selected} onBack={() => setSelectedId(null)} onEdit={() => setEditing({ collection: selected })} />
      ) : (
        <CollectionList onOpen={setSelectedId} onNew={() => setEditing({})} />
      )}
      {editing && (
        <CollectionModal collection={editing.collection} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ daftar */

function CollectionList({ onOpen, onNew }) {
  const { data } = useApp();
  const list = sortCollections(data.collections);
  const open = list.filter((c) => !c.closed).length;

  return (
    <>
      <div className="page-head">
        <h1>
          Patungan
          <span className="sub">{list.length ? `${open} berjalan · ${list.length - open} ditutup` : 'Iuran insidentil di luar iuran rutin'}</span>
        </h1>
        <div className="toolbar">
          <button type="button" className="btn primary" onClick={onNew}>+ Patungan baru</button>
        </div>
      </div>

      {list.length === 0 ? (
        <Empty title="Belum ada patungan">
          <p>
            Buat patungan untuk kebutuhan insidentil, mis. perbaikan jalan (besaran ditentukan per anggota) atau menjenguk
            anggota yang sakit (sukarela). Uangnya masuk ke kantong patungan sendiri, terpisah dari kas utama.
          </p>
        </Empty>
      ) : (
        <div className="ptg-grid">
          {list.map((c) => <CollectionCard key={c.id} collection={c} onOpen={() => onOpen(c.id)} />)}
        </div>
      )}
    </>
  );
}

function CollectionCard({ collection, onOpen }) {
  const { data, derived } = useApp();
  const table = buildCollectionTable({ collection, members: data.members, contributions: data.contributions, today: todayISO() });
  const balance = derived.balances.get(collection.accountId) ?? 0;
  const fixed = isFixed(collection);
  return (
    <article className={`card ptg-card${collection.closed ? ' closed' : ''}`}>
      <h2>
        <button type="button" className="link" onClick={onOpen}>{collection.name}</button>
        {collection.closed && <span className="tag">ditutup</span>}
      </h2>
      <p className="muted small">
        {fixed ? `${formatRupiah(collection.amount)} per anggota` : KIND_LABELS[KIND_VOLUNTARY]} · {formatDate(collection.date)}
        {collection.dueDate && ` · batas ${formatDate(collection.dueDate)}`}
      </p>
      <Progress table={table} />
      <p className="small" style={{ margin: 0 }}>
        Terkumpul <strong>{formatRupiah(table.totals.collected)}</strong>
        {table.target > 0 && <> dari {formatRupiah(table.target)}</>}
        {fixed ? ` · ${table.totals.paidCount}/${table.totals.participants} lunas` : ` · ${table.totals.contributors} penyumbang`}
      </p>
      <p className="muted small" style={{ margin: 0 }}>Saldo kantong {formatRupiah(balance)}</p>
    </article>
  );
}

function Progress({ table }) {
  if (table.progress === null) return null;
  const pct = Math.round(table.progress * 100);
  return (
    <div className="progress" role="progressbar" aria-label="Kemajuan terkumpul" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ------------------------------------------------------------------ detail */

function CollectionDetail({ collection, onBack, onEdit }) {
  const { data, derived, actions, accountMode } = useApp();
  const [target, setTarget] = useState(null); // anggota untuk dialog setoran
  const [transfer, setTransfer] = useState(null); // nilai awal pindah saldo
  const today = todayISO();
  const table = useMemo(
    () => buildCollectionTable({ collection, members: data.members, contributions: data.contributions, today }),
    [collection, data.members, data.contributions, today],
  );
  const fixed = isFixed(collection);
  const balance = derived.balances.get(collection.accountId) ?? 0;
  const spent = useSpent(collection.accountId);
  const used = table.contributions.length > 0 || data.transactions.some((t) => t.accountId === collection.accountId);

  // Tujuan sisa: kas utama (mode Sederhana) atau Umum (mode Multi); bisa diganti di dialog.
  const mainId = accountMode === 'simple' ? primaryAccount(data.accounts)?.id : UNALLOCATED_ID;
  const moveRest = () =>
    setTransfer({ title: 'Pindahkan sisa patungan', initial: { accountId: collection.accountId, toId: mainId, amount: balance, description: `Sisa ${collection.name}` } });
  const coverShortage = () =>
    setTransfer({ title: 'Tutup kekurangan kantong', initial: { accountId: mainId, toId: collection.accountId, amount: -balance, description: `Menutup kekurangan ${collection.name}` } });

  return (
    <>
      <p className="no-print" style={{ margin: '0 0 0.5rem' }}>
        <button type="button" className="btn small ghost" onClick={onBack}>← Semua patungan</button>
      </p>
      <div className="page-head">
        <h1>
          {collection.name}
          {collection.closed && <span className="tag">ditutup</span>}
          <span className="sub">
            {KIND_LABELS[collection.kind] ?? KIND_LABELS[KIND_FIXED]} · {formatDate(collection.date)}
            {collection.dueDate && ` · batas ${formatDate(collection.dueDate)}`}
            {collection.note && ` · ${collection.note}`}
          </span>
        </h1>
        <div className="toolbar no-print">
          <button type="button" className="btn" onClick={onEdit}>Ubah</button>
          {balance > 0 && <button type="button" className="btn" onClick={moveRest}>Pindahkan sisa</button>}
          <button type="button" className="btn" onClick={() => actions.setCollectionClosed(collection, !collection.closed)}>
            {collection.closed ? 'Buka lagi' : 'Tutup patungan'}
          </button>
          {!used && (
            <ConfirmButton onConfirm={() => actions.deleteCollection(collection).then((ok) => ok && onBack())} confirmLabel="Hapus?">
              Hapus
            </ConfirmButton>
          )}
        </div>
      </div>

      {collection.closed && (
        <div className="notice small">
          Patungan ditutup dan tidak menerima setoran baru.
          {balance > 0 && <> Masih ada sisa <strong>{formatRupiah(balance)}</strong> di kantong ini; pindahkan lewat <em>Pindahkan sisa</em>.</>}
        </div>
      )}
      {balance < 0 && (
        <div className="notice warn small">
          Saldo kantong minus {formatRupiah(-balance)} (pengeluaran melebihi setoran).{' '}
          <button type="button" className="btn small" onClick={coverShortage}>Tutup dari kas utama</button>
        </div>
      )}

      <div className="stats">
        {fixed ? (
          <>
            <Stat label="Besaran per anggota" value={formatRupiah(collection.amount)} sub={`${table.totals.participants} peserta`} />
            <Stat
              label="Terkumpul"
              value={formatRupiah(table.totals.collected)}
              sub={`Target ${formatRupiah(table.target)}`}
              tone="good"
            />
            <Stat
              label="Belum disetor"
              value={formatRupiah(table.totals.outstanding)}
              sub={`${table.totals.paidCount} dari ${table.totals.participants} peserta lunas`}
              tone={table.totals.outstanding && table.overdue ? 'bad' : undefined}
            />
          </>
        ) : (
          <>
            <Stat
              label="Terkumpul"
              value={formatRupiah(table.totals.collected)}
              sub={table.target ? `Target ${formatRupiah(table.target)}` : 'Tanpa target'}
              tone="good"
            />
            <Stat label="Penyumbang" value={`${table.totals.contributors}`} sub="anggota" />
          </>
        )}
        <Stat label="Saldo kantong" value={formatRupiah(balance)} sub={`Terpakai ${formatRupiah(spent)}`} />
      </div>
      <Progress table={table} />

      <div className="table-scroll">
        <table className="simple ptg-table">
          <thead>
            <tr>
              <th>Anggota</th>
              {fixed && <th className="num">Besaran</th>}
              <th className="num">Disetor</th>
              <th>Status</th>
              <th className="no-print" />
            </tr>
          </thead>
          <tbody>
            {table.rows.length === 0 && (
              <tr><td colSpan={fixed ? 5 : 4} className="muted" style={{ textAlign: 'center', padding: '1.5rem' }}>Belum ada anggota.</td></tr>
            )}
            {table.rows.map((row) => {
              const status = STATUS[row.status];
              const label = row.status === 'partial' ? `Kurang ${formatNumber(row.shortfall)}` : status.label;
              const canRecord = !collection.closed || row.contributions.length > 0;
              return (
                <tr key={row.member.id} className={row.status === 'na' ? 'muted-row' : ''}>
                  <td>{row.member.name}{!row.member.active && <span className="tag">nonaktif</span>}</td>
                  {fixed && <td className="num">{row.participant ? formatNumber(row.due) : '–'}</td>}
                  <td className="num">{row.paid ? formatNumber(row.paid) : '–'}</td>
                  <td>
                    <span className={`pill ${status.tone}`}>{label}</span>
                    {row.surplus > 0 && <span className="tag">lebih {formatNumber(row.surplus)}</span>}
                  </td>
                  <td className="no-print">
                    {canRecord && (
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn small"
                          aria-label={`${collection.closed ? 'Riwayat setoran' : 'Catat setoran'} ${row.member.name}`}
                          onClick={() => setTarget(row.member)}
                        >
                          {collection.closed ? 'Riwayat' : 'Catat'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th>Total</th>
              {fixed && <td className="num">{formatNumber(table.totals.expected)}</td>}
              <td className="num">{formatNumber(table.totals.collected)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="hint">
        Setoran masuk ke kantong “{collection.name}”, terpisah dari kas utama. Belanja untuk patungan ini dicatat di Buku Kas
        (− Pengeluaran) dengan memilih kantong tersebut; sisanya dipindahkan lewat <em>Pindahkan sisa</em>.
      </p>

      {target && <ContributionDialog collection={collection} member={target} onClose={() => setTarget(null)} />}
      {transfer && <TransactionModal mode="transfer" {...transfer} onClose={() => setTransfer(null)} />}
    </>
  );
}

/* ------------------------------------------------------------------ dialog setoran */

function ContributionDialog({ collection, member, onClose }) {
  const { data, actions } = useApp();
  const fixed = isFixed(collection);
  const row = buildCollectionTable({ collection, members: [member], contributions: data.contributions, today: todayISO() }).rows[0];
  const list = row?.contributions ?? [];
  const paid = row?.paid ?? 0;
  const remaining = row?.participant ? row.shortfall : 0;

  const [amount, setAmount] = useState(remaining || '');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const valid = Number.isSafeInteger(amount) && amount > 0 && isISODate(date);

  async function submit(e) {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    const ok = await actions.addContribution({ collection, memberId: member.id, amount, date, note });
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Modal title={`${member.name} · ${collection.name}`} onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>
        {fixed && row?.participant ? `Besaran ${formatRupiah(collection.amount)} · ` : fixed ? 'Tidak termasuk peserta · ' : 'Sukarela · '}
        disetor <strong>{formatRupiah(paid)}</strong>
        {remaining > 0 && <> · kurang <strong>{formatRupiah(remaining)}</strong></>}
      </p>

      {list.length > 0 && (
        <ul className="pay-list" aria-label="Setoran tercatat">
          {list.map((c) => (
            <li key={c.id}>
              <div className="grow">
                <div><strong>{formatRupiah(c.amount)}</strong> <span className="muted small">· {formatDate(c.date)}</span></div>
                {(c.note || c.createdBy) && (
                  <div className="muted small">{[c.note, c.createdBy && `dicatat ${c.createdBy}`].filter(Boolean).join(' · ')}</div>
                )}
              </div>
              <ConfirmButton onConfirm={() => actions.voidContribution(c)} confirmLabel="Ya, batalkan">Batalkan</ConfirmButton>
            </li>
          ))}
        </ul>
      )}

      {collection.closed ? (
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Tutup</button>
        </div>
      ) : (
        <form onSubmit={submit}>
          <h3 style={{ marginBottom: '0.6rem' }}>Catat setoran</h3>
          <div className="row">
            <Field label="Jumlah">
              <MoneyInput value={amount} onChange={setAmount} autoFocus aria-label="Jumlah" />
            </Field>
            <Field label="Tanggal setor">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
          </div>
          <Field label="Catatan (opsional)">
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. titip lewat Pak RT" />
          </Field>
          {fixed && row?.participant && valid && amount > remaining && (
            <div className="notice warn small">Jumlah melebihi kekurangannya; kelebihannya tetap masuk ke kantong patungan.</div>
          )}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>Tutup</button>
            <button type="submit" className="btn primary" disabled={!valid || saving}>
              {saving ? 'Menyimpan…' : 'Simpan setoran'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ dialog patungan */

function CollectionModal({ collection, onClose }) {
  const { data, actions } = useApp();
  const editing = Boolean(collection);
  const [name, setName] = useState(collection?.name ?? '');
  const [kind, setKind] = useState(collection?.kind ?? KIND_FIXED);
  const [amount, setAmount] = useState(collection?.amount || '');
  const [target, setTarget] = useState(collection?.target || '');
  const [date, setDate] = useState(collection?.date ?? todayISO());
  const [dueDate, setDueDate] = useState(collection?.dueDate ?? '');
  const [excluded, setExcluded] = useState(collection?.excluded ?? {});
  const [note, setNote] = useState(collection?.note ?? '');
  const [saving, setSaving] = useState(false);

  const fixed = kind === KIND_FIXED;
  const active = [...data.members].filter((m) => m.active).sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }));
  const joining = active.filter((m) => !excluded[m.id]).length;
  const draft = {
    id: collection?.id, name, kind, date, dueDate, excluded, note,
    amount: fixed ? (amount === '' ? 0 : amount) : 0,
    target: fixed ? 0 : (target === '' ? 0 : target),
  };
  const error = validateCollection(draft, data.collections);
  const showError = error && (name.trim() || editing);

  function toggleMember(id, joins) {
    setExcluded((cur) => {
      const next = { ...cur };
      if (joins) delete next[id];
      else next[id] = true;
      return next;
    });
  }

  async function submit(e) {
    e.preventDefault();
    if (error || saving) return;
    setSaving(true);
    const ok = await actions.saveCollection(draft);
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Modal title={editing ? 'Ubah patungan' : 'Patungan baru'} onClose={onClose} wide>
      <form onSubmit={submit}>
        <Field label="Nama patungan" hint="Juga menjadi nama kantongnya, mis. “Perbaikan jalan” atau “Jenguk Nina”.">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </Field>

        <div className="field-label" id="ptg-kind">Jenis</div>
        <div className="seg" role="radiogroup" aria-labelledby="ptg-kind">
          {[KIND_FIXED, KIND_VOLUNTARY].map((k) => (
            <label key={k}>
              <input type="radio" name="ptg-kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
              {KIND_LABELS[k]}
            </label>
          ))}
        </div>

        {fixed ? (
          <Field label="Besaran per anggota">
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
        ) : (
          <Field label="Target dana (opsional)" hint="Hanya untuk menampilkan kemajuan; tidak ada kewajiban per anggota.">
            <MoneyInput value={target} onChange={setTarget} />
          </Field>
        )}

        <div className="row">
          <Field label="Tanggal">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Batas waktu (opsional)">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>

        {fixed && (
          <details className="ptg-members">
            <summary>Peserta: {joining} dari {active.length} anggota aktif ikut</summary>
            <p className="muted small">Hapus centang anggota yang tidak ikut patungan ini.</p>
            {active.map((m) => (
              <label key={m.id} className="inline-check">
                <input type="checkbox" checked={!excluded[m.id]} onChange={(e) => toggleMember(m.id, e.target.checked)} />
                {m.name}
              </label>
            ))}
          </details>
        )}

        <Field label="Catatan (opsional)">
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        {showError && <p className="hint bad" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Batal</button>
          <button type="submit" className="btn primary" disabled={Boolean(error) || saving}>
            {saving ? 'Menyimpan…' : 'Simpan patungan'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
