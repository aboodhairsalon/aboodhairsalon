'use client';

import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { cn } from '../utils/cn';
import { StripeBar } from './StripeBar';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  wide?: boolean;
  children: ReactNode;
}

export function Modal({ open, onClose, title, wide, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="animate-fade-up fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'scrollbar border-line-hi bg-surface max-h-[90vh] w-full overflow-y-auto rounded-sm border',
          wide ? 'max-w-3xl' : 'max-w-md',
        )}
      >
        <StripeBar h={3} />
        <div className="flex items-center justify-between px-6 pb-4 pt-5">
          <h3 className="display text-2xl">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="btn-press text-ink-mute hover:text-ink"
            aria-label="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}
