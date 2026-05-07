'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Lightweight toast system. Avoids extra deps; sufficient for the workbench's
 * "导出/复制 完成" style ephemeral messages.
 */
export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant?: 'default' | 'success' | 'destructive';
}

interface ToastContextValue {
  toasts: ToastItem[];
  toast: (t: Omit<ToastItem, 'id'>) => void;
  dismiss: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback(
    (t: Omit<ToastItem, 'id'>) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((prev) => [...prev, { ...t, id }]);
      // Auto-dismiss after 3.5s
      setTimeout(() => dismiss(id), 3500);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
      <Toaster />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

function Toaster() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
      {ctx.toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto rounded-md border bg-background p-4 shadow-lg',
            t.variant === 'success' && 'border-emerald-300 bg-emerald-50 text-emerald-900',
            t.variant === 'destructive' && 'border-destructive bg-destructive/10 text-destructive',
          )}
        >
          <div className="text-sm font-semibold">{t.title}</div>
          {t.description ? <div className="mt-1 text-xs opacity-80">{t.description}</div> : null}
        </div>
      ))}
    </div>
  );
}
