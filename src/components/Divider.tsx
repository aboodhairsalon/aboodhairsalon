import { cn } from '../utils/cn';

export interface DividerProps {
  label?: string;
  className?: string;
}

export function Divider({ label, className }: DividerProps) {
  return (
    <div className={cn('my-6 flex items-center gap-3', className)}>
      <div className="bg-line h-px flex-1" />
      {label ? (
        <span className="mono text-ink-soft text-[10px] uppercase tracking-[0.25em]">{label}</span>
      ) : null}
      <div className="bg-line h-px flex-1" />
    </div>
  );
}
