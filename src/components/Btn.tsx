import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ComponentType,
  ReactNode,
  SVGProps,
} from 'react';
import { cn } from '../utils/cn';

export type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type BtnSize = 'sm' | 'md' | 'lg';

type IconType = ComponentType<
  SVGProps<SVGSVGElement> & { strokeWidth?: number; className?: string }
>;

const variants: Record<BtnVariant, string> = {
  primary: 'bg-brand-primary text-[#1A140C] hover:bg-brand-glow copper-glow',
  secondary: 'bg-surface-elev text-ink border border-line-hi hover:bg-surface-hi',
  ghost: 'text-ink-mute hover:text-ink hover:bg-surface',
  danger: 'bg-red/15 text-red border border-red/30 hover:bg-red/25',
};

const sizes: Record<BtnSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-6 py-3.5 text-base',
};

const BASE = 'btn-press inline-flex items-center justify-center gap-2 rounded-sm font-semibold';

function btnClass(variant: BtnVariant, size: BtnSize, full?: boolean, disabled?: boolean) {
  return cn(
    BASE,
    variants[variant],
    sizes[size],
    full && 'w-full',
    disabled && 'cursor-not-allowed opacity-40',
  );
}

export interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: BtnSize;
  icon?: IconType;
  full?: boolean;
  children: ReactNode;
}

export function Btn({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  full,
  disabled,
  className,
  // Défaut `type="button"` — sans ça HTML place `type="submit"` sur tout
  // <button> dans un <form>, ce qui transforme un bouton "Annuler" en
  // déclencheur de submit (cf. audit-2 finding E : refund accidentel).
  // Le caller peut toujours override avec type="submit".
  type = 'button',
  children,
  ...rest
}: BtnProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={cn(btnClass(variant, size, full, disabled), className)}
      {...rest}
    >
      {Icon ? <Icon className="h-4 w-4" strokeWidth={2} /> : null}
      {children}
    </button>
  );
}

export interface BtnLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: BtnVariant;
  size?: BtnSize;
  icon?: IconType;
  full?: boolean;
  children: ReactNode;
}

/**
 * Variante lien — même apparence que `Btn` mais rendue en `<a>`.
 * Pour les CTAs qui naviguent (signup, login…) plutôt que déclencher un handler.
 */
export function BtnLink({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  full,
  className,
  children,
  ...rest
}: BtnLinkProps) {
  return (
    <a className={cn(btnClass(variant, size, full), className)} {...rest}>
      {Icon ? <Icon className="h-4 w-4" strokeWidth={2} /> : null}
      {children}
    </a>
  );
}
