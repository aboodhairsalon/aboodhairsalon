/**
 * resolveFromHeader — résout l'expéditeur (header `From:`) pour les emails
 * transactionnels du salon.
 *
 * Single-tenant (Aboodhairsalon) — priorité :
 *  1. `salon_settings.email_from_address` (ex. `noreply@aboodhairsalon.com`)
 *  2. `process.env.RESEND_FROM_EMAIL`
 *  3. `noreply@aboodhairsalon.com` (fallback hardcodé sur le domaine du salon)
 *
 * Format retourné : `"Aboodhairsalon <noreply@aboodhairsalon.com>"` — Resend
 * accepte ce format display-name + addr.
 *
 * PRÉ-REQUIS DNS : pour que Resend accepte d'envoyer depuis aboodhairsalon.com,
 * le domaine DOIT être vérifié dans le dashboard Resend (DKIM + SPF + DMARC).
 * Sans vérif, Resend rejette l'envoi → email échoue silencieusement (loggé via
 * reportError). Le RDV/refund DB reste valide quoi qu'il arrive.
 *
 * Setup initial :
 *  1. Resend dashboard → Domains → Add Domain → aboodhairsalon.com
 *  2. Copier les 3 records DNS (DKIM, SPF, DMARC) dans IONOS
 *  3. Cliquer Verify (24h max propagation DNS)
 *  4. `salon_settings.email_from_address = noreply@aboodhairsalon.com`
 */
import { createAdminClient } from '@/db';
import { SALON } from '@/config/salon';

interface CacheEntry {
  fromAddress: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 60 * 1000;
let cache: CacheEntry | null = null;

const DEFAULT_FROM = `noreply@${new URL(SALON.url).hostname.replace(/^www\./, '')}`;

/**
 * Retourne le header `From:` complet (avec display name) pour Resend.
 *
 * Compat-shim avec l'ancienne API multi-tenant. `_tenantId` est ignoré
 * (le salon est implicite). `salonName` reste utilisé pour le display-name.
 *
 * @param _tenantId Ignoré (legacy multi-tenant). Passer n'importe quoi.
 * @param salonName Nom display pour le From: header. Si null, retourne juste l'adresse.
 */
export async function resolveFromHeader(
  _tenantId: string | null | undefined,
  salonName: string | null = SALON.name,
): Promise<string> {
  const addr = await resolveFromAddress();
  return salonName ? `${salonName} <${addr}>` : addr;
}

/** Variante qui retourne juste l'adresse email (sans display-name). */
export async function resolveFromAddress(): Promise<string> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.fromAddress;
  }

  let fromAddress = process.env['RESEND_FROM_EMAIL'] || DEFAULT_FROM;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const res = await admin.from('salon_settings').select('email_from_address').maybeSingle();
    const dbFrom = (res.data as { email_from_address: string | null } | null)?.email_from_address;
    if (dbFrom && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(dbFrom)) {
      fromAddress = dbFrom;
    }
  } catch {
    // Si la query échoue, on garde le fallback env. Pas critique.
  }

  cache = { fromAddress, expiresAt: Date.now() + CACHE_TTL_MS };
  return fromAddress;
}

/** Invalide le cache — à appeler depuis le manager après edit de l'adresse. */
export function clearFromAddressCache(): void {
  cache = null;
}
