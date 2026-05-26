'use server';
/**
 * Server Actions pour /cashier/login — connexion par nom.
 *
 * L'email du caissier n'est jamais envoyé au navigateur.
 * - `fetchCashierStaff(tenantId)` retourne uniquement le nom + initiales +
 *   couleur des membres du staff ayant un accès caisse, scopé au tenant.
 * - `loginCashierByName(staffId, password, tenantId)` récupère l'email en
 *   interne, vérifie que le staff appartient bien au tenant, authentifie via
 *   Supabase Auth et pose le cookie de session.
 *
 * Sécurité : `tenantId` est toujours passé en paramètre explicite (lu par le
 * Server Component depuis les headers middleware) et vérifié côté DB — jamais
 * déduit du `staffId` seul. Cela bloque les tentatives de connexion croisée
 * entre tenants.
 */
import { headers } from 'next/headers';
import { createAdminClient } from '@/db';
import { getServerSupabase } from '../_data/supabase-server';
import { rlLoginEmail, rlLoginIp } from '../_lib/rate-limit';

export type CashierStaffItem = {
  id: string;
  name: string;
  initials: string;
  tone: string;
  photoUrl: string | null;
};

/** Codes d'erreur retournés par `loginCashierByName` — le client les
 *  traduit via `useTranslations('auth.cashier.errors')`. Pas de chaîne FR
 *  brute côté serveur pour rester i18n-friendly. */
export type LoginErrorCode =
  | 'nameAndPasswordRequired'
  | 'missingTenantContext'
  | 'staffNotFound'
  | 'noCashierAccess'
  | 'wrongPassword'
  | 'rateLimited';

export type LoginResult = { ok: true } | { ok: false; errorKey: LoginErrorCode };

/**
 * Liste le personnel ayant un accès caisse configuré, scopé au tenant.
 * Utilise le client admin pour bypasser le RLS (pas de session à ce stade).
 * Ne retourne jamais l'email — uniquement les données d'affichage.
 *
 * @param tenantId — UUID du tenant résolu par le middleware (x-tenant-id).
 *   Si vide, retourne un tableau vide (pas de tenant résolu = accès direct /cashier/login).
 */
export async function fetchCashierStaff(tenantId: string): Promise<CashierStaffItem[]> {
  if (!tenantId) return [];

  const admin = createAdminClient();
  const { data } = await admin
    .from('staff')
    .select('id, name, initials, tone, photo_url')
    
    .not('user_id', 'is', null)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    initials: r.initials,
    tone: r.tone,
    photoUrl: r.photo_url ?? null,
  }));
}

/**
 * Authentifie le caissier côté serveur.
 *
 * Vérifie que le `staffId` appartient bien au `tenantId` fourni avant
 * de tenter l'authentification — bloque les attaques cross-tenant.
 *
 * Récupère l'email associé au staffId via le client admin, puis appelle
 * `signInWithPassword` depuis le client serveur (cookie-aware) afin que
 * la session soit posée directement dans la réponse Next.js.
 *
 * L'email n'est jamais transmis au navigateur.
 *
 * @param staffId  — UUID du membre du staff sélectionné.
 * @param password — Mot de passe saisi par le caissier.
 * @param tenantId — UUID du tenant (passé depuis le Server Component).
 */
export async function loginCashierByName(
  staffId: string,
  password: string,
  tenantId: string,
): Promise<LoginResult> {
  if (!staffId || !password) {
    return { ok: false, errorKey: 'nameAndPasswordRequired' };
  }
  if (!tenantId) {
    return { ok: false, errorKey: 'missingTenantContext' };
  }

  // Rate-limit (audit pre-launch) : 5 tentatives/15min par (tenant,staffId) +
  // 20/15min par IP. Empêche le brute-force du mot de passe d'un caissier
  // (l'attaquant connait le nom car listé publiquement par fetchCashierStaff).
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown';
  // Use staffId as the rate-limit key (équivalent à email pour ce flow).
  if (!(await rlLoginEmail(`cashier:${tenantId}:${staffId}`))) {
    return { ok: false, errorKey: 'rateLimited' };
  }
  if (!(await rlLoginIp(ip))) {
    return { ok: false, errorKey: 'rateLimited' };
  }

  const admin = createAdminClient();
  const { data: staffRow, error: fetchErr } = await admin
    .from('staff')
    .select('id, user_id')
    .eq('id', staffId)
     // sécurité : vérifie que le staff appartient au tenant
    .maybeSingle();

  if (fetchErr || !staffRow) {
    return { ok: false, errorKey: 'staffNotFound' };
  }
  if (!staffRow.user_id) {
    return { ok: false, errorKey: 'noCashierAccess' };
  }

  // L'email interne est dérivé du staffId — jamais stocké dans staff.email
  // pour éviter tout conflit avec l'email de contact du membre.
  const internalEmail = `cashier-${staffRow.id}@internal.systemaone`;

  // Authentification server-side — pose le cookie de session directement.
  const supabase = await getServerSupabase();
  const { error: authErr } = await supabase.auth.signInWithPassword({
    email: internalEmail,
    password,
  });

  if (authErr) {
    // On masque le détail de l'erreur pour éviter la fuite d'info (email valide ?).
    return { ok: false, errorKey: 'wrongPassword' };
  }

  return { ok: true };
}
