import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { Meta } from '../api';
import { pretty } from '../types';

// ---------- toasts ----------
interface Toast {
  id: number;
  kind: 'success' | 'error';
  text: string;
}
const ToastCtx = createContext<(kind: Toast['kind'], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- badges ----------
const STATUS_TONE: Record<string, string> = {
  SEGREGATED: 'slate',
  COLLECTION_PENDING: 'amber',
  COLLECTED: 'blue',
  IN_TRANSIT: 'violet',
  ARRIVED: 'cyan',
  TREATMENT_PENDING: 'amber',
  TREATED: 'teal',
  DISPOSED: 'green',
  CLOSED: 'green',
  REJECTED: 'red',
  PENDING: 'amber',
  ASSIGNED: 'blue',
  COMPLETED: 'green',
  CANCELLED: 'slate',
  PLANNED: 'slate',
  OPEN: 'red',
  ACKNOWLEDGED: 'amber',
  RESOLVED: 'green',
  LOW: 'slate',
  MEDIUM: 'amber',
  HIGH: 'orange',
  CRITICAL: 'red',
  AVAILABLE: 'green',
  IN_USE: 'violet',
  MAINTENANCE: 'red',
};
export const Badge = ({ value, tone }: { value: string; tone?: string }) => (
  <span className={`badge ${tone ?? STATUS_TONE[value] ?? 'slate'}`}>{pretty(value)}</span>
);

// ---------- layout bits ----------
export const Card = ({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={`card ${className}`}>
    {(title || actions) && (
      <header className="card-head">
        <h3>{title}</h3>
        <div className="row gap">{actions}</div>
      </header>
    )}
    {children}
  </section>
);

export const PageHead = ({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) => (
  <div className="page-head">
    <div>
      <h1>{title}</h1>
      {subtitle && <p className="muted">{subtitle}</p>}
    </div>
    <div className="row gap wrap">{actions}</div>
  </div>
);

export const Skeleton = ({ rows = 5 }: { rows?: number }) => (
  <div aria-busy="true">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="skeleton" style={{ width: `${70 + ((i * 13) % 30)}%` }} />
    ))}
  </div>
);

export const Empty = ({ title, hint }: { title: string; hint?: string }) => (
  <div className="empty">
    <div className="empty-icon">∅</div>
    <strong>{title}</strong>
    {hint && <p className="muted">{hint}</p>}
  </div>
);

export const ErrorBox = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div className="error-box" role="alert">
    <span>{message}</span>
    {onRetry && (
      <button className="btn sm" onClick={onRetry}>
        Retry
      </button>
    )}
  </div>
);

export function Pagination({ meta, onPage }: { meta: Meta; onPage: (p: number) => void }) {
  if (!meta.totalPages) return null;
  const { page = 1, totalPages, total = 0, pageSize = 20 } = meta;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  return (
    <div className="pagination">
      <span className="muted">
        {from}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="row gap">
        <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          ‹ Prev
        </button>
        <span className="muted">
          Page {page} / {totalPages}
        </span>
        <button className="btn sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next ›
        </button>
      </div>
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="card-head">
          <h3>{title}</h3>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/** Confirmation dialog: resolves through callbacks so destructive actions never fire on a stray click. */
export function Confirm({ title, text, confirmLabel = 'Confirm', danger, onConfirm, onCancel }: { title: string; text: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p>{text}</p>
      <div className="row gap end">
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <label className="field">
    <span>{label}</span>
    {children}
    {hint && <small className="muted">{hint}</small>}
  </label>
);

export const toIso = (local: string) => (local ? new Date(local).toISOString() : undefined);
export const localInput = (offsetHours = 0) => {
  const d = new Date(Date.now() + offsetHours * 3600_000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
