import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatNumber } from '../lib/money.js';
import { MONTH_NAMES, parseMonth, toMonthKey } from '../lib/months.js';

/* ---------- Toast ---------- */
const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((text, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((list) => [...list, { id, text, kind }].slice(-3));
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), kind === 'error' ? 8000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ---------- Modal (memakai <dialog> bawaan: fokus terkunci & Esc otomatis) ---------- */
export function Modal({ title, onClose, children, wide = false }) {
  const ref = useRef(null);
  const downOnBackdrop = useRef(false);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog.open) dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className={`modal${wide ? ' wide' : ''}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // Tutup hanya bila klik dimulai & berakhir di latar; kalau tidak, memilih teks lalu melepas di luar menutup form.
      onMouseDown={(e) => { downOnBackdrop.current = e.target === ref.current; }}
      onClick={(e) => { if (e.target === ref.current && downOnBackdrop.current) onClose(); }}
    >
      <div className="modal-card">
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Tutup" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </dialog>
  );
}

/* ---------- Form ---------- */
export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

/** Input rupiah dengan pemisah ribuan. value: bilangan bulat atau '' (kosong). */
export function MoneyInput({ value, onChange, ...rest }) {
  const display = value === '' || value === null || value === undefined ? '' : formatNumber(value);
  return (
    <div className="money-input">
      <span aria-hidden="true">Rp</span>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={display}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 13);
          onChange(digits === '' ? '' : Number(digits));
        }}
        {...rest}
      />
    </div>
  );
}

/** Pilih bulan + tahun (select, bukan <input type=month> yang tidak didukung semua browser). */
export function MonthPicker({ value, onChange, disabled = false, 'aria-label': ariaLabel = 'Bulan' }) {
  const parsed = parseMonth(value) ?? { year: new Date().getFullYear(), month: 1 };
  const years = useMemo(() => {
    const thisYear = new Date().getFullYear();
    const from = Math.min(thisYear - 5, parsed.year);
    const to = Math.max(thisYear + 5, parsed.year);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }, [parsed.year]);
  return (
    <div className="row" style={{ gap: '0.5rem' }} role="group" aria-label={ariaLabel}>
      <select
        aria-label={`${ariaLabel}: nama bulan`}
        disabled={disabled}
        value={parsed.month}
        onChange={(e) => onChange(toMonthKey(parsed.year, Number(e.target.value)))}
      >
        {MONTH_NAMES.map((name, i) => (
          <option key={name} value={i + 1}>{name}</option>
        ))}
      </select>
      <select
        aria-label={`${ariaLabel}: tahun`}
        disabled={disabled}
        value={parsed.year}
        onChange={(e) => onChange(toMonthKey(Number(e.target.value), parsed.month))}
      >
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </div>
  );
}

/** Tombol dua langkah: klik pertama meminta konfirmasi, klik kedua mengeksekusi. */
export function ConfirmButton({ children, confirmLabel = 'Yakin?', onConfirm, className = 'btn small danger', disabled }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={armed ? `${className} solid` : className}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}

export function Spinner({ label = 'Memuat…' }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function Stat({ label, value, sub, tone }) {
  return (
    <div className="stat">
      <div className="k">{label}</div>
      <div className={`v${tone ? ` ${tone}` : ''}`}>{value}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="empty card">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function BrandMark({ size = 30 }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 32 32" width={size * 0.7} height={size * 0.7} fill="none" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round">
        <path d="M5 9h22v15H5z" />
        <path d="M5 14h22" />
        <circle cx="22" cy="19" r="1.5" fill="#fff" stroke="none" />
      </svg>
    </span>
  );
}
