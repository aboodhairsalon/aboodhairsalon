import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../utils/cn';

export type TagTone = 'ink' | 'copper' | 'green' | 'red';

const tones: Record<TagTone, string> = {
  ink: 'border-line-hi text-ink-mute',
  copper: 'border-brand-primary text-brand-glow',
  green: 'border-green text-green',
  red: 'border-red text-red',
};

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: TagTone;
  children: ReactNode;
}

export function Tag({ tone = 'ink', className, children, ...rest }: TagProps) {
  return (
    <span
      className={cn(
        'mono inline-flex w-fit max-w-fit items-center self-start rounded-sm border px-2 py-1 text-[10px] uppercase tracking-[0.18em]',
        tones[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
