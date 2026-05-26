'use client';

/**
 * Système de notifications « toast » — alertes transitoires empilées.
 *
 * Remplace les bannières d'erreur statiques : un toast apparaît en bas à
 * droite, se referme tout seul après quelques secondes et reste empilable.
 *
 * Usage :
 *   const toast = useToast();
 *   toast.success('Fiche enregistrée.');
 *   toast.error('Échec de la sauvegarde.');
 *
 * `useToast()` hors d'un `ToastProvider` renvoie une API silencieuse (no-op),
 * pour qu'un composant reste utilisable sans planter.
 */
import { AlertTriangle, Check, Info, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type ToastKind = 'success' | 'error' | 'info';
type ToastItem = { id: number; kind: ToastKind; message: string };

export type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

/** Durée d'affichage par type (ms) — les erreurs restent visibles plus longtemps. */
const DURATION: Record<ToastKind, number> = {
  success: 3500,
  info: 4000,
  error: 6000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((prev) => [...prev, { id, kind, message }]);
      setTimeout(() => dismiss(id), DURATION[kind]);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/** API toasts. Hors `ToastProvider` → no-op silencieux. */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP;
}

const NOOP: ToastApi = {
  success: () => {},
  error: () => {},
  info: () => {},
};

// ─── Rendu ───────────────────────────────────────────────────────────────────

const STYLE: Record<ToastKind, { icon: LucideIcon; cls: string }> = {
  success: { icon: Check, cls: 'text-green' },
  error: { icon: AlertTriangle, cls: 'text-red' },
  info: { icon: Info, cls: 'text-brand-primary' },
};

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  const tCommon = useTranslations('common');
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 end-4 z-[60] flex w-[min(92vw,360px)] flex-col gap-2">
      {toasts.map((t) => {
        const { icon: Icon, cls } = STYLE[t.kind];
        return (
          <div
            key={t.id}
            role="status"
            className="animate-fade-up border-line-hi bg-surface pointer-events-auto flex items-start gap-3 rounded-sm border p-3 shadow-[0_8px_28px_-6px_rgba(40,35,28,0.28)]"
          >
            <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${cls}`} strokeWidth={2} />
            <p className="text-ink flex-1 text-sm leading-snug">{t.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label={tCommon('closeAria')}
              className="btn-press text-ink-soft hover:text-ink -m-1 flex-shrink-0 p-1"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
