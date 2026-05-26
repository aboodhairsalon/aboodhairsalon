'use server';
/**
 * Vérification serveur des tokens d'accès client (magic links signés).
 *
 * Le secret HMAC est strictement serveur-side ; le browser ne peut PAS
 * faire la vérification. On expose donc cette Server Action qui prend le
 * token brut (depuis l'URL `?t=...`) et retourne le `phone` extrait si
 * la signature + expiration + tenantId matchent.
 *
 * Utilisée par client/page.tsx au montage pour hydrater l'état initial
 * (phone + localStorage) sans jamais avoir le téléphone en clair côté URL.
 */
import { headers } from 'next/headers';
import { verifyClientToken } from '../_lib/client-token';

export type VerifyTokenResult =
  | { ok: true; phone: string; tenantId: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'tenantMismatch' };

/** Vérifie le token contre le tenant résolu par le middleware. Le tenantId
 *  attendu est lu du header `x-tenant-id` (posé par le middleware ET purgé
 *  des entrants — cf. middleware.ts purge). Si le tenant est absent (page
 *  publique inaccessible), on rejette. */
export async function verifyClientTokenAction(token: string): Promise<VerifyTokenResult> {
  const h = await headers();
  const expectedTenantId = h.get('x-tenant-id');
  if (!expectedTenantId) {
    return { ok: false, reason: 'tenantMismatch' };
  }
  const result = verifyClientToken(token, expectedTenantId);
  if (!result) {
    // On ne distingue pas invalid vs expired vs cross-tenant côté UI pour
    // éviter de leak des infos via le message. Tous renvoient 'invalid'.
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, phone: result.phone, tenantId: result.tenantId };
}
