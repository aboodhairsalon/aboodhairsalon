'use client';

/**
 * Sélecteur de langue compact — 3 lettres (FR · EN · AR) groupées en
 * segmented control. Présent dans les headers et les pages de connexion.
 *
 * Bascule via Server Action (`setLocale`) qui écrit le cookie + revalide.
 * Pas d'optimistic UI : le re-render complet de l'arbre est nécessaire pour
 * que tous les Server Components prennent la nouvelle langue de manière
 * cohérente — un état intermédiaire serait pire qu'un court flash.
 */
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { locales, type Locale, LOCALE_LABELS, LOCALE_NATIVE_NAMES } from '../../i18n/config';
import { setLocale } from '../../i18n/locale-actions';

type Variant = 'header' | 'auth' | 'entry';

interface LocaleSwitcherProps {
  /** Variante visuelle :
   *   - `header` (défaut) : compact, fond `bg-surface`, pour AppHeader
   *     (espace manager / cashier authentifié — thème clair cuivre)
   *   - `auth` : pour les pages /login + /cashier/login (thème clair
   *     posé sur fond crème, segments arrondis)
   *   - `entry` : pour signup / reset-password (thème sombre System A One,
   *     accent vert pomme A3E635) */
  variant?: Variant;
  /** Surcharge la couleur de fond du segment actif (utile sur les pages
   *  authentifiées qui injectent leur propre brand color). */
  activeColor?: string;
  /** Surcharge la couleur du texte du segment actif. */
  activeTextColor?: string;
}

// Styles centralisés par variante — évite l'arbre de ternaires.
const VARIANT_STYLES: Record<
  Variant,
  {
    container: string;
    containerStyle?: React.CSSProperties;
    button: string;
    activeBg: string;
    activeFg: string;
    inactiveClass: string;
  }
> = {
  header: {
    container: 'inline-flex items-center gap-0.5 rounded-sm border p-0.5 text-[10px]',
    button: 'btn-press rounded-sm px-2 py-1 font-semibold tracking-wider transition',
    activeBg: 'var(--color-brand-primary, #1A1714)',
    activeFg: '#FFFFFF',
    inactiveClass: 'text-ink-mute hover:text-ink',
  },
  auth: {
    container: 'inline-flex items-center gap-0.5 rounded-full border p-0.5 text-[10px]',
    containerStyle: { borderColor: '#DEDAD3', background: '#FFFFFF' },
    button: 'btn-press rounded-full px-2.5 py-1 font-semibold tracking-wider transition',
    activeBg: '#18160F',
    activeFg: '#FFFFFF',
    inactiveClass: 'text-[#8A8478] hover:text-[#18160F]',
  },
  entry: {
    container: 'inline-flex items-center gap-0.5 rounded-full border p-0.5 text-[10px]',
    containerStyle: {
      borderColor: 'rgba(250,250,250,0.12)',
      background: 'rgba(250,250,250,0.03)',
    },
    button: 'btn-press rounded-full px-2.5 py-1 font-semibold tracking-wider transition',
    activeBg: '#A3E635',
    activeFg: '#0A0A0A',
    inactiveClass: 'text-[#A1A1AA] hover:text-[#FAFAFA]',
  },
};

export function LocaleSwitcher({
  variant = 'header',
  activeColor,
  activeTextColor,
}: LocaleSwitcherProps) {
  const currentLocale = useLocale() as Locale;
  const tLocale = useTranslations('locale');
  const [pending, startTransition] = useTransition();
  const styles = VARIANT_STYLES[variant];

  const handleChange = (next: Locale) => {
    if (next === currentLocale || pending) return;
    startTransition(async () => {
      await setLocale(next);
    });
  };

  return (
    <div
      role="group"
      aria-label={tLocale('switcherAriaGroup')}
      className={`${styles.container} ${pending ? 'opacity-60' : ''}`}
      style={styles.containerStyle}
    >
      {locales.map((loc) => {
        const isActive = loc === currentLocale;
        const activeStyles = isActive
          ? {
              background: activeColor ?? styles.activeBg,
              color: activeTextColor ?? styles.activeFg,
            }
          : undefined;
        return (
          <button
            key={loc}
            type="button"
            onClick={() => handleChange(loc)}
            disabled={pending}
            aria-pressed={isActive}
            aria-label={LOCALE_NATIVE_NAMES[loc]}
            className={`${styles.button} ${isActive ? '' : styles.inactiveClass}`}
            style={activeStyles}
          >
            {LOCALE_LABELS[loc]}
          </button>
        );
      })}
    </div>
  );
}
