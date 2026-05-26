'use client';

/**
 * Context React qui transporte les données du tenant connecté (lues
 * côté serveur via `requireTenant()`) jusqu'aux Client Components.
 *
 * Remplace progressivement `useSalonProfile()` (localStorage) — la
 * source de vérité est maintenant la DB Supabase.
 *
 * Les composants 'use client' consomment via `useTenant()`. Les
 * Server Components peuvent appeler `requireTenant()` directement.
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { Currency } from '@/lib/money';
import type { Product, Service, Staff } from '../_data/mock';

/** Photo de la galerie publique du salon — affichée sur l'espace /client. */
export type GalleryPhotoClient = {
  id: string;
  photoUrl: string;
  caption: string | null;
};

export type TenantClientData = {
  id: string;
  slug: string;
  name: string;
  currency: Currency;
  timezone: string;
  locale: string;
  plan: string;
  status: string;
  trial_ends_at: string | null;
};

export type BrandingClientData = {
  logo_url: string | null;
  brand_primary: string;
  brand_glow: string;
  brand_deep: string;
  custom_domain: string | null;
};

export type SettingsClientData = {
  tax_rate_bp: number;
  legal_name: string | null;
  legal_address: string | null;
  // Profil salon (0008 migration)
  tagline: string | null;
  address_street: string | null;
  address_city: string | null;
  address_zip: string | null;
  branch: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  contact_website: string | null;
  contact_instagram: string | null;
  hours_text: string | null;
  /** Lien Google Maps personnalisé (épingle exacte du salon). Si NULL, l'UI
   *  client retombe sur une recherche automatique par adresse. */
  maps_url: string | null;
  /** Taux cashback en basis points (250 = 2,5 %). Default 250 si pas configuré. */
  cashback_rate_bp: number;
  /** Adresse expéditeur emails transactionnels custom (ex. noreply@aboodhairsalon.com).
   *  NULL = fallback noreply@system-aone.com. Nécessite domaine vérifié dans Resend. */
  email_from_address: string | null;
};

export type TenantSession = {
  /** Present for authenticated spaces (manager, cashier). Absent for public client space. */
  user?: { id: string; email: string };
  tenant: TenantClientData;
  branding: BrandingClientData;
  settings: SettingsClientData;
  /** Collections chargées depuis la DB (staff, services, produits, galerie). */
  collections: {
    staff: Staff[];
    services: Service[];
    products: Product[];
    gallery: GalleryPhotoClient[];
  };
};

const TenantContext = createContext<TenantSession | null>(null);

export function TenantProvider({ value, children }: { value: TenantSession; children: ReactNode }) {
  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

/**
 * Hook pour lire les données du tenant courant côté client.
 * Lance une erreur si appelé hors d'un `<TenantProvider>` —
 * indique un bug d'architecture (composant rendu sans guard auth).
 */
export function useTenant(): TenantSession {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error('useTenant() doit être utilisé dans un <TenantProvider> (layout /manager).');
  }
  return ctx;
}

/**
 * Variante safe — retourne null si pas dans un Provider.
 * Utile pour les composants partagés (ex. AppHeader) qui peuvent
 * apparaître AVANT login (où il n'y a pas de tenant).
 */
export function useTenantOrNull(): TenantSession | null {
  return useContext(TenantContext);
}

/**
 * Préfixe un path avec le slug du tenant courant.
 * Retourne le path inchangé si aucun tenant en contexte (mode démo / pages génériques).
 *
 * Usage : <Link href={useSalonPath('/manager')}>Direction</Link>
 */
export function useSalonPath(path: string): string {
  const tenant = useTenantOrNull();
  const slug = tenant?.tenant.slug;
  return slug ? `/${slug}${path}` : path;
}
