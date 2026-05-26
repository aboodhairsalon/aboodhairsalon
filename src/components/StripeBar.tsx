import { cn } from '../utils/cn';

export interface StripeBarProps {
  h?: number;
  className?: string;
}

export function StripeBar({ h = 4, className }: StripeBarProps) {
  return (
    <div
      className={cn('stripes-fine w-full', className)}
      style={{ height: h }}
      role="presentation"
      aria-hidden
    />
  );
}
