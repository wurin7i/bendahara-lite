import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.jsx';

async function boot() {
  // Mode demo: Google palsu di dalam browser. Cabang ini dibuang saat build produksi.
  if (import.meta.env.MODE === 'demo') {
    const { installFakeGoogle } = await import('./dev/fakeGoogle.js');
    installFakeGoogle();
  }
  createRoot(document.getElementById('root')).render(<App />);
}

boot();
