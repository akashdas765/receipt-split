import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

const ICONS = { success: CheckCircle2, error: XCircle, info: Info };
const COLORS = {
  success: 'text-emerald-600 border-emerald-100',
  error:   'text-red-600 border-red-100',
  info:    'text-indigo-600 border-indigo-100',
};

function ToastItem({ toast, onDismiss }) {
  const Icon = ICONS[toast.type];
  return (
    <div
      role="status" aria-live="polite"
      className={`pointer-events-auto max-w-sm w-full glass rounded-2xl border ${COLORS[toast.type]} shadow-lg px-4 py-3 flex items-center gap-2 anim-pop`}
    >
      <Icon size={16} className="shrink-0" />
      <p className="text-sm font-semibold text-ink flex-1">{toast.message}</p>
      <button onClick={onDismiss} className="text-subtle hover:text-muted shrink-0">
        <X size={14} />
      </button>
    </div>
  );
}

// Global toast/snackbar primitive — mounted once in main.jsx so any page or
// component can call useToast() for one-off action feedback (save/delete/
// update succeeded or failed just now). Not a replacement for standing
// banners like HomePage's swAuthError — those communicate an ongoing broken
// state better than a transient toast ever could, and should stay banners.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts(t => t.filter(x => x.id !== id));
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  const show = useCallback((message, { type = 'info', duration } = {}) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts(t => [...t, { id, message, type }]);
    timers.current.set(id, setTimeout(() => dismiss(id), duration ?? (type === 'error' ? 4500 : 3000)));
    return id;
  }, [dismiss]);

  const api = {
    show,
    success: (m, opts) => show(m, { ...opts, type: 'success' }),
    error:   (m, opts) => show(m, { ...opts, type: 'error' }),
    info:    (m, opts) => show(m, { ...opts, type: 'info' }),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* z-[60]: above PageHeader/BottomNav (z-20/z-30) and modal overlays
          (z-50), so a toast fired from inside a modal is still visible. */}
      <div className="fixed top-4 inset-x-0 z-[60] flex flex-col items-center gap-2 px-4 pointer-events-none">
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
