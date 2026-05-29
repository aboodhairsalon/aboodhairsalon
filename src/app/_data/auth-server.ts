import 'server-only';
/**
 * Helpers auth + contexte salon côté serveur (RSC, Server Actions, Route Handlers).
 *
 * Différences MAJEURES avec System A multi-tenant :
 *  - Plus de résolution tenant (lecture x-tenant-id, JWT app_metadata.tenant_id, etc.)
 *  - Le contexte "tenant" est dérivé de la config statique `@/config/salon` + d'une
 *    SEULE ligne `salon_settings` (valeurs éditables par le gérant).
 *  - Le shape `TenantContext` est conservé pour minimiser le diff sur les
 *    server actions copiées depuis System A (ctx.tenant, ctx.branding,
 *    ctx.settings). À noter : `ctx.tenant.id` est désormais une constante
 *    (== SALON.slug), il ne doit plus servir à filtrer les requêtes.
 *  - L'autorisation se base UNIQUEMENT sur `auth.uid()` et le claim
 *    `app_metadata.role` posé à la création du compte (manager / cashier).
 *
 * Patterns d'usage :
 *   - `getCurrentUser()`  → lit le user sans redirection.
 *   - `requireAuth()`     → redirige vers /login si pas de session.
 *   - `requireTenant()`   → exige un manager (rôle 'manager' ou null/admin).
 *                           Conserve le nom legacy pour compat avec les
 *                           server actions copiées de System A.
 *   - `requireCashier()`  → exige un caissier (rôle 'cashier').
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { createAdminClient } from '@/db';
import { getServerSupabase } from './supabase-server';
import { SALON } from '@/config/salon';

/**
 * Forme du contexte rendu par `requireTenant()`.
 *
 * Reprend la shape historique de System A pour ne pas casser les call-sites
 * copiés. Les champs `tenant.*` et `branding.*` sont dérivés de SALON (config
 * statique), les champs `settings.*` viennent de la ligne unique `salon_settings`.
 *
 * @deprecated Le nom "TenantContext" est legacy — on devrait l'appeler
 *   `SalonContext` puisqu'il n'y a plus qu'un tenant. Renommage trivial à
 *   faire dans un cleanup pass, gardé pour minimiser le diff initial.
 */
export type TenantContext = {
  user: User;
  /** Identité du salon — VALEURS STATIQUES dérivées de @/config/salon. */
  tenant: {
    /** Slug — utilisé comme identifiant stable pour Storage keys, audit logs.
     *  N'est PLUS un UUID — c'est SALON.slug ('aboodhairsalon'). */
    id: string;
    slug: string;
    name: string;
    currency: string;
    timezone: string;
    /** Locale par défaut du back-office (FR). */
    locale: string;
    /** Conservé pour compat — toujours 'production'. */
    plan: string;
    /** Conservé pour compat — toujours 'active'. */
    status: string;
    /** Conservé pour compat — toujours null (pas de période d'essai). */
    trial_ends_at: string | null;
    /** Conservés pour compat — toujours null (pas de Stripe pour Aboodhairsalon). */
    stripe_customer_id: string | null;
    stripe_connect_account_id: string | null;
  };
  /** Branding — VALEURS STATIQUES dérivées de @/config/salon, sauf logo_url
   *  qui est uploadable via le manager (stocké en `salon_settings.logo_url`). */
  branding: {
    logo_url: string | null;
    brand_primary: string;
    brand_glow: string;
    brand_deep: string;
    /** Conservé pour compat — toujours null (mono-domain). */
    custom_domain: string | null;
  };
  /** Settings éditables par le gérant — lus depuis la ligne unique `salon_settings`.
   *  Si la ligne n'existe pas encore (premier boot), retourne les défauts. */
  settings: {
    tax_rate_bp: number;
    legal_name: string | null;
    legal_address: string | null;
    deposit_policy: unknown;
    cancellation_policy: unknown;
    business_hours: unknown;
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
    maps_url: string | null;
    cashback_rate_bp: number;
    /** Adresse expéditeur emails — fallback `RESEND_FROM_EMAIL` env si null. */
    email_from_address: string | null;
  };
};

/** Forme des défauts pour `settings` quand `salon_settings` n'a pas encore été
 *  initialisée (premier boot du salon). Valeurs cohérentes avec Aboodhairsalon. */
const SETTINGS_DEFAULTS: TenantContext['settings'] = {
  // 14% VAT Égypte. Conservé en base points (1400 = 14.00%). Override via manager.
  tax_rate_bp: 1400,
  legal_name: null,
  legal_address: null,
  deposit_policy: null,
  cancellation_policy: null,
  business_hours: [],
  tagline: SALON.tagline,
  address_street: SALON.address.street,
  address_city: SALON.address.city,
  address_zip: null,
  branch: null,
  contact_phone: SALON.contact.phone,
  contact_email: SALON.contact.email,
  contact_website: null,
  contact_instagram: SALON.contact.instagram,
  hours_text: null,
  maps_url: SALON.contact.googleMapsUrl || null,
  // 2.5% cashback par défaut (politique Aboodhairsalon).
  cashback_rate_bp: 250,
  email_from_address: null, // fallback RESEND_FROM_EMAIL
};

/**
 * Lit le user connecté. Retourne null si pas authentifié.
 * Ne redirige PAS — utilise `requireAuth()` pour ça.
 */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;
  return data.user;
}

/**
 * Garde-fou : si pas de session, redirige vers /login.
 * Retourne le User authentifié.
 *
 * En mono-app, le slug d'URL n'existe plus — toujours `/login` simple.
 */
export async function requireAuth(redirectPath?: string): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect(redirectPath ?? '/login');
  return user;
}

/**
 * Charge le contexte salon complet du user manager connecté.
 *
 * - Redirige vers /login si pas de session.
 * - Redirige vers /cashier si role='cashier' (l'espace direction est
 *   réservé aux gérants — symétrique de `requireCashier()`).
 * - Les valeurs tenant + branding sont STATIQUES (config), seul `settings`
 *   provient de la DB (ligne unique `salon_settings`).
 *
 * @deprecated Le nom "requireTenant" est legacy — devrait être renommé
 *   `requireManager` dans un cleanup pass. Gardé pour minimiser le diff.
 */
export async function requireTenant(): Promise<TenantContext> {
  const user = await requireAuth();

  // Garde de rôle : /manager est réservé aux gérants. Caissier → /cashier.
  const role = user.app_metadata?.['role'] as string | undefined;
  if (role === 'cashier') {
    redirect('/cashier');
  }

  // Source unique de vérité : tenant_settings + tenant_branding (les tables
  // éditées par le manager > Paramètres). Filtrées par SALON.tenantUuid (le
  // seul tenant). On lit les deux en parallèle.
  const supabase = await getServerSupabase();
  const [{ data: settingsRow }, { data: brandingRow }] = await Promise.all([
    supabase.from('tenant_settings').select('*').eq('tenant_id', SALON.tenantUuid).maybeSingle(),
    supabase
      .from('tenant_branding')
      .select('logo_url')
      .eq('tenant_id', SALON.tenantUuid)
      .maybeSingle(),
  ]);

  const s = settingsRow as Partial<TenantContext['settings']> | null;
  // Override gérant > logo stable de config — garantit le logo dans le header
  // manager + le brouillon Identité (donc un « Enregistrer » le ré-écrit au
  // lieu de le vider).
  const logoUrl =
    (brandingRow as { logo_url?: string | null } | null)?.logo_url ?? SALON.logoUrl;

  return {
    user,
    tenant: {
      id: SALON.tenantUuid, // UUID réel — sert aux inserts tenant_id + queries
      slug: SALON.slug,
      name: SALON.name,
      currency: SALON.currency,
      timezone: SALON.timezone,
      locale: 'fr',
      plan: 'production',
      status: 'active',
      trial_ends_at: null,
      stripe_customer_id: null,
      stripe_connect_account_id: null,
    },
    branding: {
      logo_url: logoUrl,
      brand_primary: SALON.brand.primary,
      brand_glow: SALON.brand.glow,
      brand_deep: SALON.brand.deep,
      custom_domain: null,
    },
    settings: {
      ...SETTINGS_DEFAULTS,
      ...(s ?? {}),
    },
  };
}

/**
 * Alias sémantique de `requireTenant()` — à utiliser dans le nouveau code.
 * `requireTenant()` reste exporté pour compat avec les server actions copiées
 * de System A.
 */
export const requireManager = requireTenant;

export type CashierContext = {
  user: User;
  /** Identifiant stable du salon (= SALON.slug). Conservé pour compat avec
   *  les server actions copiées (`tenantId` passé en arg de helpers). */
  tenantId: string;
  /** ID du staff (FK vers public.staff) — claim posé par createCashierAccess. */
  staffId: string;
  /** Slug du salon — conservé pour compat avec les URLs/redirections de logout. */
  slug: string;
};

/**
 * Garde de route /cashier — exige une session de rôle `cashier`.
 *
 * Comportement :
 *  - Pas de session → /cashier/login.
 *  - Session d'un autre rôle (Manager, super-admin) → /manager.
 *  - Compte caissier sans staff_id (claim manquant) → /cashier/login (compte
 *    corrompu : createCashierAccess pose toujours staff_id).
 *
 * Les claims sont lus depuis `app_metadata`. Plus de tenant_id (mono-tenant).
 */
export async function requireCashier(): Promise<CashierContext> {
  const user = await getCurrentUser();
  if (!user) redirect('/cashier/login');

  const role = user.app_metadata?.['role'] as string | undefined;
  if (role !== 'cashier') {
    redirect('/manager');
  }

  const staffId = user.app_metadata?.['staff_id'] as string | undefined;
  if (!staffId) {
    // Compte caissier sans claim staff_id — incohérent, on force re-login.
    redirect('/cashier/login');
  }

  return {
    user,
    tenantId: SALON.tenantUuid, // UUID réel — sert aux inserts/queries tenant_id
    staffId,
    slug: SALON.slug,
  };
}

/**
 * Garde « API protégée » — utilise depuis une Route Handler API qui doit
 * être appelée par un user authentifié (n'importe quel rôle). Retourne null
 * + status 401 plutôt qu'un redirect (les API JSON ne redirigent pas).
 */
export async function requireApiAuth(): Promise<User | null> {
  return getCurrentUser();
}

/**
 * Utilitaire pour lire le header `x-pathname` posé par le middleware.
 * Sert au i18n + à logger l'endpoint sur les actions critiques.
 */
export async function getPathname(): Promise<string | null> {
  const h = await headers();
  return h.get('x-pathname');
}

/** Conservé pour compat avec les call-sites qui font `ctx.tenant.id`. Inutile
 *  d'importer ailleurs — utiliser SALON directement. */
export function getSalonId(): string {
  return SALON.slug;
}

/** Création d'un client admin pour les Route Handlers qui doivent bypass RLS.
 *  Wrappé ici pour limiter les imports croisés. */
export { createAdminClient };
