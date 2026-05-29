import 'server-only';
/**
 * Chargement du logo du salon — pour les pages de connexion.
 *
 * Single-tenant (Aboodhairsalon) : lecture de `tenant_branding.logo_url`
 * filtrée par SALON.tenantUuid (table éditée par le manager > Paramètres).
 * Le client admin est utilisé car les pages de connexion n'ont pas de session.
 *
 * Le fichier garde son nom historique `tenant-brand.ts` pour minimiser le
 * diff sur les imports — à renommer dans un cleanup pass futur.
 */
import { createAdminClient } from '@/db';
import { SALON } from '@/config/salon';

/** Retourne l'URL du logo du salon, ou null si non configuré.
 *  Le paramètre `_tenantId` est ignoré (legacy multi-tenant), conservé pour
 *  compat avec les call-sites qui passent `headers().get('x-tenant-id')`. */
export async function fetchTenantLogo(_tenantId?: string | null): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('tenant_branding')
    .select('logo_url')
    .eq('tenant_id', SALON.tenantUuid)
    .maybeSingle();
  // Override gérant > logo stable de config (jamais de logo manquant).
  return data?.logo_url ?? SALON.logoUrl;
}

/** Alias sémantique — préférer dans le nouveau code. */
export const fetchSalonLogo = fetchTenantLogo;
