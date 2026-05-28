'use client';

/**
 * Primitives UI des pages de connexion tenant — Direction & Caisse.
 *
 * Thème clair, cohérent avec l'espace client redessiné : carte centrée sur
 * fond dégradé chaud, typo `display` / `mono`, palette claire partagée.
 *
 * Distinct de `entry-ui.tsx` (DA « System A One » sombre, réservée au funnel
 * SaaS : signup / reset-password).
 */
import Image from 'next/image';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { Scissors } from 'lucide-react';
import { LocaleSwitcher } from './LocaleSwitcher';

/** Palette claire — identique à celle de l'espace client. */
export const AUTH_C = {
  bg: '#F4F3F0',
  card: '#FFFFFF',
  cardBorder: '#E4E2DC',
  cardShadow: '0 4px 32px rgba(40,35,28,0.09), 0 1px 4px rgba(40,35,28,0.06)',
  title: '#18160F',
  subtitle: '#8A8478',
  inputBg: '#EEECEA',
  inputBorder: '#DEDAD3',
  inputBorderFocus: '#3A3630',
  inputText: '#18160F',
  inputShadow: '0 6px 20px rgba(40,35,28,0.18), 0 2px 6px rgba(40,35,28,0.10)',
  inputShadowFocus: '0 10px 32px rgba(40,35,28,0.26), 0 3px 10px rgba(40,35,28,0.14)',
  btn: '#1A1714',
  btnText: '#FFFFFF',
  back: '#A8A49C',
  separator: '#E4E2DC',
  red: '#B91C1C',
} as const;

// ─── AuthShell — coquille centrée : marque + carte ───────────────────────────

export function AuthShell({
  roleLabel,
  title,
  subtitle,
  children,
  footer,
  wide = false,
  logoUrl,
}: {
  /** Libellé mono sous la marque (ex. « Espace Direction »). */
  roleLabel: string;
  /** Titre de la carte. */
  title: string;
  /** Paragraphe d'introduction sous le titre. */
  subtitle: string;
  /** Contenu de la carte (formulaire). */
  children: ReactNode;
  /** Pied de carte optionnel, séparé par un filet. */
  footer?: ReactNode;
  /** Carte élargie (max-w-md) — utile pour la grille de sélection caisse. */
  wide?: boolean;
  /** Logo du salon — affiché à la place de l'icône générique si présent. */
  logoUrl?: string | null;
}) {
  return (
    <main
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-16"
      style={{
        background: `radial-gradient(ellipse 110% 90% at 50% 10%, #ECEAE4 0%, ${AUTH_C.bg} 45%, #EDECEA 100%)`,
      }}
    >
      {/* ── Sélecteur de langue (coin haut-droit, RTL : se déplace à gauche
            automatiquement via les classes logiques start/end) ────────── */}
      <div className="absolute end-6 top-6 z-10">
        <LocaleSwitcher variant="auth" />
      </div>

      {/* ── Marque ──────────────────────────────────────────────────────── */}
      <div className="relative mb-9 flex flex-col items-center gap-4 text-center">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-3 start-1/2 h-32 w-32 -translate-x-1/2 rounded-full blur-2xl"
          style={{ background: 'rgba(40,35,28,0.10)' }}
        />
        {logoUrl ? (
          <Image
            src={logoUrl}
            alt={roleLabel}
            width={64}
            height={64}
            unoptimized
            className="relative h-16 w-16 rounded-2xl object-cover"
            style={{ border: `1px solid ${AUTH_C.cardBorder}`, boxShadow: AUTH_C.cardShadow }}
          />
        ) : (
          <div
            className="relative flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{ background: AUTH_C.btn, boxShadow: AUTH_C.cardShadow }}
          >
            <Scissors className="h-7 w-7" strokeWidth={1.5} style={{ color: AUTH_C.btnText }} />
          </div>
        )}
        <div className="mono text-[9px] uppercase tracking-[0.45em]" style={{ color: AUTH_C.back }}>
          {roleLabel}
        </div>
      </div>

      {/* ── Carte ───────────────────────────────────────────────────────── */}
      <div
        className={`fade-up w-full rounded-2xl p-7 ${wide ? 'max-w-md' : 'max-w-sm'}`}
        style={{
          background: AUTH_C.card,
          border: `1px solid ${AUTH_C.cardBorder}`,
          boxShadow: AUTH_C.cardShadow,
        }}
      >
        <h1 className="display mb-1 text-[1.6rem] leading-tight" style={{ color: AUTH_C.title }}>
          {title}
        </h1>
        <p className="mb-7 text-sm leading-relaxed" style={{ color: AUTH_C.subtitle }}>
          {subtitle}
        </p>
        {children}
        {footer && (
          <>
            <div className="my-6 border-t" style={{ borderColor: AUTH_C.separator }} />
            {footer}
          </>
        )}
      </div>
    </main>
  );
}

// ─── AuthField — champ texte clair (label mono + input bordé) ────────────────

interface AuthFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Message d'erreur — passe le champ en rouge. */
  error?: string;
}

export function AuthField({ label, error, id, name, className = '', ...rest }: AuthFieldProps) {
  const fieldId = id ?? name ?? label.toLowerCase().replace(/\s+/g, '-');
  const errorId = `${fieldId}-error`;
  return (
    <label className="block">
      <span
        className="mono mb-2 block text-[9px] uppercase tracking-[0.2em]"
        style={{ color: AUTH_C.back }}
      >
        {label}
      </span>
      <input
        id={fieldId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`w-full rounded-xl px-4 py-3 text-sm outline-none transition-all disabled:opacity-50 ${className}`}
        style={{
          background: AUTH_C.inputBg,
          border: `1px solid ${error ? AUTH_C.red : AUTH_C.inputBorder}`,
          color: AUTH_C.inputText,
          boxShadow: AUTH_C.inputShadow,
        }}
        onFocus={(e) => {
          if (!error) {
            e.currentTarget.style.borderColor = AUTH_C.inputBorderFocus;
            e.currentTarget.style.background = '#FFFFFF';
            e.currentTarget.style.boxShadow = AUTH_C.inputShadowFocus;
          }
        }}
        onBlur={(e) => {
          if (!error) {
            e.currentTarget.style.borderColor = AUTH_C.inputBorder;
            e.currentTarget.style.background = AUTH_C.inputBg;
            e.currentTarget.style.boxShadow = AUTH_C.inputShadow;
          }
        }}
        {...rest}
      />
      {error && (
        <p id={errorId} className="mt-1.5 text-xs" style={{ color: AUTH_C.red }}>
          {error}
        </p>
      )}
    </label>
  );
}

// ─── AuthButton — bouton primaire pleine largeur ─────────────────────────────

interface AuthButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Affiche un spinner et désactive le bouton. */
  loading?: boolean;
  children: ReactNode;
}

export function AuthButton({
  loading = false,
  disabled,
  children,
  className = '',
  ...rest
}: AuthButtonProps) {
  return (
    <button
      disabled={disabled ?? loading}
      className={`btn-press mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold transition-opacity disabled:opacity-30 ${className}`}
      style={{ background: AUTH_C.btn, color: AUTH_C.btnText }}
      {...rest}
    >
      {children}
      {loading && (
        <span
          className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2"
          style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#FFFFFF' }}
        />
      )}
    </button>
  );
}
