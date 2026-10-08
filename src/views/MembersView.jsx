import { useState } from 'react';
import { Empty, Field, Modal, MonthPicker } from '../components/ui.jsx';
import { monthLabel } from '../lib/months.js';
import { useApp } from '../state/AppContext.jsx';

export default function MembersView() {
  const { data } = useApp();
  const [modal, setModal] = useState(null); // { member? } | 'bulk'
  const [showInactive, setShowInactive] = useState(false);

  const members = [...data.members]
    .filter((m) => showInactive || m.active)
    .sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }));
  const inactiveCount = data.members.filter((m) => !m.active).length;

  return (
    <>
      <div className="page-head">
        <h1>
          Anggota
          <span className="sub">{data.members.filter((m) => m.active).length} aktif{inactiveCount ? ` · ${inactiveCount} nonaktif` : ''}</span>
        </h1>
        <div className="toolbar">
          {inactiveCount > 0 && (
            <label className="inline-check" style={{ margin: 0 }}>
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Tampilkan nonaktif
            </label>
          )}
          <button type="button" className="btn" onClick={() => setModal('bulk')}>Tambah banyak</button>
          <button type="button" className="btn primary" onClick={() => setModal({})}>+ Tambah anggota</button>
        </div>
      </div>

      {members.length === 0 ? (
        <Empty title="Belum ada anggota">
          <p>Tambahkan anggota satu per satu, atau tempel daftar nama sekaligus.</p>
        </Empty>
      ) : (
        <div className="table-scroll">
          <table className="simple">
            <thead>
              <tr>
                <th>Nama</th>
                <th>Kontak</th>
                <th>Mulai iuran</th>
                <th>Catatan</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className={m.active ? '' : 'muted-row'}>
                  <td>{m.name}{!m.active && <span className="tag">nonaktif</span>}</td>
                  <td>{m.contact || <span className="muted">–</span>}</td>
                  <td>{m.startMonth ? monthLabel(m.startMonth) : <span className="muted">awal periode</span>}</td>
                  <td>{m.note || <span className="muted">–</span>}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="btn small" onClick={() => setModal({ member: m })}>Ubah</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint">
        Anggota tidak dihapus agar riwayat iuran tetap utuh. Ubah menjadi nonaktif bila sudah keluar; ia tidak lagi ditagih.
      </p>

      {modal === 'bulk' && <BulkModal onClose={() => setModal(null)} />}
      {modal && modal !== 'bulk' && <MemberModal member={modal.member} onClose={() => setModal(null)} />}
    </>
  );
}

function MemberModal({ member, onClose }) {
  const { actions, nowMonth } = useApp();
  const [name, setName] = useState(member?.name ?? '');
  const [contact, setContact] = useState(member?.contact ?? '');
  const [hasStart, setHasStart] = useState(Boolean(member?.startMonth));
  const [startMonth, setStartMonth] = useState(member?.startMonth || nowMonth);
  const [active, setActive] = useState(member?.active ?? true);
  const [note, setNote] = useState(member?.note ?? '');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    const ok = await actions.saveMember({
      ...(member ?? {}),
      name,
      contact: contact.trim(),
      startMonth: hasStart ? startMonth : '',
      active,
      note: note.trim(),
    });
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Modal title={member ? 'Ubah anggota' : 'Tambah anggota'} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Nama">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </Field>
        <Field label="Kontak (opsional)">
          <input type="text" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="No. HP / email" />
        </Field>
        <label className="inline-check">
          <input type="checkbox" checked={hasStart} onChange={(e) => setHasStart(e.target.checked)} />
          Baru bergabung: mulai ditagih dari bulan tertentu
        </label>
        {hasStart && (
          <Field label="Mulai iuran">
            <MonthPicker value={startMonth} onChange={setStartMonth} aria-label="Mulai iuran" />
          </Field>
        )}
        <Field label="Catatan (opsional)">
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <label className="inline-check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Anggota aktif (ditagih iuran)
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

function BulkModal({ onClose }) {
  const { actions, data } = useApp();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const existing = new Set(data.members.map((m) => m.name.trim().toLowerCase()));
  const seen = new Set();
  const names = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    const name = line.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (existing.has(key) || seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    names.push(name);
  }

  async function submit(e) {
    e.preventDefault();
    if (!names.length || saving) return;
    setSaving(true);
    const ok = await actions.addMembers(names, '');
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Modal title="Tambah banyak anggota" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Satu nama per baris" hint="Tempel dari Excel/WhatsApp. Nama yang sudah ada atau kembar dilewati.">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} autoFocus placeholder={'Ani Lestari\nBudi Santoso\nCitra Dewi'} />
        </Field>
        <p className="small muted" aria-live="polite">
          {names.length} nama akan ditambahkan{skipped ? `, ${skipped} dilewati (sudah ada/kembar)` : ''}.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Batal</button>
          <button type="submit" className="btn primary" disabled={!names.length || saving}>
            {saving ? 'Menyimpan…' : `Tambahkan ${names.length || ''}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}

