import { useEffect, useState } from 'react';
import { BrandMark, ToastProvider } from './components/ui.jsx';
import { periodTitle } from './lib/selectors.js';
import { AppProvider, useApp } from './state/AppContext.jsx';
import { ErrorView, LoadingView, LoginView, NeedInitView, SetupView } from './views/AuthViews.jsx';
import DuesView from './views/DuesView.jsx';
import LedgerView from './views/LedgerView.jsx';
import MembersView from './views/MembersView.jsx';
import ReportView from './views/ReportView.jsx';
import SettingsView from './views/SettingsView.jsx';

const ROUTES = [
  { id: 'iuran', label: 'Iuran', View: DuesView },
  { id: 'kas', label: 'Buku Kas', View: LedgerView },
  { id: 'laporan', label: 'Laporan', View: ReportView },
  { id: 'anggota', label: 'Anggota', View: MembersView },
  { id: 'pengaturan', label: 'Pengaturan', View: SettingsView },
];

const readRoute = () => {
  const id = window.location.hash.replace(/^#\/?/, '');
  return ROUTES.some((r) => r.id === id) ? id : 'iuran';
};

function useRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

function Shell() {
  const { data, period, selectPeriod, user, orgName, actions, busy, config } = useApp();
  const route = useRoute();
  const { View } = ROUTES.find((r) => r.id === route);

  return (
    <>
      {busy && <div className="busy-bar" role="progressbar" aria-label="Menyimpan" />}
      {config.demo && (
        <div className="demo-banner">
          Mode demo: Google palsu, data hanya tersimpan di browser ini. Bukan untuk penggunaan sebenarnya.
        </div>
      )}
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#/iuran">
            <BrandMark />
            <span>
              Bendahara Lite
              {orgName && <small>{orgName}</small>}
            </span>
          </a>
          <span className="spacer" />
          {data.periods.length > 0 && period && (
            <label className="period-picker no-print">
              <span className="muted small">Periode</span>
              <select value={period.id} onChange={(e) => selectPeriod(e.target.value)} aria-label="Pilih periode">
                {data.periods.map((p) => (
                  <option key={p.id} value={p.id}>{periodTitle(p)}</option>
                ))}
              </select>
            </label>
          )}
          <div className="user-chip no-print">
            <span className="avatar" aria-hidden="true">
              {user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : user.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="small" title={user.email}>{user.name}</span>
            <button type="button" className="btn small ghost" onClick={actions.signOut}>Keluar</button>
          </div>
        </div>
        <nav className="tabs no-print" aria-label="Menu utama">
          {ROUTES.map((r) => (
            <a key={r.id} href={`#/${r.id}`} aria-current={r.id === route ? 'page' : undefined}>{r.label}</a>
          ))}
        </nav>
      </header>
      <main className="page">
        <View />
      </main>
    </>
  );
}

function Gate() {
  const { phase } = useApp();
  switch (phase) {
    case 'signedOut': return <LoginView />;
    case 'noSheet': return <SetupView />;
    case 'needInit': return <NeedInitView />;
    case 'error': return <ErrorView />;
    case 'ready': return <Shell />;
    default: return <LoadingView />;
  }
}

export default function App() {
  return (
    <ToastProvider>
      <AppProvider>
        <Gate />
      </AppProvider>
    </ToastProvider>
  );
}
