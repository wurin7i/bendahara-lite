import { useApp } from '../state/AppContext.jsx';

/** Daftar langkah awal: akun kas -> periode -> anggota. */
export function Onboarding() {
  const { data } = useApp();
  const steps = [
    {
      done: data.accounts.length > 0,
      title: 'Tambah akun kas',
      text: 'Mis. Kas Kelas, Dana Darurat, Tabungan Wisata.',
      href: '#/pengaturan',
    },
    {
      done: data.periods.length > 0,
      title: 'Buat periode & atur alokasi',
      text: 'Pilih bulan mulai, besaran iuran, dan pembagiannya ke tiap akun kas.',
      href: '#/pengaturan',
    },
    {
      done: data.members.length > 0,
      title: 'Tambah anggota',
      text: 'Bisa menempel banyak nama sekaligus.',
      href: '#/anggota',
    },
  ];
  return (
    <section className="card" aria-label="Langkah awal" style={{ marginBottom: '1rem' }}>
      <div className="card-head">
        <h2>Mulai dari sini</h2>
      </div>
      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s.title} className={s.done ? 'done' : ''}>
            <span className="dot">{s.done ? '✓' : i + 1}</span>
            <span className="grow">
              <strong>{s.title}</strong>
              <br />
              <span className="muted small">{s.text}</span>
            </span>
            <a className="btn small" href={s.href}>{s.done ? 'Kelola' : 'Mulai'}</a>
          </li>
        ))}
      </ol>
    </section>
  );
}
