'use server';
/**
 * Server Actions — Web Push (PWA).
 *
 * Trois actions :
 *  - `getPushPublicKey()` : expose la VAPID public key au navigateur pour
 *    initier la souscription. Pas de secret côté client.
 *  - `subscribePush(subscription, role, userAgent)` : enregistre l'abonnement
 *    de cet appareil pour ce user/tenant. Idempotent (UNIQUE sur endpoint).
 *  - `unsubscribePush(endpoint)` : retire l'abonnement de cet appareil.
 *
 * L'envoi (`sendPushToTenant`) est aussi exposé pour que les hooks (ex.
 * createBookingPublic) puissent notifier les gérants en cas de nouvelle
 * réservation.
 *
 * Sécurité :
 *  - Toutes les routes exigent `requireAnyTenantRole()` — un user anonyme
 *    ne peut pas s'abonner aux notifications d'un salon.
 *  - L'envoi côté serveur charge tous les abonnés du tenant et nettoie les
 *    endpoints qui retournent 404/410 (subscription expirée).
 */
import webpush from 'web-push';
import { z } from 'zod';
import { createAdminClient } from '@/db';
import { SALON } from '@/config/salon';
import { getCurrentUser } from '../_data/auth-server';
import type { ManagerErrorCode, ManagerErrorValues } from './actions';

export type PushErrorCode = ManagerErrorCode | 'pushNotConfigured' | 'invalidSubscription';

export type PushResult =
  | { ok: true }
  | { ok: false; errorKey: PushErrorCode; errorValues?: ManagerErrorValues };

/** Configure web-push avec la paire VAPID. À appeler avant chaque envoi. */
function configureVapid(): { ok: boolean; publicKey: string | null } {
  const publicKey = process.env['VAPID_PUBLIC_KEY'] ?? null;
  const privateKey = process.env['VAPID_PRIVATE_KEY'] ?? null;
  // VAPID subject — domaine UNIFIÉ sur `system-aone.com` (domaine prod vérifié
  // DNS + Resend). `system-a.com` était une variante historique sans SPF/DKIM.
  const subject = process.env['VAPID_SUBJECT'] ?? 'mailto:noreply@system-aone.com';
  if (!publicKey || !privateKey) {
    return { ok: false, publicKey: null };
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    return { ok: true, publicKey };
  } catch {
    return { ok: false, publicKey: null };
  }
}

async function requireAnyTenantRole(): Promise<
  | { ok: true; userId: string; tenantId: string; role: 'manager' | 'cashier' | 'unknown' }
  | { ok: false; errorKey: ManagerErrorCode }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, errorKey: 'directionOnly' as const };
  const tenantId = user.app_metadata?.['tenant_id'] as string | undefined;
  if (!tenantId) return { ok: false, errorKey: 'tenantMissing' as const };
  const rawRole = user.app_metadata?.['role'] as string | undefined;
  const role: 'manager' | 'cashier' | 'unknown' =
    rawRole === 'cashier' ? 'cashier' : rawRole === 'manager' ? 'manager' : 'unknown';
  return { ok: true, userId: user.id, tenantId, role };
}

// =============================================================================
// Public key — exposée au navigateur pour pushManager.subscribe()
// =============================================================================

export type GetPushPublicKeyResult =
  | { ok: true; publicKey: string }
  | { ok: false; errorKey: PushErrorCode };

export async function getPushPublicKey(): Promise<GetPushPublicKeyResult> {
  const cfg = configureVapid();
  if (!cfg.ok || !cfg.publicKey) {
    return { ok: false, errorKey: 'pushNotConfigured' };
  }
  return { ok: true, publicKey: cfg.publicKey };
}

// =============================================================================
// Subscribe / Unsubscribe
// =============================================================================

/** Endpoints push service "officiels" — toute autre URL est rejetée pour
 *  empêcher un user authentifié d'enregistrer un endpoint pointant vers un
 *  serveur attaquant qui collecterait les payloads (fuite PII).
 *
 *  La liste mixte : `host exact` pour les endpoints canoniques (FCM, Apple,
 *  Mozilla) + `domain suffix` pour les services qui utilisent des sous-
 *  domaines régionaux (Microsoft WNS = wns2-*, etc.). */
const KNOWN_PUSH_EXACT_HOSTS = [
  'fcm.googleapis.com', // Chrome / Edge / Android (FCM)
  'updates.push.services.mozilla.com', // Firefox (autopush)
  'web.push.apple.com', // Safari iOS / macOS (APNS Web)
] as const;

/** Domaines parent pour les services qui rotent les sous-domaines (WNS). */
const KNOWN_PUSH_DOMAIN_SUFFIXES = [
  '.notify.windows.com', // Windows Push Notification Service (wns*-*.notify.windows.com)
] as const;

function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    if (u.protocol !== 'https:') return false;
    if (KNOWN_PUSH_EXACT_HOSTS.includes(u.hostname as (typeof KNOWN_PUSH_EXACT_HOSTS)[number])) {
      return true;
    }
    // Suffix match : `wns2-by3p.notify.windows.com` endsWith `.notify.windows.com`.
    return KNOWN_PUSH_DOMAIN_SUFFIXES.some((suffix) => u.hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

const SubscriptionSchema = z.object({
  endpoint: z.string().url().refine(isAllowedPushEndpoint, 'invalidSubscription'),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(200),
  }),
  userAgent: z.string().max(500).optional(),
});

export type SubscriptionInput = z.input<typeof SubscriptionSchema>;

export async function subscribePush(input: SubscriptionInput): Promise<PushResult> {
  const guard = await requireAnyTenantRole();
  if (!guard.ok) return guard;

  const parsed = SubscriptionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errorKey: 'invalidSubscription' };
  }
  const sub = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // upsert sur endpoint (UNIQUE) — idempotent et refresh des keys + tenant.
  // `tenant_id` est requis par le schéma hérité (NOT NULL) ; en single-tenant
  // c'est toujours la constante SALON.tenantUuid.
  const { error } = await admin.from('push_subscriptions').upsert(
    {
      tenant_id: SALON.tenantUuid,
      user_id: guard.userId,
      role: guard.role,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      user_agent: sub.userAgent ?? null,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' },
  );

  if (error) {
    return {
      ok: false,
      errorKey: 'dbError',
      errorValues: { message: (error as { message?: string }).message ?? '' },
    };
  }
  return { ok: true };
}

export async function unsubscribePush(endpoint: string): Promise<PushResult> {
  const guard = await requireAnyTenantRole();
  if (!guard.ok) return guard;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { error } = await admin
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('user_id', guard.userId) // garde : on supprime que ses propres rows
    ; // double garde défense en profondeur

  if (error) {
    return {
      ok: false,
      errorKey: 'dbError',
      errorValues: { message: (error as { message?: string }).message ?? '' },
    };
  }
  return { ok: true };
}

// =============================================================================
// Envoi push — utilisable depuis n'importe quel hook serveur
// =============================================================================

export interface PushPayload {
  title: string;
  body: string;
  /** URL ouverte au clic. Défaut `/manager`. */
  url?: string;
  /** Override de l'icône (défaut : /brand/icon-192.png). */
  icon?: string;
  /** Tag — déduplique les notifs (mêmes tag = remplace au lieu de empiler). */
  tag?: string;
}

/**
 * Envoie le payload à tous les abonnés d'un tenant, optionnellement filtré
 * par rôle. Les endpoints en erreur 404/410 sont supprimés (expired).
 *
 * **Sécurité critique** : cette Server Action est exportée, donc appelable
 * par n'importe quel browser via POST. Sans garde, un attaquant peut spammer
 * les push de n'importe quel salon (« Cliquez ici pour valider votre paiement »).
 * On exige donc que l'appelant ait une session valide + que son `tenant_id`
 * matche celui passé en paramètre, sauf si l'appelant est un autre Server
 * Action serveur-side (cas du hook `createBookingPublic` qui notifie les
 * managers d'un tenant publiquement résolu via le middleware). Pour ce cas,
 * on accepte aussi le header `x-tenant-id` injecté par le middleware comme
 * preuve de contexte tenant.
 */
export async function sendPushToTenant(
  tenantId: string,
  payload: PushPayload,
  filter?: { role?: 'manager' | 'cashier' },
): Promise<{ ok: true; sent: number; pruned: number } | { ok: false; errorKey: PushErrorCode }> {
  // Garde single-tenant : il n'existe qu'un seul tenant (SALON.tenantUuid).
  // Tout appel ciblant une autre valeur est rejeté (défense anti-spam : un
  // browser ne doit pas pouvoir pousser des notifs sur un tenantId arbitraire).
  // Le header `x-tenant-id` du middleware multi-tenant n'existe plus dans ce
  // fork ; le booking public appelle cette action avec SALON.tenantUuid en dur.
  if (tenantId !== SALON.tenantUuid) {
    return { ok: false, errorKey: 'tenantNotAuthorized' };
  }

  const cfg = configureVapid();
  if (!cfg.ok) return { ok: false, errorKey: 'pushNotConfigured' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  let q = admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    ;
  if (filter?.role) q = q.eq('role', filter.role);
  const { data, error } = await q;

  if (error) {
    return { ok: false, errorKey: 'dbError' };
  }
  const rows = (data as { id: string; endpoint: string; p256dh: string; auth: string }[]) ?? [];
  if (rows.length === 0) return { ok: true, sent: 0, pruned: 0 };

  const body = JSON.stringify(payload);
  let sent = 0;
  const expiredIds: string[] = [];

  await Promise.all(
    rows.map(async (r) => {
      try {
        await webpush.sendNotification(
          { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
          body,
          { TTL: 60 * 60 * 24 }, // 24 h
        );
        sent += 1;
      } catch (e) {
        const statusCode = (e as { statusCode?: number }).statusCode;
        // 410 Gone et 404 Not Found = abonnement expiré côté push service
        if (statusCode === 410 || statusCode === 404) {
          expiredIds.push(r.id);
        }
      }
    }),
  );

  if (expiredIds.length > 0) {
    await admin.from('push_subscriptions').delete().in('id', expiredIds);
  }

  return { ok: true, sent, pruned: expiredIds.length };
}

/** Compte des abonnés d'un tenant (utile pour l'UI Paramètres). */
export async function countPushSubscriptions(): Promise<
  { ok: true; total: number; myCount: number } | { ok: false; errorKey: PushErrorCode }
> {
  const guard = await requireAnyTenantRole();
  if (!guard.ok) return guard;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const [totalRes, myRes] = await Promise.all([
    admin
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      ,
    admin
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', guard.userId),
  ]);

  return {
    ok: true,
    total: (totalRes.count as number) ?? 0,
    myCount: (myRes.count as number) ?? 0,
  };
}
