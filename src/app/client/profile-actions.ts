'use server';
/**
 * Server Actions — profils clients et fidélité.
 *
 * Identifiant client : (tenant_id, phone). Aucune session Auth n'est requise
 * du côté client — on utilise le client admin pour bypasser le RLS.
 * Le tenant_id est toujours transmis explicitement depuis le contexte tenant.
 *
 * Points de fidélité : 1 point par EGP dépensé.
 *   points = Math.floor( Σ amount_cents / 100 )
 * sur les bookings paid=true, status='done', client_phone=phone.
 */
import { createAdminClient } from '@/db';
import { SALON } from '@/config/salon';
import { getAuthedClientPhone } from './client-session';
import { getCurrentUser } from '../_data/auth-server';
import { rlSalesIp, rlSalesPhone } from '../_lib/rate-limit';
import type { ClientErrorCode, ClientErrorValues } from './review-actions';

// Réutilise les codes ClientErrorCode définis dans review-actions pour rester
// homogène (un seul namespace `client.errors.*` côté catalogue).
type ErrResult = { ok: false; errorKey: ClientErrorCode; errorValues?: ClientErrorValues };

/** Garde minimaliste : exige que l'appelant soit authentifié et appartienne
 *  au tenant ciblé. Utilisé sur les actions sensibles (recherche, création)
 *  appelées depuis l'espace Caisse ou Direction. Les actions purement
 *  publiques (getClientProfile, upsertClientProfile via QR) ne passent
 *  PAS par cette garde — elles sont accessibles aux visiteurs anonymes. */
async function requireSameTenant(tenantId: string): Promise<{ ok: true } | ErrResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, errorKey: 'authRequired' };
  // Single-tenant : tout staff authentifié (manager/cashier) est autorisé. Le
  // claim app_metadata.tenant_id n'est pas posé sur les comptes caissier — s'y
  // fier bloquait la recherche client en caisse. `tenantId` reste dans la
  // signature pour la compat des call-sites mais l'autorisation est par rôle.
  void tenantId;
  const role = user.app_metadata?.['role'] as string | undefined;
  if (role && role !== 'manager' && role !== 'cashier') {
    return { ok: false, errorKey: 'tenantNotAuthorized' };
  }
  return { ok: true };
}

// ─── Types publics ───────────────────────────────────────────────────────────

export type ClientProfileData = {
  phone: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null; // 'YYYY-MM-DD' ou null
  email: string | null;
};

export type GetProfileResult =
  | {
      ok: true;
      exists: boolean;
      profile: ClientProfileData;
      /** Points de fidélité accumulés (= 1 point par EGP dépensé). Source
       *  unique pour le calcul du cashback côté UI. */
      points: number;
      /** Cashback gagné en centimes de la devise du tenant. Calcul serveur
       *  unique : `Math.round(totalSpentCents × CASHBACK_RATE)`. Affiché
       *  formaté côté UI via `useFmtMoney`. */
      cashbackCents: number;
    }
  | ErrResult;

/**
 * Taux cashback par défaut (2,5 %) en basis points si `tenant_settings`
 * n'a pas encore de `cashback_rate_bp` configuré (cas legacy / nouvelle
 * installation). Maintenant chaque salon peut configurer son taux dans
 * /manager?tab=settings → champ « Taux cashback ».
 *
 * Borne haute DB = 1500 bp (15 %) — au-delà ce serait une promo absurde.
 */
const DEFAULT_CASHBACK_RATE_BP = 250;

export type SaveProfileResult = { ok: true } | ErrResult;

// ─── getClientProfile ────────────────────────────────────────────────────────

/**
 * Charge le profil et calcule les points de fidélité pour (tenantId, phone).
 * Retourne un profil vide (toutes propriétés null) si aucune ligne n'existe
 * encore — cela permet d'afficher le formulaire de création dès le premier accès.
 */
export async function getClientProfile(tenantId: string, phone: string): Promise<GetProfileResult> {
  if (!tenantId || !phone?.trim()) {
    return { ok: false, errorKey: 'missingParams' };
  }

  // 🔒 Source de vérité : le téléphone vient du COOKIE de session vérifié,
  // jamais du paramètre reçu (forgeable). Le paramètre est ignoré.
  const authedPhone = await getAuthedClientPhone();
  if (!authedPhone) return { ok: false, errorKey: 'authRequired' };
  void phone;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const normalizedPhone = authedPhone;

  // Profil + cashback déjà utilisé
  const { data: row, error: profileErr } = await admin
    .from('client_profiles')
    .select('phone, first_name, last_name, date_of_birth, email, cashback_redeemed_cents')
    
    .eq('phone', normalizedPhone)
    .maybeSingle();

  if (profileErr) {
    return {
      ok: false,
      errorKey: 'dbError',
      errorValues: { message: (profileErr as { message?: string }).message ?? '' },
    };
  }

  // Taux cashback du tenant (basis points → ratio). Fallback 250 (2,5 %)
  // si la colonne n'existe pas encore — défensif vis-à-vis des envs où la
  // migration 0028 ne serait pas appliquée.
  const tenantSettingsRes = await admin
    .from('tenant_settings')
    .select('cashback_rate_bp')
    
    .maybeSingle();
  const cashbackRateBp =
    (tenantSettingsRes.data as { cashback_rate_bp?: number } | null)?.cashback_rate_bp ??
    DEFAULT_CASHBACK_RATE_BP;

  // Points : somme des montants des RDV payés ET des ventes directes (POS).
  // On totalise les deux sources pour que :
  //   - Les RDV encaissés (payBooking) accordent des points
  //   - Les ventes directes (createDirectSale) accordent aussi des points
  // Sinon un client walk-in qui paye au comptoir ne cumulerait jamais de points.
  // Pour les RDV on filtre par paid=true (l'encaissement crée aussi un sale
  // mais paid=true est suffisant). Pour les sales on EXCLUT explicitement les
  // ventes en statut `refunded`/`voided` — sinon une vente remboursée
  // continuerait à créditer des points fidélité (faille comptable).
  const [bookingsRes, salesRes] = await Promise.all([
    admin
      .from('bookings')
      .select('amount_cents')
      
      .eq('client_phone', normalizedPhone)
      .eq('paid', true),
    admin
      .from('sales')
      .select('total_cents, booking_id, status')
      
      .eq('client_phone', normalizedPhone)
      .eq('status', 'completed'), // exclut refunded / voided
  ]);

  // Toutes les bookings payés (peu importe que la vente associée ait été
  // remboursée par la suite — dans ce cas le trigger DB a déjà rétro-débité
  // les compteurs côté `clients`). On reste cohérent : on compte le credit
  // de fidélité au même endroit que le total dépensé.
  const bookingsCents = ((bookingsRes.data as { amount_cents: number }[] | null) ?? []).reduce(
    (acc, r) => acc + (r.amount_cents ?? 0),
    0,
  );
  // Ne compter que les ventes directes (sans booking_id) — sinon les RDV
  // déjà comptés via `bookings.amount_cents` seraient doublonnés (payBooking
  // crée à la fois `bookings.paid=true` et un row dans `sales`).
  const directSalesCents = (
    (salesRes.data as { total_cents: number; booking_id: string | null }[] | null) ?? []
  )
    .filter((r) => !r.booking_id)
    .reduce((acc, r) => acc + (r.total_cents ?? 0), 0);

  const totalSpentCents = bookingsCents + directSalesCents;
  const points = Math.floor(totalSpentCents / 100);
  // Cashback gagné = total dépensé × taux du tenant (en basis points).
  // Round() pour éviter les flottants. Le solde DISPONIBLE = earned - redeemed
  // ce qui est ce qu'on veut afficher au client (le solde utilisable).
  const cashbackEarnedCents = Math.round((totalSpentCents * cashbackRateBp) / 10000);
  const cashbackRedeemedCents =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((row as any)?.cashback_redeemed_cents as number | null | undefined) ?? 0;
  // Garde-fou : si pour une raison X le redeemed dépasse l'earned (peu
  // probable mais possible si le taux du tenant a baissé), on clamp à 0
  // pour ne jamais afficher un solde négatif côté client.
  const cashbackCents = Math.max(0, cashbackEarnedCents - cashbackRedeemedCents);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = row as any;
  const profile: ClientProfileData = row
    ? {
        phone: normalizedPhone,
        firstName: (r.first_name as string | null) ?? null,
        lastName: (r.last_name as string | null) ?? null,
        dateOfBirth: (r.date_of_birth as string | null) ?? null,
        email: (r.email as string | null) ?? null,
      }
    : { phone: normalizedPhone, firstName: null, lastName: null, dateOfBirth: null, email: null };

  return { ok: true, exists: row !== null, profile, points, cashbackCents };
}

// ─── getClientProfileByEmail ────────────────────────────────────────────────

/**
 * Charge le profil et les points du client connecté.
 *
 * SÉCURITÉ — Le paramètre `email` est désormais IGNORÉ : l'identité provient
 * exclusivement du cookie de session vérifié (`getAuthedClientPhone`). On
 * délègue ensuite à `getClientProfile(tenantId, phoneDeLaSession)` — pas de
 * duplication de la logique de fidélité, et aucun moyen de lire le profil
 * d'autrui en passant son email. La signature est conservée pour la compat
 * des call-sites existants.
 */
export async function getClientProfileByEmail(
  tenantId: string,
  email: string,
): Promise<GetProfileResult> {
  if (!tenantId || !email?.trim()) {
    return { ok: false, errorKey: 'missingParams' };
  }

  // 🔒 Source de vérité : le téléphone vient du COOKIE de session vérifié,
  // jamais du paramètre reçu (forgeable). Le paramètre est ignoré.
  const authedPhone = await getAuthedClientPhone();
  if (!authedPhone) return { ok: false, errorKey: 'authRequired' };
  void email;
  // La session est la source de vérité : on délègue au lookup par téléphone.
  return getClientProfile(tenantId, authedPhone);
}

// ─── checkClientPhoneAvailable ──────────────────────────────────────────────

export type PhoneAvailabilityResult =
  | { ok: true; available: true }
  | { ok: true; available: false; maskedEmail: string | null }
  | ErrResult;

/**
 * Avant un signup client par email, vérifie si le téléphone saisi est déjà
 * lié à un AUTRE profil (= un autre email) chez ce tenant. Si oui, on bloque
 * la création pour éviter qu'un visiteur écrase silencieusement le profil
 * existant via l'UPSERT sur (tenant_id, phone).
 *
 * Retours :
 *  - `available: true` → aucun profil avec ce téléphone, OU profil existant
 *    porte l'email passé en paramètre (= c'est lui qui se reconnecte).
 *  - `available: false` + `maskedEmail` → un profil porte ce téléphone avec
 *    un email différent. L'UI affiche un message et propose à l'utilisateur
 *    de se connecter avec cet email à la place.
 *
 * `maskedEmail` masque les caractères internes pour préserver la confidentialité
 * (`z***@gmail.com`) — assez pour aider le visiteur à se souvenir, pas assez
 * pour énumérer.
 */
function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at < 1) return email; // pas un email reconnaissable, on évite de transformer
  const local = email.slice(0, at);
  const domain = email.slice(at);
  // 1er caractère + *** + dernier caractère si local >= 3, sinon 1er + ***.
  const masked =
    local.length >= 3
      ? `${local[0]}***${local[local.length - 1]}${domain}`
      : `${local[0]}***${domain}`;
  return masked;
}

export async function checkClientPhoneAvailable(
  tenantId: string,
  phone: string,
  expectedEmail: string,
): Promise<PhoneAvailabilityResult> {
  if (!tenantId || !phone?.trim()) {
    return { ok: false, errorKey: 'missingParams' };
  }
  const normalizedPhone = phone.trim();
  const normalizedExpectedEmail = expectedEmail.trim().toLowerCase();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data, error } = await admin
    .from('client_profiles')
    .select('phone, email')
    
    .eq('phone', normalizedPhone)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      errorKey: 'dbError',
      errorValues: { message: (error as { message?: string }).message ?? '' },
    };
  }

  // Aucun profil avec ce téléphone → disponible
  if (!data) {
    return { ok: true, available: true };
  }

  const existingEmail = ((data as { email?: string | null }).email ?? '').trim().toLowerCase();
  // Si le profil existant n'a pas d'email OU c'est le même que celui du
  // signup courant, on considère « disponible » (l'UPSERT va juste mettre
  // à jour le profil de l'utilisateur courant).
  if (!existingEmail || existingEmail === normalizedExpectedEmail) {
    return { ok: true, available: true };
  }

  // Profil avec email différent → conflit. On masque pour la privacy.
  return { ok: true, available: false, maskedEmail: maskEmail(existingEmail) };
}

// ─── upsertClientProfile ─────────────────────────────────────────────────────

export interface UpsertProfileInput {
  tenantId: string;
  phone: string;
  firstName: string;
  lastName: string;
  /** Date de naissance OBLIGATOIRE (YYYY-MM-DD). Permet l'envoi automatique
   *  d'un cadeau anniversaire — sans DOB on perd ce canal de fidélisation. */
  dateOfBirth: string;
  email?: string; // optionnel
}

/**
 * Crée ou met à jour le profil client (upsert sur la contrainte UNIQUE tenant_id+phone).
 *
 * Validation stricte :
 *  - phone non vide (clé d'upsert)
 *  - dateOfBirth format YYYY-MM-DD + bornes [1900, today] (pas dans le futur,
 *    pas année 0202 par typo)
 */
export async function upsertClientProfile(input: UpsertProfileInput): Promise<SaveProfileResult> {
  const { tenantId, phone, firstName, lastName, dateOfBirth, email } = input;

  if (!tenantId || !phone?.trim()) {
    return { ok: false, errorKey: 'missingTenantPhone' };
  }

  // DOB : si fournie → validation stricte. Si vide → on accepte (UPDATE
  // d'un profil existant qui n'avait pas de DOB historiquement).
  // L'obligation de DOB est appliquée côté UI Signup + côté Booking flow ;
  // pas besoin de la re-bloquer ici qui sert aussi aux updates de profil
  // (audit T2.5 — anciens profils sans DOB ne pouvaient plus enregistrer).
  const dob = dateOfBirth?.trim() ?? '';
  if (dob) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      return { ok: false, errorKey: 'dobInvalid' };
    }
    const dobDate = new Date(dob);
    const now = new Date();
    if (Number.isNaN(dobDate.getTime()) || dobDate > now || dobDate.getFullYear() < 1900) {
      return { ok: false, errorKey: 'dobInvalid' };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Lit l'email actuel avant l'UPSERT pour détecter le changement et
  // déclencher la notif + audit log côté serveur (T3.3).
  const { data: existingRow } = await admin
    .from('client_profiles')
    .select('email')
    
    .eq('phone', phone.trim())
    .maybeSingle();
  const oldEmail = ((existingRow as { email?: string | null } | null)?.email ?? '').trim();
  const newEmail = (email ?? '').trim();
  const emailChanged =
    oldEmail.toLowerCase() !== newEmail.toLowerCase() && oldEmail.length > 0 && newEmail.length > 0;

  // Construit le payload UPSERT — ne pose date_of_birth QUE si fournie pour
  // ne pas écraser une valeur DB existante par null lors d'un update.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const upsertPayload: any = {
    tenant_id: SALON.tenantUuid,
    phone: phone.trim(),
    first_name: firstName.trim() || null,
    last_name: lastName.trim() || null,
    email: email?.trim() || null,
    updated_at: new Date().toISOString(),
  };
  if (dob) upsertPayload.date_of_birth = dob;

  const { error } = await admin
    .from('client_profiles')
    .upsert(upsertPayload, { onConflict: 'tenant_id,phone' });

  if (error) {
    return {
      ok: false,
      errorKey: 'saveFailed',
      errorValues: { message: (error as { message?: string }).message ?? '' },
    };
  }

  // Email changé : audit log + notif à l'ancien email (best-effort, ne
  // bloque pas le succès). Cf. T3.3 — sans ces traces, un compte
  // compromis peut détourner l'identité d'un client en changeant
  // silencieusement l'email.
  if (emailChanged) {
    // Audit log côté serveur — actor_id est nul ici car le client n'a
    // pas de session Supabase Auth (identité par téléphone localStorage).
    // L'absence d'actor_id signale « action self-service du client ».
    void admin.from('audit_log').insert({
      tenant_id: SALON.tenantUuid,
      actor_id: null,
      table_name: 'client_profiles',
      row_id: phone.trim(),
      operation: 'email_changed_by_self',
      diff: { from: oldEmail, to: newEmail },
    });

    // Nom du tenant pour la notif — on le lookup à part. Pas critique si
    // échec : on enverra l'email avec un nom générique.
    let tenantName = 'Votre salon';
    try {
      const { data: tenantRow } = await admin
        .from('tenants')
        .select('name')
        .eq('id', tenantId)
        .maybeSingle();
      tenantName = ((tenantRow as { name?: string } | null)?.name ?? 'Votre salon').slice(0, 60);
    } catch {
      // best-effort
    }

    void notifyOldClientEmailOfChange({ oldEmail, newEmail, tenantId, tenantName });
  }

  return { ok: true };
}

/** Notif à l'ancien email côté self-service client (cf. handler manager
 *  équivalent dans clients-actions.ts). Best-effort : si Resend pas
 *  configuré, on laisse passer — l'audit_log conserve la trace. */
async function notifyOldClientEmailOfChange(args: {
  oldEmail: string;
  newEmail: string;
  tenantId: string;
  tenantName: string;
}): Promise<void> {
  const resendKey = process.env['RESEND_API_KEY'];
  if (!resendKey) return;
  const { resolveFromHeader } = await import('../_lib/email-sender');
  const fromHeader = await resolveFromHeader(args.tenantId, args.tenantName);
  try {
    const { Resend } = (await import('resend')) as { Resend: new (k: string) => unknown };
    const resend = new Resend(resendKey) as {
      emails: {
        send: (a: {
          from: string;
          to: string[];
          subject: string;
          text: string;
          tags?: { name: string; value: string }[];
        }) => Promise<{ error: { message: string } | null }>;
      };
    };
    const newEmailMasked = (() => {
      const at = args.newEmail.indexOf('@');
      if (at < 1) return '***';
      const local = args.newEmail.slice(0, at);
      const domain = args.newEmail.slice(at);
      return `${local[0]}***${domain}`;
    })();
    await resend.emails.send({
      from: fromHeader,
      to: [args.oldEmail],
      subject: `Votre email a été modifié chez ${args.tenantName}`,
      text:
        `Bonjour,\n\n` +
        `L'adresse email associée à votre compte chez ${args.tenantName} vient d'être modifiée vers ${newEmailMasked}.\n\n` +
        `Si vous êtes à l'origine de ce changement, vous pouvez ignorer ce message.\n\n` +
        `Si ce n'est PAS vous, contactez le salon immédiatement pour faire annuler la modification.\n\n` +
        `— ${args.tenantName}`,
      tags: [{ name: 'type', value: 'email-change-notif' }],
    });
  } catch {
    // best-effort
  }
}

// ─── searchClients ───────────────────────────────────────────────────────────

export type ClientSearchHit = {
  phone: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
};

export type SearchClientsResult = { ok: true; results: ClientSearchHit[] } | ErrResult;

/**
 * Recherche dans le fichier client du tenant — par téléphone (préfixe) OU
 * par nom (ILIKE). Utilisée par la Caisse pour identifier un client existant
 * avant de l'attacher à une vente (et accumuler les points sur le bon compte).
 *
 * Bypass RLS (admin) — l'appelant est protégé par `requireTenant()` via le
 * point d'entrée Server Action.
 */
export async function searchClients(tenantId: string, query: string): Promise<SearchClientsResult> {
  if (!tenantId) return { ok: false, errorKey: 'tenantMissing' };
  const guard = await requireSameTenant(tenantId);
  if (!guard.ok) return guard;
  const q = query.trim();
  if (q.length < 2) return { ok: true, results: [] };

  // Échappement des wildcards SQL LIKE :
  //  - `\` doit venir EN PREMIER (sinon on échappe nos propres backslashes)
  //  - `%` et `_` sont les wildcards LIKE — un user qui tape « 50% reduction »
  //    aurait sinon une recherche partielle non intentionnelle
  // Pour PostgREST `or()`, on aussi échapper la virgule (séparateur de filtres)
  // qui sinon casserait la syntaxe → injection (audit T3.4).
  const escapeLike = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const qEscaped = escapeLike(q);
  // Échappement supplémentaire pour le séparateur PostgREST `or()` : la
  // virgule littérale doit être encodée pour ne pas casser le parsing,
  // les parenthèses peuvent aussi être abusées (cf. PostgREST horizontal
  // filters). On wrappe la valeur dans des guillemets PostgREST « " » qui
  // tolèrent les caractères spéciaux.
  const qForOr = qEscaped.replace(/"/g, '\\"');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Si la query est essentiellement numérique → priorité au matching téléphone.
  // Sinon → recherche dans first_name / last_name / email.
  const isPhoneLike = /^[+\d\s().-]+$/.test(q) && q.replace(/\D/g, '').length >= 2;

  let queryBuilder = admin
    .from('client_profiles')
    .select('phone, first_name, last_name, email')
    ;

  if (isPhoneLike) {
    queryBuilder = queryBuilder.ilike('phone', `%${qEscaped}%`);
  } else {
    // OR sur nom/prénom/email — l'opérateur PostgREST `or` veut une seule
    // string de filtres comma-séparés. Les valeurs sont wrappées en guillemets
    // pour tolérer les caractères spéciaux + qEscaped pour les wildcards.
    queryBuilder = queryBuilder.or(
      `first_name.ilike."%${qForOr}%",last_name.ilike."%${qForOr}%",email.ilike."%${qForOr}%"`,
    );
  }

  const { data, error } = await queryBuilder.order('updated_at', { ascending: false }).limit(8);

  if (error) {
    return {
      ok: false,
      errorKey: 'searchFailed',
      errorValues: { message: (error as { message?: string }).message ?? '' },
    };
  }

  const results: ClientSearchHit[] = (
    (data as
      | {
          phone: string;
          first_name: string | null;
          last_name: string | null;
          email: string | null;
        }[]
      | null) ?? []
  ).map((r) => ({
    phone: r.phone,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
  }));

  return { ok: true, results };
}

// ─── createClientFromCashier ─────────────────────────────────────────────────

export interface CreateClientFromCashierInput {
  tenantId: string;
  phone: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export type CreateClientResult =
  | { ok: true; created: boolean; profile: ClientProfileData }
  | ErrResult;

/**
 * Création (ou récupération) d'un client depuis la Caisse — utilisé quand la
 * recherche ne renvoie rien. Insertion conditionnelle (onConflict → ignore)
 * pour éviter d'écraser un profil existant si le même téléphone est saisi
 * deux fois en quelques secondes.
 *
 * Retourne `created: false` si une ligne existait déjà (rare mais possible)
 * — le client est alors considéré comme « réutilisé », pas créé.
 */
export async function createClientFromCashier(
  input: CreateClientFromCashierInput,
): Promise<CreateClientResult> {
  const { tenantId, phone, email, firstName, lastName } = input;
  if (!tenantId || !phone?.trim()) {
    return { ok: false, errorKey: 'missingTenantPhone' };
  }
  const guard = await requireSameTenant(tenantId);
  if (!guard.ok) return guard;

  const normalizedPhone = phone.trim();
  const normalizedEmail = email?.trim() || null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Vérifie d'abord si un profil existe déjà — si oui on l'enrichit (email
  // est typiquement absent sur les anciens profils créés via le booking
  // public où seul le nom + téléphone étaient demandés).
  const { data: existing } = await admin
    .from('client_profiles')
    .select('phone, first_name, last_name, date_of_birth, email')
    
    .eq('phone', normalizedPhone)
    .maybeSingle();

  if (existing) {
    const row = existing as {
      phone: string;
      first_name: string | null;
      last_name: string | null;
      date_of_birth: string | null;
      email: string | null;
    };
    // Complète les champs manquants sans écraser ceux déjà saisis par le
    // client lui-même (qui sont prioritaires).
    const patch: Record<string, string | null> = {};
    if (!row.email && normalizedEmail) patch['email'] = normalizedEmail;
    if (!row.first_name && firstName?.trim()) patch['first_name'] = firstName.trim();
    if (!row.last_name && lastName?.trim()) patch['last_name'] = lastName.trim();
    if (Object.keys(patch).length > 0) {
      patch['updated_at'] = new Date().toISOString();
      await admin
        .from('client_profiles')
        .update(patch)
        
        .eq('phone', normalizedPhone);
    }
    return {
      ok: true,
      created: false,
      profile: {
        phone: normalizedPhone,
        firstName: row.first_name ?? firstName?.trim() ?? null,
        lastName: row.last_name ?? lastName?.trim() ?? null,
        dateOfBirth: row.date_of_birth,
        email: row.email ?? normalizedEmail,
      },
    };
  }

  // Insertion d'un nouveau profil. Pas de UNIQUE race possible : la
  // contrainte (tenant_id, phone) protège l'intégrité — en cas de conflit
  // simultané, on bascule sur la branche "existing" au prochain retry.
  const { error } = await admin.from('client_profiles').insert({
    tenant_id: SALON.tenantUuid,
    phone: normalizedPhone,
    email: normalizedEmail,
    first_name: firstName?.trim() || null,
    last_name: lastName?.trim() || null,
  });

  if (error) {
    return {
      ok: false,
      errorKey: 'createProfileFailed',
      errorValues: { message: (error as { message?: string }).message ?? '' },
    };
  }

  return {
    ok: true,
    created: true,
    profile: {
      phone: normalizedPhone,
      firstName: firstName?.trim() || null,
      lastName: lastName?.trim() || null,
      dateOfBirth: null,
      email: normalizedEmail,
    },
  };
}

// ─── getClientSales ──────────────────────────────────────────────────────────

export type ClientSaleItem = {
  id: string;
  date: string; // 'YYYY-MM-DD'
  time: string; // 'HH:mm'
  totalCents: number;
  /** Sous-total BRUT avant cashback. Utilisé pour calculer le cashback
   *  GAGNÉ sur la vente (subtotal × rate / 10000). Audit T5.14. */
  subtotalCents: number;
  /** Cashback débité par le client à l'encaissement. Affiché négativement
   *  dans l'historique des transactions cashback. Audit T5.14. */
  cashbackRedeemedCents: number;
  method: 'card' | 'cash' | 'mobile';
  items: Array<{ name: string; qty: number; priceCents: number }>;
  /** Vente remboursée — affichée barrée dans l'espace client + tag. */
  refunded?: boolean;
  refundedAt?: string;
};

export type GetClientSalesResult = { ok: true; sales: ClientSaleItem[] } | ErrResult;

/** Limiteur anti-énumération : bloque les bursts qui essaieraient de
 *  brute-forcer des numéros pour aspirer les ventes du tenant.
 *
 *  DOUBLE LIMITE (audit-2 finding C : la limite seule par phone est
 *  inopérante face à une énumération phone-by-phone, chaque numéro étant
 *  une key bucket distincte) :
 *    - `(tenantId, phone)` → max 10/min : protège un user légitime qui
 *      spam accidentellement (refresh, double-clic).
 *    - `(tenantId, ip)`    → max 30/min : casse l'énumération phone-by-phone
 *      depuis une seule IP.
 *
 *  Mémoire processus (reset au cold start Vercel) — pas idéal en multi-
 *  régions, mais suffisant pour ralentir un scanner naïf. Pour une vraie
 *  limite cross-région il faudrait Upstash KV / Vercel KV — hors scope MVP.
 *
 *  En cas de dépassement, retourne `tenantNotAuthorized` (générique pour
 *  ne pas confirmer l'existence d'un compte par un message dédié). */
const SALES_LOOKUP_BUCKETS = new Map<string, number[]>();
const SALES_LOOKUP_WINDOW_MS = 60_000;
const SALES_LOOKUP_MAX_PHONE = 10;
const SALES_LOOKUP_MAX_IP = 30;
function rateLimitBucket(key: string, max: number): boolean {
  const now = Date.now();
  const arr = (SALES_LOOKUP_BUCKETS.get(key) ?? []).filter((t) => now - t < SALES_LOOKUP_WINDOW_MS);
  if (arr.length >= max) {
    SALES_LOOKUP_BUCKETS.set(key, arr);
    return false;
  }
  arr.push(now);
  SALES_LOOKUP_BUCKETS.set(key, arr);
  return true;
}
async function rateLimitSalesLookup(tenantId: string, phone: string): Promise<boolean> {
  // Lecture de l'IP côté Vercel (x-forwarded-for) ou proxy générique
  // (x-real-ip). Si on est hors contexte requête (tests unitaires) on
  // accepte un fallback 'unknown' qui sera partagé par tous les callers
  // hors HTTP — acceptable pour l'usage prévu.
  let ip = 'unknown';
  try {
    const { headers } = await import('next/headers');
    const h = await headers();
    ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown';
  } catch {
    // hors requête : on garde 'unknown'
  }
  // Délégué à `_lib/rate-limit` qui utilise Upstash Redis si configuré
  // (cross-region, persistant), sinon retombe sur Map en mémoire pour le
  // dev local. Garde la double-limite (phone OR ip) du fix précédent.
  // L'ancienne Map locale `SALES_LOOKUP_BUCKETS` reste pour les autres
  // call sites éventuels mais n'est plus active sur ce chemin.
  void SALES_LOOKUP_BUCKETS;
  void SALES_LOOKUP_WINDOW_MS;
  void SALES_LOOKUP_MAX_PHONE;
  void SALES_LOOKUP_MAX_IP;
  void rateLimitBucket;
  const [phoneOk, ipOk] = await Promise.all([
    rlSalesPhone(tenantId, phone),
    rlSalesIp(tenantId, ip),
  ]);
  return phoneOk && ipOk;
}

/**
 * Liste les ventes (factures) attachées à un client (tenant + phone).
 * Inclut les ventes directes ET les RDV encaissés via payBooking.
 * Triées du plus récent au plus ancien.
 *
 * Modèle d'identité : `phone` = pseudo-credential (cohérent avec le reste
 * de l'espace client public). Pour limiter l'énumération massive, on
 * applique un rate limit en mémoire (10 lookups/min par paire tenant+phone).
 */
export async function getClientSales(
  tenantId: string,
  phone: string,
): Promise<GetClientSalesResult> {
  if (!tenantId || !phone?.trim()) {
    return { ok: false, errorKey: 'missingParams' };
  }

  // 🔒 Source de vérité : le téléphone vient du COOKIE de session vérifié,
  // jamais du paramètre reçu (forgeable). Le paramètre est ignoré.
  const authedPhone = await getAuthedClientPhone();
  if (!authedPhone) return { ok: false, errorKey: 'authRequired' };
  void phone;
  const normalizedPhone = authedPhone;

  if (!(await rateLimitSalesLookup(tenantId, normalizedPhone))) {
    // Code générique pour ne pas révéler si le compte existe ou non.
    return { ok: false, errorKey: 'tenantNotAuthorized' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data, error } = await admin
    .from('sales')
    .select(
      'id, created_at, subtotal_cents, total_cents, cashback_redeemed_cents, method, status, refunded_at, sale_items(name, qty, unit_price_cents)',
    )
    
    .eq('client_phone', normalizedPhone)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return {
      ok: false,
      errorKey: 'salesLoadFailed',
      errorValues: { message: (error as { message?: string }).message ?? '' },
    };
  }

  const sales: ClientSaleItem[] = (
    (data as
      | {
          id: string;
          created_at: string;
          subtotal_cents: number | null;
          total_cents: number;
          cashback_redeemed_cents: number | null;
          method: string;
          status: string | null;
          refunded_at: string | null;
          sale_items: { name: string; qty: number; unit_price_cents: number }[] | null;
        }[]
      | null) ?? []
  ).map((r) => {
    const d = new Date(r.created_at);
    return {
      id: r.id,
      date: r.created_at.split('T')[0]!,
      time: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`,
      totalCents: r.total_cents ?? 0,
      // Fallback `total_cents` si `subtotal_cents` est NULL (sales pré-T1.2
      // qui n'avaient pas la colonne).
      subtotalCents: r.subtotal_cents ?? r.total_cents ?? 0,
      cashbackRedeemedCents: r.cashback_redeemed_cents ?? 0,
      method:
        r.method === 'card' || r.method === 'cash' || r.method === 'mobile'
          ? (r.method as 'card' | 'cash' | 'mobile')
          : 'card',
      refunded: r.status === 'refunded',
      refundedAt: r.refunded_at ?? undefined,
      items: (r.sale_items ?? []).map((si) => ({
        name: si.name,
        qty: si.qty ?? 1,
        priceCents: si.unit_price_cents ?? 0,
      })),
    };
  });

  return { ok: true, sales };
}

// ─── getSaleReceiptSnapshot — données authoritatives pour le PDF client ─────

/** Snapshot serveur-autoritatif d'une vente — utilisé par l'espace client
 *  pour générer un PDF de facture infalsifiable. Le client appelle ce
 *  endpoint juste avant de builder le PDF côté navigateur : même si le DOM
 *  est trafiqué, le snapshot rendu vient de la DB. */
export type SaleReceiptSnapshot = {
  saleId: string;
  dateIso: string;
  time: string;
  items: Array<{ name: string; qty: number; priceCents: number }>;
  totalCents: number;
  tipCents: number;
  method: 'card' | 'cash' | 'mobile';
  clientName: string | null;
  refunded: boolean;
  currency: string;
  // Métadonnées salon (figées au moment du fetch — pas de fuite si le salon
  // change ses paramètres entre la vente et le téléchargement).
  salon: {
    name: string;
    logoUrl: string | null;
    tagline: string | null;
    addressStreet: string | null;
    addressCity: string | null;
    addressZip: string | null;
    branch: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
  };
};

export type GetSaleReceiptResult = { ok: true; snapshot: SaleReceiptSnapshot } | ErrResult;

/** Récupère le snapshot authoritatif d'une vente. Garde : le téléphone
 *  fourni DOIT matcher `sales.client_phone` (cohérent avec `getClientSales`
 *  qui filtre déjà sur ce champ) — sinon retourne `tenantNotAuthorized`.
 *
 *  Modèle : tenant + phone = clé d'accès, comme partout dans /client.
 *  Rate-limité par la même bucket que `getClientSales`. */
export async function getSaleReceiptSnapshot(
  tenantId: string,
  saleId: string,
  phone: string,
): Promise<GetSaleReceiptResult> {
  if (!tenantId || !saleId?.trim() || !phone?.trim()) {
    return { ok: false, errorKey: 'missingParams' };
  }
  // Valide format UUID — empêche l'enumération via patterns courts/randoms.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saleId)) {
    return { ok: false, errorKey: 'missingParams' };
  }

  // 🔒 Source de vérité : le téléphone vient du COOKIE de session vérifié,
  // jamais du paramètre reçu (forgeable). Le paramètre est ignoré → un client
  // ne peut récupérer que SES propres reçus.
  const authedPhone = await getAuthedClientPhone();
  if (!authedPhone) return { ok: false, errorKey: 'authRequired' };
  void phone;
  const normalizedPhone = authedPhone;

  if (!(await rateLimitSalesLookup(tenantId, normalizedPhone))) {
    return { ok: false, errorKey: 'tenantNotAuthorized' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // 1. Sale + items — filtre tenant + phone garantissent l'ownership.
  const saleRes = await admin
    .from('sales')
    .select(
      'id, created_at, total_cents, tip_cents, method, status, client_name, sale_items(name, qty, unit_price_cents)',
    )
    .eq('id', saleId)
    
    .eq('client_phone', normalizedPhone)
    .maybeSingle();

  if (saleRes.error || !saleRes.data) {
    // Pas d'info structurelle sur l'existence — code générique.
    return { ok: false, errorKey: 'tenantNotAuthorized' };
  }
  const sale = saleRes.data as {
    id: string;
    created_at: string;
    total_cents: number;
    tip_cents: number | null;
    method: string;
    status: string | null;
    client_name: string | null;
    sale_items: { name: string; qty: number; unit_price_cents: number }[] | null;
  };

  // 2. Tenant + branding + settings pour entête PDF.
  const [tenantRes, brandingRes, settingsRes] = await Promise.all([
    admin.from('tenants').select('name, currency').eq('id', tenantId).maybeSingle(),
    admin.from('tenant_branding').select('logo_url').maybeSingle(),
    admin
      .from('tenant_settings')
      .select(
        'tagline, address_street, address_city, address_zip, branch, contact_phone, contact_email, contact_website',
      )
      
      .maybeSingle(),
  ]);

  const tenant = (tenantRes.data ?? { name: '', currency: 'EUR' }) as {
    name: string;
    currency: string;
  };
  const branding = (brandingRes.data ?? { logo_url: null }) as { logo_url: string | null };
  const settings = (settingsRes.data ?? {}) as {
    tagline: string | null;
    address_street: string | null;
    address_city: string | null;
    address_zip: string | null;
    branch: string | null;
    contact_phone: string | null;
    contact_email: string | null;
    contact_website: string | null;
  };

  const date = new Date(sale.created_at);
  const time = `${String(date.getUTCHours()).padStart(2, '0')}:${String(
    date.getUTCMinutes(),
  ).padStart(2, '0')}`;

  const method: 'card' | 'cash' | 'mobile' =
    sale.method === 'card' || sale.method === 'cash' || sale.method === 'mobile'
      ? sale.method
      : 'card';

  const snapshot: SaleReceiptSnapshot = {
    saleId: sale.id,
    dateIso: sale.created_at,
    time,
    items: (sale.sale_items ?? []).map((si) => ({
      name: si.name,
      qty: si.qty ?? 1,
      priceCents: si.unit_price_cents ?? 0,
    })),
    totalCents: sale.total_cents,
    tipCents: sale.tip_cents ?? 0,
    method,
    clientName: sale.client_name,
    refunded: sale.status === 'refunded',
    currency: tenant.currency,
    salon: {
      name: tenant.name,
      logoUrl: branding.logo_url,
      tagline: settings.tagline ?? null,
      addressStreet: settings.address_street ?? null,
      addressCity: settings.address_city ?? null,
      addressZip: settings.address_zip ?? null,
      branch: settings.branch ?? null,
      phone: settings.contact_phone ?? null,
      email: settings.contact_email ?? null,
      website: settings.contact_website ?? null,
    },
  };

  return { ok: true, snapshot };
}

// ─── deleteClientAccount (RGPD) ──────────────────────────────────────────────

export type DeleteAccountResult = { ok: true } | ErrResult;

/**
 * Suppression RGPD / CCPA d'un compte client. Audit T5.16.
 *
 * Politique : **anonymisation** plutôt qu'effacement complet pour respecter
 * la traçabilité comptable (les ventes sont rattachées au téléphone — les
 * effacer brutalement ferait disparaître du chiffre d'affaires de la
 * caisse). On rend les données indissociables d'une personne identifiée :
 *
 * 1. `client_profiles` : phone → `deleted-<uuid>`, email/noms/DOB → NULL,
 *    push_subscription → NULL (plus de notifications)
 * 2. `auth.users` : si le profil référence un `user_id`, suppression du compte
 *    Auth associé (best-effort)
 * 3. Les `bookings` et `sales` historiques conservent `client_phone` mais
 *    pointent désormais sur un téléphone anonymisé — impossibles à relier
 *    au client supprimé.
 *
 * Garde : l'identité provient EXCLUSIVEMENT du cookie de session vérifié
 * (`getAuthedClientPhone`). Le paramètre `phone` est ignoré. Un client ne peut
 * donc supprimer que SON propre compte — la session est la preuve de propriété.
 */
export async function deleteClientAccount(
  tenantId: string,
  phone: string,
): Promise<DeleteAccountResult> {
  if (!tenantId || !phone?.trim()) {
    return { ok: false, errorKey: 'missingParams' };
  }

  // 🔒 Source de vérité : le téléphone vient du COOKIE de session vérifié,
  // jamais du paramètre reçu (forgeable). Le paramètre est ignoré → un client
  // ne peut supprimer que SON propre compte (la session EST la preuve de
  // propriété). On abandonne l'ancien modèle getCurrentUser()+email (session
  // Supabase STAFF, inadapté aux clients).
  const authedPhone = await getAuthedClientPhone();
  if (!authedPhone) return { ok: false, errorKey: 'authRequired' };
  void phone;
  const normalizedPhone = authedPhone;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // On charge le profil ciblé par le téléphone de la session pour récupérer
  // son `user_id` (étape optionnelle de suppression du compte Auth).
  const { data: profile, error: loadErr } = await admin
    .from('client_profiles')
    .select('id, email, user_id')

    .eq('phone', normalizedPhone)
    .maybeSingle();

  if (loadErr || !profile) {
    return { ok: false, errorKey: 'profileNotFound' };
  }

  const profileRow = profile as { id: string; email: string | null; user_id: string | null };

  // Anonymisation : on remplace phone par un placeholder unique pour
  // libérer la valeur (un autre client peut reprendre ce numéro plus tard)
  // tout en gardant la ligne pour la cohérence des FK.
  const placeholderPhone = `deleted-${crypto.randomUUID()}`;
  const { error: updateErr } = await admin
    .from('client_profiles')
    .update({
      phone: placeholderPhone,
      email: null,
      first_name: null,
      last_name: null,
      date_of_birth: null,
      push_subscription: null,
      user_id: null,
    })
    .eq('id', profileRow.id)
    ;

  if (updateErr) {
    return {
      ok: false,
      errorKey: 'profileUpdateFailed',
      errorValues: { message: (updateErr as { message?: string }).message ?? '' },
    };
  }

  // Suppression du compte Auth — best effort, on continue si ça échoue
  // (le profil est déjà anonymisé, donc le client perd l'accès même si
  // auth.users persiste).
  const authUserId = profileRow.user_id;
  if (authUserId) {
    await admin.auth.admin.deleteUser(authUserId).catch(() => {
      // Silent fail — log côté Sentry plus tard si besoin.
    });
  }

  // Audit log : on trace l'action pour conformité RGPD (registre des
  // suppressions sur demande, art. 30 RGPD).
  await admin
    .from('audit_log')
    .insert({
      // actor_id nul : le client n'a pas de session Supabase Auth (identité
      // par cookie de session signé). L'absence d'actor_id signale une action
      // self-service du client lui-même.
      tenant_id: SALON.tenantUuid,
      actor_id: null,
      table_name: 'client_profiles',
      row_id: profileRow.id,
      operation: 'delete',
      diff: { reason: 'rgpd_account_deletion', anonymized_phone: placeholderPhone },
    })
    .then(() => undefined)
    .catch(() => undefined);

  return { ok: true };
}
