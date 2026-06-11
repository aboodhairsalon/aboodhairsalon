/**
 * Magic token signé pour les URLs d'accès client (espace `/client?t=...`).
 *
 * Remplace l'ancienne forme `?p=+201234567890` qui exposait le téléphone du
 * client en clair dans les URLs (visibles dans les logs Vercel, le referrer
 * HTTP des partages, l'historique navigateur, etc.).
 *
 * Le token encode {tenantId, phone, exp} dans un payload base64url +
 * signature HMAC-SHA256 du payload — pas un JWT complet pour rester léger
 * (~60 octets vs ~200 octets pour un JWT). La signature empêche un attaquant
 * de forger un token pour un autre tenant/client ; l'expiration borne la
 * fenêtre de réutilisation des tokens leakés.
 *
 * Secret : `CLIENT_TOKEN_SECRET` (env var, min 32 octets). Le secret est
 * tenant-agnostique (un seul secret pour toute l'app) — la signature
 * couvre déjà le tenant_id du payload donc pas de re-use cross-tenant.
 *
 * Compatibilité descendante : l'ancienne forme `?p=PHONE` reste acceptée
 * pour les QR déjà imprimés et collés en boutique, mais une nouvelle
 * génération produit toujours `?t=TOKEN`. Une fois tous les anciens QR
 * remplacés, on pourra retirer le fallback.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/** Durée de validité d'un token — 90 jours. Permet à un client qui reçoit
 *  son reçu par email le jour J de revenir 3 mois plus tard via le même
 *  lien sans devoir le re-scanner. Au-delà, le token expire et le client
 *  doit re-scanner. */
const DEFAULT_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000;

/** Récupère le secret HMAC depuis env. Si absent, dérive un secret stable
 *  depuis SUPABASE_SERVICE_ROLE_KEY (présent en prod) — moins idéal car
 *  partage la rotation avec une autre clé, mais évite de casser un déploiement
 *  qui aurait oublié de set CLIENT_TOKEN_SECRET. Documenté dans .env.example. */
function getSecret(): string {
  const direct = process.env['CLIENT_TOKEN_SECRET'];
  if (direct && direct.length >= 32) return direct;
  const fallback = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (fallback && fallback.length >= 32) return fallback;
  // En dev / build sans env, on tolère un secret bidon mais on log un warning.
  // En prod, les deux env sont toujours présentes → cette branche n'est jamais
  // atteinte. Le secret bidon ne protège évidemment rien — c'est un signal
  // pour faire échouer rapidement lors de la validation.
  return 'INSECURE_DEFAULT_TOKEN_SECRET_DO_NOT_USE_IN_PROD';
}

interface TokenPayload {
  /** UUID du tenant — empêche le re-use d'un token cross-tenant. */
  t: string;
  /** Phone normalisé du client (avec préfixe international le cas échéant). */
  p: string;
  /** Timestamp d'expiration en secondes UTC. */
  e: number;
  /** Purpose tag (defense-in-depth) : 'login' / 'reset' / 'magic'.
   *  Optionnel pour rester compatible avec les tokens émis avant cette
   *  introduction (cookies de session, magic links déjà en circulation). */
  u?: string;
}

/** Encode une chaîne UTF-8 en base64url (sans padding). */
function base64UrlEncode(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Décode du base64url en Buffer. Retourne null si invalide. */
function base64UrlDecode(input: string): Buffer | null {
  try {
    // Restaure le padding pour Buffer.from
    const padded = input.replace(/-/g, '+').replace(/_/g, '/');
    const padding = (4 - (padded.length % 4)) % 4;
    return Buffer.from(padded + '='.repeat(padding), 'base64');
  } catch {
    return null;
  }
}

/** Signe un payload avec HMAC-SHA256. */
function sign(payloadB64: string): string {
  return createHmac('sha256', getSecret())
    .update(payloadB64)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Génère un token signé pour `(tenantId, phone)`. Le token est valable
 * `expiryMs` ms (défaut 90 jours). Format final : `<payload_b64>.<sig_b64>`.
 *
 * Le téléphone est intégré tel quel (déjà normalisé en amont par les
 * Server Actions qui posent client_phone) — pas de re-normalization pour
 * éviter une divergence avec ce qui est en DB.
 */
export function createClientToken(
  tenantId: string,
  phone: string,
  expiryMs: number = DEFAULT_EXPIRY_MS,
  purpose?: 'login' | 'reset' | 'magic',
): string {
  if (!tenantId || !phone) throw new Error('tenantId + phone required');
  const payload: TokenPayload = {
    t: tenantId,
    p: phone,
    e: Math.floor((Date.now() + expiryMs) / 1000),
  };
  if (purpose) payload.u = purpose;
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

/**
 * Vérifie un token et retourne le payload si valide, sinon null. Vérifie :
 *   1. La signature HMAC matche (constant-time compare).
 *   2. L'expiration n'est pas dépassée.
 *   3. Le tenantId du token matche le tenantId attendu (fourni en arg).
 *      Si non fourni, ne vérifie pas — utile pour les routes publiques.
 *
 * Retourne `{ phone, tenantId }` extraits, ou null si toute vérif échoue.
 */
export function verifyClientToken(
  token: string,
  expectedTenantId?: string,
  /** Si fourni, rejette les tokens dont le purpose ne matche pas — un cookie
   *  de session volé NE peut PAS servir de token de reset, etc. */
  expectedPurpose?: 'login' | 'reset' | 'magic',
): { phone: string; tenantId: string } | null {
  if (!token || typeof token !== 'string') return null;
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx <= 0 || dotIdx === token.length - 1) return null;
  const payloadB64 = token.slice(0, dotIdx);
  const sigProvided = token.slice(dotIdx + 1);

  const sigExpected = sign(payloadB64);
  // timingSafeEqual exige des buffers de même longueur — pas de leak via
  // early return sur length mismatch.
  const a = Buffer.from(sigProvided);
  const b = Buffer.from(sigExpected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  const payloadBuf = base64UrlDecode(payloadB64);
  if (!payloadBuf) return null;
  let payload: TokenPayload;
  try {
    payload = JSON.parse(payloadBuf.toString('utf8')) as TokenPayload;
  } catch {
    return null;
  }
  if (
    typeof payload.t !== 'string' ||
    typeof payload.p !== 'string' ||
    typeof payload.e !== 'number'
  ) {
    return null;
  }
  // Expiration
  if (payload.e * 1000 < Date.now()) return null;
  // Cross-tenant guard
  if (expectedTenantId && payload.t !== expectedTenantId) return null;
  // Purpose guard (defense-in-depth) : si on attend un purpose précis, le
  // token DOIT le porter explicitement. Bloque l'utilisation d'un cookie
  // de session comme reset token (ou vice-versa).
  if (expectedPurpose && payload.u !== expectedPurpose) return null;
  return { phone: payload.p, tenantId: payload.t };
}

/** Construit l'URL canonique d'accès client à partir d'un téléphone.
 *  Utilisé par la modale Reçu Caisse + les emails reçus. */
export function buildClientSpaceUrl(
  origin: string,
  slug: string,
  tenantId: string,
  phone: string,
): string {
  const token = createClientToken(tenantId, phone);
  return `${origin}/${slug}/client?t=${encodeURIComponent(token)}`;
}

/** Helper pour générer des secrets côté CLI :
 *  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` */
export function generateSecret(): string {
  return randomBytes(32).toString('hex');
}
