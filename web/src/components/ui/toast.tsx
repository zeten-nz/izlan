'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { FiCheckCircle, FiAlertTriangle, FiInfo, FiX } from 'react-icons/fi';

export type ToastVariant = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}
interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICON: Record<ToastVariant, typeof FiInfo> = { success: FiCheckCircle, error: FiAlertTriangle, info: FiInfo };
const ACCENT: Record<ToastVariant, string> = { success: 'text-success', error: 'text-danger', info: 'text-info' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const remove = useCallback((id: number) => setItems((cur) => cur.filter((t) => t.id !== id)), []);
  const toast = useCallback(
    (message: string, variant: ToastVariant = 'info') => {
      const id = nextId.current++;
      setItems((cur) => [...cur, { id, message, variant }]);
      setTimeout(() => remove(id), 5000);
    },
    [remove],
  );

  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2" aria-live="polite" role="status">
        {items.map((t) => {
          const Icon = ICON[t.variant];
          return (
            <div
              key={t.id}
              className="pointer-events-auto flex items-start gap-3 rounded-card border border-border bg-surface px-4 py-3 shadow-lg"
            >
              <Icon className={`mt-0.5 shrink-0 ${ACCENT[t.variant]}`} aria-hidden />
              <p className="flex-1 text-sm text-text">{t.message}</p>
              <button type="button" onClick={() => remove(t.id)} aria-label="Yopish" className="text-muted hover:text-text">
                <FiX aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
