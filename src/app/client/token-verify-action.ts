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
import { verifyClientToken } from '../_lib/client-token';
import { SALON } from '@/config/salon';
import { setClientSession } from './client-session';

export type VerifyTokenResult =
  | { ok: true; phone: string; tenantId: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'tenantMismatch' };

/** Vérifie un token magic-link (`?t=`) contre le tenant unique
 *  (`SALON.tenantUuid`). Avant, on lisait `x-tenant-id` posé par le middleware
 *  — ce header n'existe plus dans le fork single-tenant, donc la vérification
 *  échouait toujours (lien magique cassé). En cas de succès on établit une
 *  SESSION (cookie httpOnly) : le lien email/QR connecte le client sans mot de
 *  passe (il a prouvé l'accès en recevant le lien). */
export async function verifyClientTokenAction(token: string): Promise<VerifyTokenResult> {
  const result = verifyClientToken(token, SALON.tenantUuid);
  if (!result) {
    // On ne distingue pas invalid vs expired vs cross-tenant côté UI pour
    // éviter de leak des infos via le message. Tous renvoient 'invalid'.
    return { ok: false, reason: 'invalid' };
  }
  await setClientSession(result.phone);
  return { ok: true, phone: result.phone, tenantId: result.tenantId };
}
