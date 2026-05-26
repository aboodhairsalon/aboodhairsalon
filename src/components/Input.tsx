import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '../utils/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
}

export function Input({ label, className, ...rest }: InputProps) {
  return (
    <label className="block">
      {label ? (
        <span className="mono text-ink-soft mb-2 block text-[10px] uppercase tracking-[0.2em]">
          {label}
        </span>
      ) : null}
      <input
        className={cn(
          'border-line bg-bg-soft text-ink placeholder:text-ink-soft focus:border-brand-primary w-full rounded-sm border px-3 py-2.5 transition-colors',
          className,
        )}
        {...rest}
      />
    </label>
  );
}
