import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import { cn } from '../utils/cn';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  children: ReactNode;
}

export function Card({ as: Tag = 'div', className, children, ...rest }: CardProps) {
  return (
    <Tag
      className={cn(
        'border-line bg-surface rounded-sm border shadow-[0_5px_22px_-3px_rgba(40,35,28,0.13)]',
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
