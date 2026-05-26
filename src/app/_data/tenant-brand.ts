import 'server-only';
/**
 * Chargement du logo du salon — pour les pages de connexion.
 *
 * Single-tenant (Aboodhairsalon) : pas de tenant_id, lecture directe de la ligne
 * unique `salon_settings.logo_url`. Le client admin est utilisé car les pages
 * de connexion n'ont pas de session (RLS ne donnerait pas accès à la table).
 *
 * Le fichier garde son nom historique `tenant-brand.ts` pour minimiser le
 * diff sur les imports — à renommer dans un cleanup pass futur.
 */
import { createAdminClient } from '@/db';

/** Retourne l'URL du logo du salon, ou null si non configuré.
 *  Le paramètre `_tenantId` est ignoré (legacy multi-tenant), conservé pour
 *  compat avec les call-sites qui passent `headers().get('x-tenant-id')`. */
export async function fetchTenantLogo(_tenantId?: string | null): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin.from('salon_settings').select('logo_url').maybeSingle();
  return (data as { logo_url: string | null } | null)?.logo_url ?? null;
}

/** Alias sémantique — préférer dans le nouveau code. */
export const fetchSalonLogo = fetchTenantLogo;
