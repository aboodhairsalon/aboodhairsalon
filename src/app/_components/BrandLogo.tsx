/**
 * Logo Aboodhairsalon — glyphe ciseaux + wordmark.
 *
 * Utilisé sur les pages d'entrée (signup, login, reset-password) qui portent
 * la DA noir + vert pomme. Le nom et la tagline viennent de `@/config/salon`
 * pour rester cohérents et faciles à personnaliser lors d'un fork.
 */
import { SALON } from '@/config/salon';

interface BrandLogoProps {
  variant?: 'mark' | 'lockup';
  size?: number;
  className?: string;
}

/** Glyphe ciseaux (salon de coiffure) — remplace l'ancien glyphe A1. */
function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#d08c4f"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="3" />
      <path d="M8.12 8.12 12 12" />
      <path d="M20 4 8.12 15.88" />
      <circle cx="6" cy="18" r="3" />
      <path d="M14.8 14.8 20 20" />
    </svg>
  );
}

export function BrandLogo({ variant = 'lockup', size = 30, className = '' }: BrandLogoProps) {
  return (
    <span
      className={`inline-flex items-center gap-3 ${className}`}
      style={{ fontFamily: 'var(--font-inter-tight), sans-serif' }}
    >
      <Mark size={size} />
      {variant === 'lockup' && (
        <span className="flex flex-col leading-none">
          <span className="text-[16px] font-bold tracking-[-0.03em] text-[#f2ead8]">
            {SALON.name}
          </span>
          <span
            className="mt-1.5 text-[7px] uppercase tracking-[0.26em] text-[#857a64]"
            style={{ fontFamily: 'var(--font-jetbrains), monospace' }}
          >
            {SALON.tagline}
          </span>
        </span>
      )}
    </span>
  );
}
