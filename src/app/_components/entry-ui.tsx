'use client';

/**
 * Primitives UI des pages d'entrée de l'app tenant — signup, login.
 *
 * Ces pages portent la DA System A One (noir + vert pomme, Inter Tight —
 * cf. D-024). Composants autonomes : ils n'utilisent PAS @/components
 * (ancienne DA cuivre, réservée aux pages internes manager/cashier/client
 * jusqu'au rebrand complet, phase 2). Styles : Tailwind en valeurs arbitraires
 * + utilitaires `aone-*` (cf. globals.css).
 *
 * Marquage 'use client' pour pouvoir appeler `useTranslations` dans EntryShell
 * (arguments rassurants traduits). Les autres primitives (Field, Button, etc.)
 * sont sans état et tolèrent parfaitement le côté client.
 */
import { useTranslations } from 'next-intl';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { BrandLogo } from './BrandLogo';
import { LocaleSwitcher } from './LocaleSwitcher';

/** Site marketing — destination du logo et du lien retour. */
const SITE_URL = 'https://www.system-aone.com';

const MONO = 'var(--font-jetbrains), ui-monospace, SFMono-Regular, monospace';
const SERIF = 'var(--font-instrument), Georgia, serif';
const SANS = 'var(--font-inter-tight), -apple-system, BlinkMacSystemFont, sans-serif';

// =============================================================================
// SerifAccent — mot d'accent éditorial (Instrument Serif italique, vert pomme)
// =============================================================================

export function SerifAccent({ children }: { children: ReactNode }) {
  return (
    <span
      className="text-[#A3E635]"
      style={{ fontFamily: SERIF, fontStyle: 'italic', fontWeight: 400 }}
    >
      {children}
    </span>
  );
}

// =============================================================================
// CheckTick — petit marqueur vert pomme pour les listes
// =============================================================================

function CheckTick() {
  return (
    <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border border-[#A3E635]/30 bg-[#A3E635]/10">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M20 6 9 17l-5-5"
          stroke="#A3E635"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

// =============================================================================
// EntryShell — coquille split-screen : panneau de marque + zone formulaire
// =============================================================================

interface EntryShellProps {
  /** Libellé mono au-dessus du titre du panneau de marque. */
  eyebrow: string;
  /** Titre éditorial — peut contenir un <SerifAccent>. */
  headline: ReactNode;
  /** Paragraphe d'introduction sous le titre. */
  intro: string;
  /** Contenu de la zone de droite (formulaire). */
  children: ReactNode;
}

export function EntryShell({ eyebrow, headline, intro, children }: EntryShellProps) {
  const tEntry = useTranslations('entry');
  // Arguments rassurants traduits — résolus à chaque render, donc réactifs
  // au changement de langue côté client.
  const reassurance = [
    tEntry('reassuranceConfig'),
    tEntry('reassuranceHosting'),
    tEntry('reassuranceNoCommit'),
  ];
  return (
    <main
      className="relative min-h-screen bg-[#0A0A0A] text-[#FAFAFA]"
      style={{ fontFamily: SANS }}
    >
      <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
        {/* ---- Panneau de marque (desktop uniquement) ---- */}
        <aside className="aone-grid relative hidden flex-col justify-between overflow-hidden border-e border-[rgba(250,250,250,0.07)] px-12 py-14 lg:flex xl:px-16">
          {/* halo vert pomme */}
          <div
            aria-hidden
            className="pointer-events-none absolute -left-32 -top-28 h-[460px] w-[460px] rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(163,230,53,0.12), transparent 70%)',
            }}
          />
          {/* fondu bas */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-[#0A0A0A] to-transparent"
          />

          <a
            href={SITE_URL}
            className="aone-fade relative w-fit rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#A3E635]"
            style={{ animationDelay: '40ms' }}
          >
            <BrandLogo variant="lockup" size={30} />
          </a>

          <div className="relative max-w-[440px]">
            <div className="aone-fade flex items-center gap-3" style={{ animationDelay: '120ms' }}>
              <span className="h-px w-7 bg-[#A3E635]/55" />
              <span
                className="text-[11px] font-medium uppercase tracking-[0.24em] text-[#A3E635]"
                style={{ fontFamily: MONO }}
              >
                {eyebrow}
              </span>
            </div>
            <h1
              className="aone-fade mt-6 text-[32px] font-semibold leading-[1.1] tracking-[-0.035em] xl:text-[36px]"
              style={{ animationDelay: '190ms' }}
            >
              {headline}
            </h1>
            <p
              className="aone-fade mt-5 max-w-[392px] text-[15px] leading-[1.6] text-[#A1A1AA]"
              style={{ animationDelay: '260ms' }}
            >
              {intro}
            </p>
            <ul className="aone-fade mt-9 space-y-3.5" style={{ animationDelay: '330ms' }}>
              {reassurance.map((item) => (
                <li key={item} className="flex items-center gap-3 text-[13.5px] text-[#D4D4D8]">
                  <CheckTick />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div
            className="aone-fade relative flex items-center gap-2.5"
            style={{ animationDelay: '400ms' }}
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#A3E635] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#A3E635]" />
            </span>
            <span
              className="text-[11px] uppercase tracking-[0.22em] text-[#71717A]"
              style={{ fontFamily: MONO }}
            >
              app.system-aone.com
            </span>
          </div>
        </aside>

        {/* ---- Zone de formulaire ---- */}
        <section className="relative flex flex-col justify-center px-6 py-12 sm:px-10 lg:px-14 xl:px-20">
          {/* Sélecteur de langue — coin haut-droit (logique via `end-*` pour
              accompagner le flip RTL en arabe). */}
          <div className="absolute end-6 top-6 z-10 sm:end-10 lg:end-14 xl:end-20">
            <LocaleSwitcher variant="entry" />
          </div>
          <a
            href={SITE_URL}
            className="mb-10 w-fit rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#A3E635] lg:hidden"
          >
            <BrandLogo variant="lockup" size={27} />
          </a>
          <div className="mx-auto w-full max-w-[416px] lg:mx-0">{children}</div>
        </section>
      </div>
    </main>
  );
}

// =============================================================================
// EntryEyebrow — libellé mono + filet, en tête de la zone formulaire
// =============================================================================

export function EntryEyebrow({ children }: { children: ReactNode }) {
  return (
    <span
      className="flex items-center gap-2.5 text-[11px] font-medium uppercase tracking-[0.22em] text-[#A3E635]"
      style={{ fontFamily: MONO }}
    >
      <span className="h-px w-6 bg-[#A3E635]/55" />
      {children}
    </span>
  );
}

// =============================================================================
// EntryField — champ texte (label mono + input bordé, focus vert pomme)
// =============================================================================

interface EntryFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Message d'erreur — passe le champ en rouge. */
  error?: string;
  /** Aide affichée sous le champ en l'absence d'erreur. */
  hint?: ReactNode;
}

export function EntryField({
  label,
  error,
  hint,
  id,
  name,
  className = '',
  ...rest
}: EntryFieldProps) {
  const fieldId = id ?? name ?? label.toLowerCase().replace(/\s+/g, '-');
  return (
    <div>
      <label
        htmlFor={fieldId}
        className="block text-[10.5px] font-medium uppercase tracking-[0.18em] text-[#A1A1AA]"
        style={{ fontFamily: MONO }}
      >
        {label}
      </label>
      <input
        id={fieldId}
        name={name}
        className={`aone-input mt-2 h-12 w-full rounded-[8px] border bg-white/[0.02] px-4 text-[15px] text-[#FAFAFA] outline-none transition-[border-color,background-color,box-shadow] duration-200 placeholder:text-[#52525B] disabled:opacity-55 ${
          error
            ? 'border-[#EF4444]/55 focus:border-[#EF4444]/70 focus:shadow-[0_0_0_3px_rgba(239,68,68,0.13)]'
            : 'border-[rgba(250,250,250,0.12)] focus:border-[#A3E635]/55 focus:bg-[#A3E635]/[0.04] focus:shadow-[0_0_0_3px_rgba(163,230,53,0.12)]'
        } ${className}`}
        {...rest}
      />
      {error ? (
        <p className="mt-1.5 text-[12px] text-[#F87171]">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[12px] leading-relaxed text-[#71717A]">{hint}</p>
      ) : null}
    </div>
  );
}

// =============================================================================
// EntryButton — bouton primaire pleine largeur (vert pomme + flèche animée)
// =============================================================================

function Arrow() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="transition-transform duration-200 group-hover:translate-x-1"
    >
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface EntryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Affiche un spinner et désactive le bouton. */
  loading?: boolean;
  children: ReactNode;
}

export function EntryButton({
  loading = false,
  disabled,
  children,
  className = '',
  ...rest
}: EntryButtonProps) {
  return (
    <button
      disabled={disabled ?? loading}
      className={`group inline-flex h-[52px] w-full items-center justify-center gap-2.5 rounded-[8px] bg-[#A3E635] text-[15px] font-semibold tracking-[-0.01em] text-[#0A0A0A] transition-[transform,background-color,box-shadow,opacity] duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A3E635] enabled:hover:-translate-y-[2px] enabled:hover:bg-[#BEF264] enabled:hover:shadow-[0_14px_36px_-12px_rgba(163,230,53,0.6)] enabled:active:translate-y-0 enabled:active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55 ${className}`}
      {...rest}
    >
      {children}
      {loading ? (
        <span className="h-[15px] w-[15px] shrink-0 animate-spin rounded-full border-2 border-[#0A0A0A]/25 border-t-[#0A0A0A]" />
      ) : (
        <Arrow />
      )}
    </button>
  );
}
