import 'server-only';
/**
 * Session client — cookie httpOnly porteur du token signé (phone + tenant).
 *
 * C'est LA source de vérité de l'identité client côté serveur. Avant, les
 * Server Actions de lecture acceptaient un `phone` envoyé par le navigateur
 * et le servaient sans vérification → n'importe qui pouvait lire le compte
 * d'autrui en passant son numéro. Désormais :
 *
 *   1. La connexion (mot de passe) OU le lien magique `?t=` appellent
 *      `setClientSession(phone)` → pose un cookie httpOnly signé.
 *   2. Toutes les lectures de données client dérivent le téléphone de
 *      `getAuthedClientPhone()` (cookie vérifié) — jamais d'un paramètre client.
 *
 * Le cookie httpOnly n'est pas lisible en JS (anti-XSS) ; sa valeur est le
 * token HMAC existant (cf. `_lib/client-token.ts`), donc infalsifiable sans
 * le secret serveur.
 */
import { cookies } from 'next/headers';
import { SALON } from '@/config/salon';
import { createClientToken, verifyClientToken } from '../_lib/client-token';

/** Nom du cookie de session client. Préfixe `abd_` (Aboodhairsalon). */
const COOKIE = 'abd_client_session';
/** 90 jours — aligné sur l'expiry par défaut du token signé. */
const MAX_AGE_S = 90 * 24 * 60 * 60;

/**
 * Pose le cookie de session pour `phone`. À appeler UNIQUEMENT depuis une
 * Server Action / Route Handler (Next n'autorise `cookies().set` que là).
 * Le téléphone passé ici a déjà été authentifié (mot de passe vérifié, ou
 * token magic-link valide) — cette fonction ne fait que matérialiser la session.
 */
export async function setClientSession(phone: string): Promise<void> {
  const token = createClientToken(SALON.tenantUuid, phone);
  const c = await cookies();
  c.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_S,
  });
}

/**
 * Téléphone du client authentifié, ou `null` si pas de session valide.
 * SOURCE DE VÉRITÉ pour toutes les lectures de données client. Vérifie la
 * signature + l'expiration + le tenant du token porté par le cookie.
 */
export async function getAuthedClientPhone(): Promise<string | null> {
  const c = await cookies();
  const token = c.get(COOKIE)?.value;
  if (!token) return null;
  const res = verifyClientToken(token, SALON.tenantUuid);
  return res?.phone ?? null;
}

/** Supprime le cookie de session (déconnexion). À appeler depuis une
 *  Server Action / Route Handler. */
export async function clearClientSession(): Promise<void> {
  const c = await cookies();
  c.delete(COOKIE);
}
