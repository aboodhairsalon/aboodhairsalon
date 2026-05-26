/**
 * Rate limiting cross-region via Upstash Redis (Vercel KV-compatible).
 *
 * Pourquoi pas la Map en mémoire processus :
 *  - Vercel = serverless → chaque cold start a sa propre instance Map
 *  - Multi-régions → un attaquant peut alterner les régions pour bypasser
 *  - Aucune persistance des tentatives au-delà d'un timeout idle
 *
 * Upstash Redis (gratuit jusqu'à ~10k req/jour) résout les trois. Si pas
 * configuré (`UPSTASH_REDIS_REST_URL` / `_TOKEN` absent), on retombe sur
 * un fallback en mémoire — utile pour le dev local.
 *
 * Pattern : sliding window via `@upstash/ratelimit`. Trois limites pré-
 * configurées correspondant aux 3 surfaces actuelles (sales lookup,
 * booking public, email).
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

/** Cache module-level — instancier le client une seule fois par worker. */
let redisInstance: Redis | null = null;
let limitersInstance: {
  salesLookupPerPhone: Ratelimit;
  salesLookupPerIp: Ratelimit;
  bookingPerIp: Ratelimit;
  emailPerSale: Ratelimit;
  signupPerIp: Ratelimit;
  loginPerEmail: Ratelimit;
  loginPerIp: Ratelimit;
  cashierAdminPerUser: Ratelimit;
  managerReadPerUser: Ratelimit;
} | null = null;

function getRedis(): Redis | null {
  if (redisInstance) return redisInstance;
  const url = process.env['UPSTASH_REDIS_REST_URL'];
  const token = process.env['UPSTASH_REDIS_REST_TOKEN'];
  if (!url || !token) return null;
  redisInstance = new Redis({ url, token });
  return redisInstance;
}

function getLimiters() {
  if (limitersInstance) return limitersInstance;
  const redis = getRedis();
  if (!redis) return null;
  limitersInstance = {
    /** Sales lookup par (tenantId, phone) : 10 calls/min — protège un client
     *  légitime contre un spam accidentel (refresh, double-clic). */
    salesLookupPerPhone: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, '60 s'),
      prefix: 'rl:sales:phone',
      analytics: false,
    }),
    /** Sales lookup par (tenantId, ip) : 30 calls/min — bloque l'énumération
     *  phone-by-phone depuis une seule IP. */
    salesLookupPerIp: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(30, '60 s'),
      prefix: 'rl:sales:ip',
      analytics: false,
    }),
    /** Booking public par IP : 20/min — protège contre les bots qui spammeraient
     *  des fausses réservations (qui passeraient le pre-check tenant grâce
     *  à des UUIDs valides). */
    bookingPerIp: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(20, '60 s'),
      prefix: 'rl:booking:ip',
      analytics: false,
    }),
    /** Email reçu par saleId : 3/heure — défense en profondeur contre les
     *  loops de clic même si le claim atomique passe. Au-delà = signal de
     *  process buggué côté Caisse/Direction. */
    emailPerSale: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(3, '1 h'),
      prefix: 'rl:email:sale',
      analytics: false,
    }),
    /** Signup par IP : 3 inscriptions par HEURE. Bloque la création massive
     *  de fake tenants (squat de slugs proches de vrais salons pour phishing,
     *  saturation DB). Un utilisateur légitime créera 1 compte, jamais 4 en 1h. */
    signupPerIp: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(3, '1 h'),
      prefix: 'rl:signup:ip',
      analytics: false,
    }),
    /** Login par email : 5 tentatives par 15 min. Bloque le brute-force ciblé
     *  d'un compte spécifique. Supabase Auth a sa propre limite par projet
     *  (~30/min) mais elle est globale, pas par-email — un attaquant peut
     *  brute-forcer un compte sans atteindre la limite globale. */
    loginPerEmail: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, '15 m'),
      prefix: 'rl:login:email',
      analytics: false,
    }),
    /** Login par IP : 20 tentatives par 15 min. Bloque le credential-stuffing
     *  (tester N (email, password) pairs depuis une seule IP). */
    loginPerIp: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(20, '15 m'),
      prefix: 'rl:login:ip',
      analytics: false,
    }),
    /** Actions admin caissier (create/reset/revoke) par manager userId :
     *  10 par heure. Un gérant légitime fait 1-2 créations + 1-2 resets
     *  par mois. Si un compte manager est compromis, l'attaquant ne pourra
     *  pas spammer la création de 1000 comptes caissier (chaque compte
     *  serait un accès durable au tenant). Audit T3.1. */
    cashierAdminPerUser: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, '1 h'),
      prefix: 'rl:cashier:admin',
      analytics: false,
    }),
    /** Lectures Server Actions manager (dashboard, clients, products, etc.)
     *  par userId : 120 par minute. Un manager humain qui navigue déclenche
     *  ~10 reads par page ; à 120/min on autorise 12 navigations/min, large.
     *  Cette limite stoppe les boucles UI buggées + le scraping (manager
     *  authentifié qui pull en boucle pour exfiltrer la base). Audit T4.2. */
    managerReadPerUser: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(120, '1 m'),
      prefix: 'rl:manager:read',
      analytics: false,
    }),
  };
  return limitersInstance;
}

// =============================================================================
// Fallback en mémoire — utilisé quand UPSTASH_REDIS_REST_* est absent.
// Conserve la signature `Promise<boolean>` pour symétrie avec Upstash.
// =============================================================================

const fallbackBuckets = new Map<string, number[]>();
function fallbackCheck(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (fallbackBuckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    fallbackBuckets.set(key, arr);
    return false;
  }
  arr.push(now);
  fallbackBuckets.set(key, arr);
  return true;
}

// =============================================================================
// API publique — `Promise<boolean>` (true = autorisé, false = bloqué)
// =============================================================================

/** Limite par (tenantId, phone) : 10/min. */
export async function rlSalesPhone(tenantId: string, phone: string): Promise<boolean> {
  const limiters = getLimiters();
  const key = `${tenantId}::${phone}`;
  if (limiters) {
    const { success } = await limiters.salesLookupPerPhone.limit(key);
    return success;
  }
  return fallbackCheck(`p:${key}`, 10, 60_000);
}

/** Limite par (tenantId, ip) : 30/min. */
export async function rlSalesIp(tenantId: string, ip: string): Promise<boolean> {
  const limiters = getLimiters();
  const key = `${tenantId}::${ip}`;
  if (limiters) {
    const { success } = await limiters.salesLookupPerIp.limit(key);
    return success;
  }
  return fallbackCheck(`i:${key}`, 30, 60_000);
}

/** Limite par IP sur le booking public : 20/min. */
export async function rlBookingIp(ip: string): Promise<boolean> {
  const limiters = getLimiters();
  if (limiters) {
    const { success } = await limiters.bookingPerIp.limit(ip);
    return success;
  }
  return fallbackCheck(`b:${ip}`, 20, 60_000);
}

/** Limite par saleId pour les envois d'email : 3/heure. */
export async function rlEmailSale(saleId: string): Promise<boolean> {
  const limiters = getLimiters();
  if (limiters) {
    const { success } = await limiters.emailPerSale.limit(saleId);
    return success;
  }
  return fallbackCheck(`e:${saleId}`, 3, 60 * 60_000);
}

/** Limite signup par IP : 3/heure. Bloque la création massive de fake tenants. */
export async function rlSignupIp(ip: string): Promise<boolean> {
  const limiters = getLimiters();
  if (limiters) {
    const { success } = await limiters.signupPerIp.limit(ip);
    return success;
  }
  return fallbackCheck(`su:${ip}`, 3, 60 * 60_000);
}

/** Limite login par email : 5 tentatives/15min. Bloque le brute-force ciblé. */
export async function rlLoginEmail(email: string): Promise<boolean> {
  const limiters = getLimiters();
  if (limiters) {
    const { success } = await limiters.loginPerEmail.limit(email.toLowerCase());
    return success;
  }
  return fallbackCheck(`le:${email.toLowerCase()}`, 5, 15 * 60_000);
}

/** Limite login par IP : 20 tentatives/15min. Bloque le credential-stuffing. */
export async function rlLoginIp(ip: string): Promise<boolean> {
  const limiters = getLimiters();
  if (limiters) {
    const { success } = await limiters.loginPerIp.limit(ip);
    return success;
  }
  return fallbackCheck(`li:${ip}`, 20, 15 * 60_000);
}

/** Limite actions admin caissier par manager userId : 10/heure. Bloque le
 *  spam de création/reset/revoke en cas de compte manager compromis. */
export async function rlCashierAdmin(userId: string): Promise<boolean> {
  const limiters = getLimiters();
  if (limiters) {
    const { success } = await limiters.cashierAdminPerUser.limit(userId);
    return success;
  }
  return fallbackCheck(`ca:${userId}`, 10, 60 * 60_000);
}

/** Limite lectures Server Actions manager par userId : 120/min. Bloque
 *  les boucles UI buggées + le scraping par manager authentifié. */
export async function rlManagerRead(userId: string): Promise<boolean> {
  const limiters = getLimiters();
  if (limiters) {
    const { success } = await limiters.managerReadPerUser.limit(userId);
    return success;
  }
  return fallbackCheck(`mr:${userId}`, 120, 60_000);
}
