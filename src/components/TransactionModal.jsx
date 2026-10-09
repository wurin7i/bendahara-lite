import { useState } from 'react';
import { UNALLOCATED_ID, UNALLOCATED_NAME } from '../lib/allocation.js';
import { formatRupiah } from '../lib/money.js';
import { isISODate, todayISO } from '../lib/months.js';
import { useApp } from '../state/AppContext.jsx';
import { Field, Modal, MoneyInput } from './ui.jsx';

/**
 * Akun yang boleh dipilih untuk transaksi: akun utama aktif (+ akun yang sedang dipakai), Umum bila relevan, lalu
 * kantong patungan yang masih tampil (patungan buka atau saldo belum nol).
 * @returns {{id, name, pocket: boolean}[]}
 */
export function useAccountOptions(currentIds = []) {
  const { data, derived, accountMode } = useApp();
  const options = data.accounts
    .filter((a) => a.active || currentIds.includes(a.id))
    .map((a) => ({ id: a.id, name: a.name, pocket: false }));
  const shown = new Set(derived.shownPockets.map((p) => p.id));
  const pockets = data.pockets
    .filter((p) => shown.has(p.id) || currentIds.includes(p.id))
    .map((p) => ({ id: p.id, name: p.name, pocket: true }));
  // Mode Multi: Umum selalu tersedia bila ada kantong patungan, sebagai tujuan sisa dana.
  const umum = derived.unallocatedAvailable || currentIds.includes(UNALLOCATED_ID) || (accountMode === 'multi' && pockets.length > 0);
  if (umum) options.push({ id: UNALLOCATED_ID, name: UNALLOCATED_NAME, pocket: false });
  return [...options, ...pockets];
}

/** <option> akun, dikelompokkan bila ada kantong patungan. */
export function AccountOptions({ options }) {
  const main = options.filter((o) => !o.pocket);
  const pockets = options.filter((o) => o.pocket);
  const render = (list) => list.map((o) => <option key={o.id} value={o.id}>{o.name}</option>);
  if (!pockets.length) return render(main);
  return (
    <>
      <optgroup label="Kas utama">{render(main)}</optgroup>
      <optgroup label="Kantong patungan">{render(pockets)}</optgroup>
    </>
  );
}

const TITLES = { out: 'Catat pengeluaran', in: 'Catat pemasukan lain', transfer: 'Pindah saldo antar akun' };

/**
 * Form pengeluaran / pemasukan lain / pindah saldo.
 * `initial` mengisi nilai awal transaksi baru, mis. { accountId, toId, amount, description } untuk "Pindahkan sisa".
 */
export function TransactionModal({ mode, tx, initial = {}, title, onClose }) {
  const { derived, actions, accountMode } = useApp();
  const editing = Boolean(tx);
  const options = useAccountOptions([tx?.accountId, initial.accountId, initial.toId].filter(Boolean));
  const pickAccount = accountMode !== 'simple' || options.length > 1;

  const firstId = tx?.accountId ?? initial.accountId ?? options[0]?.id ?? '';
  const [date, setDate] = useState(tx?.date ?? todayISO());
  const [accountId, setAccountId] = useState(firstId);
  const [toId, setToId] = useState(initial.toId ?? options.find((o) => o.id !== firstId)?.id ?? '');
  const [amount, setAmount] = useState(tx?.amount ?? initial.amount ?? '');
  const [description, setDescription] = useState(tx?.description ?? initial.description ?? '');
  const [saving, setSaving] = useState(false);

  const valid =
    Number.isSafeInteger(amount) && amount > 0 && isISODate(date) && accountId &&
    (mode === 'transfer' ? toId && toId !== accountId : description.trim().length > 0);

  // Peringatan (tidak memblokir) bila saldo akun akan menjadi minus.
  const balance = derived.balances.get(accountId) ?? 0;
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
    <Modal title={title ?? (editing ? `Ubah ${mode === 'out' ? 'pengeluaran' : 'pemasukan'}` : TITLES[mode])} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="row">
          <Field label="Tanggal">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          {pickAccount && (
            <Field label={mode === 'transfer' ? 'Dari akun' : 'Akun kas'}>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <AccountOptions options={options} />
              </select>
            </Field>
          )}
        </div>
        {mode === 'transfer' && (
          <Field label="Ke akun">
            <select value={toId} onChange={(e) => setToId(e.target.value)}>
              <option value="">Pilih akun…</option>
              <AccountOptions options={options.filter((o) => o.id !== accountId)} />
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
