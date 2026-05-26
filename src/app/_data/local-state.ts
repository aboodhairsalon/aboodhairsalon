'use client';

/**
 * Petit helper localStorage pour synchroniser l'état entre les routes tenant
 * (en attendant le branchement Supabase au jalon 1/3).
 *
 * Au jalon réel : ces lectures/écritures passent par `tenant_settings.*`
 * via Server Actions + revalidation.
 */
import { useLocale } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { fmtMoney, type Currency } from '@/lib/money';
import { useTenantOrNull } from '../_components/TenantProvider';
import {
  ACTIVE_CASHIER_KEY,
  INITIAL_SALON_PROFILE,
  SALON_PROFILE_KEY,
  type SalonProfile,
} from './mock';

// =============================================================================
// Active cashier
// =============================================================================
const CASHIER_CHANGED_EVENT = 'systema:active-cashier-changed';

export function readActiveCashierId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(ACTIVE_CASHIER_KEY);
  } catch {
    return null;
  }
}

export function writeActiveCashierId(id: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (id) window.localStorage.setItem(ACTIVE_CASHIER_KEY, id);
    else window.localStorage.removeItem(ACTIVE_CASHIER_KEY);
    window.dispatchEvent(new CustomEvent(CASHIER_CHANGED_EVENT, { detail: { id } }));
  } catch {
    /* ignore */
  }
}

export function useActiveCashierId(): string | null {
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    setId(readActiveCashierId());
    const onChange = () => setId(readActiveCashierId());
    window.addEventListener('storage', onChange);
    window.addEventListener(CASHIER_CHANGED_EVENT, onChange);
    return () => {
      window.removeEventListener('storage', onChange);
      window.removeEventListener(CASHIER_CHANGED_EVENT, onChange);
    };
  }, []);

  return id;
}

// =============================================================================
// Salon profile
// =============================================================================
const PROFILE_CHANGED_EVENT = 'systema:salon-profile-changed';

export function readSalonProfile(): SalonProfile {
  if (typeof window === 'undefined') return INITIAL_SALON_PROFILE;
  try {
    const raw = window.localStorage.getItem(SALON_PROFILE_KEY);
    if (!raw) return INITIAL_SALON_PROFILE;
    const parsed = JSON.parse(raw) as Partial<SalonProfile>;
    return { ...INITIAL_SALON_PROFILE, ...parsed };
  } catch {
    return INITIAL_SALON_PROFILE;
  }
}

export function writeSalonProfile(profile: SalonProfile): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SALON_PROFILE_KEY, JSON.stringify(profile));
    window.dispatchEvent(new CustomEvent(PROFILE_CHANGED_EVENT, { detail: profile }));
  } catch (e) {
    // localStorage peut être plein si logo trop gros (data URL).
    console.warn('[salon-profile] write failed:', e);
  }
}

export function useSalonProfile(): SalonProfile {
  const [profile, setProfile] = useState<SalonProfile>(INITIAL_SALON_PROFILE);

  useEffect(() => {
    setProfile(readSalonProfile());
    const onChange = () => setProfile(readSalonProfile());
    window.addEventListener('storage', onChange);
    window.addEventListener(PROFILE_CHANGED_EVENT, onChange);
    return () => {
      window.removeEventListener('storage', onChange);
      window.removeEventListener(PROFILE_CHANGED_EVENT, onChange);
    };
  }, []);

  return profile;
}

/**
 * Money formatter lié à la devise du salon courant.
 *
 * PRIORITÉ : devise du tenant SSR (via TenantProvider, source de vérité absolue)
 * > devise du profil localStorage (fallback démo / pages publiques sans tenant).
 *
 * Sans la priorité tenant, un manager Aboodhairsalon (EGP) qui n'a jamais
 * touché au mode démo a un localStorage vide → useSalonProfile retourne
 * defaultProfile (EUR) → tous les prix affichés en € au lieu d'EGP.
 * Bug catastrophique post-lancement marketing.
 *
 * Import dynamique (require) pour éviter le cycle TenantProvider → ce
 * fichier (utilisé par _components au mount, donc l'ordre d'évaluation
 * doit rester stable). Hook resolu côté client uniquement.
 */
export function useFmtMoney(): (cents: number) => string {
  const profile = useSalonProfile();
  const tenant = useTenantOrNull();
  const locale = useLocale();
  // Si un TenantProvider est dans l'arbre (espace /manager, /cashier, /client
  // d'un vrai tenant), sa devise est la source de vérité. Sinon on retombe
  // sur le localStorage démo (jamais en prod pour un compte authentifié).
  const currency = (tenant?.tenant.currency ?? profile.currency) as Currency;

  // Mappage locale next-intl → BCP-47 utilisable par Intl.NumberFormat.
  // Avant l'audit T5.6, fmtMoney imposait toujours la locale historique
  // attachée à la devise (`fr-FR` pour EGP → « 25,99 EGP »). En mode AR,
  // ça cassait la cohérence visuelle : tout est en arabe sauf les montants,
  // qui restent en latin. On utilise des fallbacks pays :
  //   - `ar` → `ar-EG` (locale arabe avec format des devises adapté)
  //   - `en` → `en-US`
  //   - `fr` → `fr-FR`
  // Le pays peut être affiné par tenant plus tard si besoin (ar-AE pour AED, etc.).
  const localeForIntl = locale === 'ar' ? 'ar-EG' : locale === 'en' ? 'en-US' : 'fr-FR';

  return useCallback(
    (cents: number) => fmtMoney(cents, currency, localeForIntl),
    [currency, localeForIntl],
  );
}
