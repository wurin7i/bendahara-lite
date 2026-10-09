import { useApp } from '../state/AppContext.jsx';

/** Daftar langkah awal: akun kas -> periode -> anggota. */
export function Onboarding() {
  const { data, accountMode } = useApp();
  const simple = accountMode === 'simple';
  const steps = [
    {
      done: data.accounts.length > 0,
      title: 'Atur nama kas & akun kas',
      text: simple
        ? 'Isi nama kas dan saldo awal. Pilih mode Multi akun kas bila iuran perlu dibagi ke beberapa kantong.'
        : 'Mis. Kas Kelas, Dana Darurat, Tabungan Wisata.',
      href: '#/pengaturan',
    },
    {
      done: data.periods.length > 0,
      title: simple ? 'Buat periode' : 'Buat periode & atur alokasi',
      text: simple
        ? 'Pilih bulan mulai dan besaran iuran per anggota per bulan.'
        : 'Pilih bulan mulai, besaran iuran, dan pembagiannya ke tiap akun kas.',
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
