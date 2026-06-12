'use server';
/**
 * Server Actions du Manager — mutations sur les tables tenant.
 *
 * Toutes les mutations passent par la session du user (cookies → JWT
 * avec tenant_id top-level grâce au hook D-022). RLS bypass = 0 :
 * un user ne peut éditer QUE son propre tenant.
 *
 * À chaque succès : `revalidatePath('/manager')` invalide le cache Server
 * pour que l'UI lise les valeurs fraîches au prochain render.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient, type Database } from '@/db';
import { SALON } from '@/config/salon';
import { requireTenant } from '../_data/auth-server';
import { getServerSupabase } from '../_data/supabase-server';
import { clearFromAddressCache } from '../_lib/email-sender';
import { rlCashierAdmin } from '../_lib/rate-limit';

type TenantsUpdate = Database['public']['Tables']['tenants']['Update'];
type BrandingUpdate = Database['public']['Tables']['tenant_branding']['Update'];
type SettingsUpdate = Database['public']['Tables']['tenant_settings']['Update'];
// StaffRow is used to type select results because supabase-js inference
// resolves to `never` at the query level (PostgrestVersion mismatch workaround).
type StaffRow = Database['public']['Tables']['staff']['Row'];

// =============================================================================
// Codes d'erreur — résolus côté client via `useTranslations('manager.errors.*')`.
// Aucun message brut FR/EN/AR ne traverse le boundary serveur → client.
// =============================================================================

export type ManagerErrorCode =
  | 'invalidData'
  | 'invalidHexColor'
  | 'invalidMapsUrl'
  | 'passwordTooShort'
  | 'passwordTooLong'
  | 'invalidStaffId'
  | 'tenantsRowMissing'
  | 'brandingRowMissing'
  | 'settingsRowMissing'
  | 'tenantsDbError'
  | 'brandingDbError'
  | 'settingsDbError'
  | 'directionOnly'
  | 'staffNotFound'
  | 'alreadyHasAccess'
  | 'noCashierAccessToReset'
  | 'noCashierAccessToRevoke'
  | 'accountCreationFailed'
  | 'accountLinkingFailed'
  | 'passwordResetFailed'
  | 'accessRevokeFailed'
  | 'rateLimited'
  // Codes partagés avec clients-actions.ts / reservations-actions.ts /
  // dashboard-actions.ts pour exposer une seule namespace `manager.errors.*`.
  | 'tenantMissing'
  | 'tenantNotAuthorized'
  | 'loadClientsFailed'
  | 'loadReservationsFailed'
  | 'loadReviewsFailed'
  | 'dbError';

export type ManagerErrorValues = Record<string, string | number>;

// =============================================================================
// updateSalonProfile — édite nom, devise, branding (couleur), logo, adresse...
// =============================================================================

// Helper Zod : trim + max + accepte string vide → null
const nullableString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v === '' || v == null ? null : v));

const SalonProfileSchema = z.object({
  name: z.string().trim().min(2).max(60),
  currency: z.enum(['EUR', 'EGP', 'MAD', 'TND', 'AED', 'USD', 'GBP', 'CHF']),
  // Le message Zod n'est jamais affiché — le serveur convertit en `invalidHexColor`
  // côté retour. On garde la regex pour valider, le message FR pour les logs.
  brand_primary: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'invalidHexColor'),
  // Identité étendue
  tagline: nullableString(100),
  logo_url: nullableString(2_000_000), // data URL peut être long (PNG base64)
  // Adresse (séparée pour KPIs futurs + recherche)
  address_street: nullableString(200),
  address_city: nullableString(80),
  address_zip: nullableString(20),
  branch: nullableString(80),
  // Contact
  contact_phone: nullableString(40),
  contact_email: nullableString(120),
  contact_website: nullableString(200),
  contact_instagram: nullableString(60),
  /** Lien Google Maps de partage (épingle exacte du salon). Format type :
   *  `https://share.google/XXXX` ou `https://maps.app.goo.gl/XXXX` ou la
   *  forme longue `https://www.google.com/maps/place/...`.
   *  Sécurité : on REFUSE explicitement les schémas `javascript:`, `data:`,
   *  `file:` etc. via un regex `^https?://` — un manager malicieux ne peut
   *  pas injecter un XSS qui se déclencherait sur les clients (qui cliquent
   *  ce lien depuis le composant Adresse). Borne 500 chars. */
  maps_url: z
    .string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .transform((v) => (v === '' || v == null ? null : v))
    .refine((v) => v == null || /^https?:\/\//i.test(v), 'invalidMapsUrl'),
  // Taux cashback en basis points (250 = 2,5 %). Borné [0, 1500] = 0-15 %.
  // 0 désactive le programme cashback côté UI client (carte CTA cachée).
  cashback_rate_bp: z.number().int().min(0).max(1500),
  // Taux TVA en basis points (2000 = 20 %). 0 = pas de TVA (cas standard pour
  // un petit salon non-assujetti en EG/FR). Borné [0, 3000] = 0-30 %.
  // Affiché sur les reçus seulement si > 0. Audit T5.25.
  tax_rate_bp: z.number().int().min(0).max(3000),
  // Adresse expéditeur emails transactionnels (ex. noreply@aboodhairsalon.com).
  // NULL = fallback noreply@system-aone.com. Pré-requis : DNS du domaine
  // vérifié dans le dashboard Resend (DKIM + SPF + DMARC).
  email_from_address: z
    .string()
    .trim()
    .max(120)
    .optional()
    .nullable()
    .transform((v) => (v === '' || v == null ? null : v))
    .refine((v) => v == null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'invalidEmail'),
  // Horaires : JSON WeekSchedule sérialisé par OpeningHoursEditor (~800 chars typiques).
  hours_text: nullableString(5000),
  // Legal (compat backward)
  legal_name: nullableString(120),
  legal_address: nullableString(300),
});

export type SalonProfileInput = z.input<typeof SalonProfileSchema>;

export type SalonProfileResult =
  | { ok: true }
  | {
      ok: false;
      errorKey: ManagerErrorCode;
      errorValues?: ManagerErrorValues;
      field?: string;
    };

/**
 * Calcule les variantes glow + deep à partir de la primaire.
 * Glow = +12 % lightness, Deep = -18 % (simple shift sur le canal V de HSV).
 * Fallback : si parsing échoue, on garde les defaults.
 */
function derivePalette(primaryHex: string): { glow: string; deep: string } {
  // Conversion approximative — pas besoin de précision parfaite côté serveur,
  // c'est juste pour pré-calculer les variantes. Le client peut affiner.
  const match = /^#([0-9A-Fa-f]{6})$/.exec(primaryHex);
  if (!match) return { glow: '#E8A867', deep: '#9B5F26' };
  const hex = match[1]!;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  const lighten = (c: number) => Math.min(255, Math.round(c + (255 - c) * 0.18));
  const darken = (c: number) => Math.max(0, Math.round(c * 0.7));
  const toHex = (c: number) => c.toString(16).padStart(2, '0');

  const glow = '#' + toHex(lighten(r)) + toHex(lighten(g)) + toHex(lighten(b));
  const deep = '#' + toHex(darken(r)) + toHex(darken(g)) + toHex(darken(b));
  return { glow, deep };
}

export async function updateSalonProfile(input: SalonProfileInput): Promise<SalonProfileResult> {
  // requireTenant() valide :
  //   - le user a une session valide
  //   - son JWT contient un tenant_id (lifté par le hook D-022)
  //   - le user est le gérant (role !== 'cashier')
  //   - le tenant_id de ctx === tenant_id de l'app_metadata du user
  //
  // Une fois cette garde franchie, on peut écrire en bypass RLS via le client
  // admin — c'est sûr car on a déjà prouvé que l'appelant possède ce tenant.
  //
  // Pourquoi PAS le client user-session : la policy `tenants_super_admin_write`
  // exige `is_super_admin()` pour tous les writes sur la table `tenants`. Le
  // gérant n'est pas super_admin, donc l'UPDATE matche 0 ligne silencieusement.
  // Le tenant_branding et tenant_settings ont des policies plus permissives mais
  // par cohérence on passe TOUS les writes en admin — un seul chemin, plus de
  // surprise RLS qui bloquerait demain quand quelqu'un changera une policy.
  const ctx = await requireTenant();
  const admin = createAdminClient();

  const parsed = SalonProfileSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    // Si Zod a renvoyé un message reconnu (ex. 'invalidHexColor'), on l'utilise
    // tel quel ; sinon on retombe sur le code générique.
    const errorKey: ManagerErrorCode =
      first?.message === 'invalidHexColor'
        ? 'invalidHexColor'
        : first?.message === 'invalidMapsUrl'
          ? 'invalidMapsUrl'
          : 'invalidData';
    return {
      ok: false,
      errorKey,
      field: first?.path[0]?.toString(),
    };
  }
  const data = parsed.data;
  const { glow, deep } = derivePalette(data.brand_primary);

  // Update tenants (nom + devise) — `.select('id')` permet de détecter les
  // UPDATE qui matchent 0 lignes (ligne disparue, etc.). Avec le client admin
  // la RLS ne devrait plus jamais bloquer, mais on garde la garde.
  const tUpdate: TenantsUpdate = { name: data.name, currency: data.currency };
  const { data: tRows, error: tErr } = await admin
    .from('tenants')
    .update(tUpdate as never)
    .eq('id', ctx.tenant.id)
    .select('id');
  if (tErr)
    return { ok: false, errorKey: 'tenantsDbError', errorValues: { message: tErr.message } };
  if (!tRows || tRows.length === 0) {
    return { ok: false, errorKey: 'tenantsRowMissing' };
  }

  // Update tenant_branding (couleur primaire + dérivées + logo)
  const bUpdate: BrandingUpdate = {
    brand_primary: data.brand_primary,
    brand_glow: glow,
    brand_deep: deep,
    logo_url: data.logo_url ?? null,
  };
  const { data: bRows, error: bErr } = await admin
    .from('tenant_branding')
    .update(bUpdate as never)
    .eq('tenant_id', ctx.tenant.id)
    .select('tenant_id');
  if (bErr)
    return { ok: false, errorKey: 'brandingDbError', errorValues: { message: bErr.message } };
  if (!bRows || bRows.length === 0) {
    return { ok: false, errorKey: 'brandingRowMissing' };
  }

  // Update tenant_settings (tous les champs profil étendus)
  const sUpdate: SettingsUpdate = {
    legal_name: data.legal_name ?? null,
    // FIX silent-null wipe : pas de champ UI pour legal_address → on ne
    // l'inclut PAS dans l'UPDATE pour ne pas écraser la valeur DB existante.
    // (Avant : data.legal_address indéfini → null écrit en DB à chaque save.)
    tagline: data.tagline ?? null,
    address_street: data.address_street ?? null,
    address_city: data.address_city ?? null,
    address_zip: data.address_zip ?? null,
    branch: data.branch ?? null,
    contact_phone: data.contact_phone ?? null,
    contact_email: data.contact_email ?? null,
    contact_website: data.contact_website ?? null,
    contact_instagram: data.contact_instagram ?? null,
    hours_text: data.hours_text ?? null,
    maps_url: data.maps_url ?? null,
    cashback_rate_bp: data.cashback_rate_bp,
    tax_rate_bp: data.tax_rate_bp,
    email_from_address: data.email_from_address ?? null,
  };
  const { data: sRows, error: sErr } = await admin
    .from('tenant_settings')
    .update(sUpdate as never)
    .eq('tenant_id', ctx.tenant.id)
    .select('tenant_id');
  if (sErr)
    return { ok: false, errorKey: 'settingsDbError', errorValues: { message: sErr.message } };
  if (!sRows || sRows.length === 0) {
    return { ok: false, errorKey: 'settingsRowMissing' };
  }

  // L'adresse d'expéditeur email est mise en cache 60 s — on l'invalide pour
  // que `email_from_address` fraîchement modifié prenne effet immédiatement.
  clearFromAddressCache();

  revalidatePath('/manager');
  return { ok: true };
}

// =============================================================================
// signOut — invalide la session côté serveur, redirige /login
// =============================================================================

export async function signOut(): Promise<void> {
  const supabase = await getServerSupabase();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
}

// =============================================================================
// Accès Caisse — la Direction gère le compte de connexion /cashier d'un membre
// =============================================================================
//
// Le membre désigné reçoit un compte Supabase Auth (email + mot de passe) avec,
// dans son JWT, role='cashier' + tenant_id + staff_id (cf. hook 0010). Il se
// connecte ensuite sur /cashier/login. Aucune auto-inscription possible.
//
// Trois actions, toutes réservées à la Direction (un caissier ne peut pas
// gérer les accès) :
//   - createCashierAccess  : crée le compte de connexion.
//   - resetCashierPassword : redéfinit le mot de passe.
//   - revokeCashierAccess  : supprime le compte (la fiche staff est déliée
//     automatiquement via la FK `staff.user_id → auth.users ON DELETE SET NULL`).

/** Mot de passe Caisse — borne basse Supabase (6) relevée à 8, borne haute bcrypt.
 *  Les messages Zod servent de codes : le serveur les rejoue tels quels au client
 *  qui les résout via `manager.errors.*`. */
const CashierPasswordSchema = z.string().min(8, 'passwordTooShort').max(72, 'passwordTooLong');

const CashierAccessSchema = z.object({
  staffId: z.string().uuid('invalidStaffId'),
  password: CashierPasswordSchema,
});

export type CashierAccessInput = z.input<typeof CashierAccessSchema>;
export type CashierAccessResult =
  | { ok: true }
  | { ok: false; errorKey: ManagerErrorCode; errorValues?: ManagerErrorValues };

/** Convertit un message Zod (qui est en fait un code) en ManagerErrorCode validé.
 *  Si le code n'est pas reconnu, retombe sur `invalidData`. */
function zodMessageToErrorKey(message: string | undefined): ManagerErrorCode {
  const known: ManagerErrorCode[] = [
    'passwordTooShort',
    'passwordTooLong',
    'invalidStaffId',
    'invalidHexColor',
  ];
  return (known as readonly string[]).includes(message ?? '')
    ? (message as ManagerErrorCode)
    : 'invalidData';
}

/**
 * Génère un email interne unique pour un compte caissier.
 * Jamais exposé à l'utilisateur — sert uniquement à Supabase Auth.
 * Format : cashier-{staffId}@internal.systemaone
 */
function internalCashierEmail(staffId: string): string {
  return `cashier-${staffId}@internal.systemaone`;
}

/**
 * Vrai si l'appelant est un caissier (≠ Direction). La gestion des accès
 * Caisse est réservée à la Direction : un caissier ne peut pas créer,
 * réinitialiser ou révoquer un accès.
 */
async function callerIsCashier(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
): Promise<boolean> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.app_metadata?.['role'] === 'cashier';
}

const DIRECTION_ONLY_RESULT = { ok: false as const, errorKey: 'directionOnly' as const };

export async function createCashierAccess(input: CashierAccessInput): Promise<CashierAccessResult> {
  const ctx = await requireTenant();
  const supabase = await getServerSupabase();

  // La gestion des accès Caisse est réservée à la Direction.
  if (await callerIsCashier(supabase)) {
    return DIRECTION_ONLY_RESULT;
  }

  // Rate-limit par manager userId : 10 actions admin caissier/heure.
  // Un manager légitime crée 1-2 caissiers par mois ; cette limite stoppe
  // un compte compromis qui tenterait de spam des comptes pour persister
  // un accès au tenant (audit T3.1).
  if (!(await rlCashierAdmin(ctx.user.id))) {
    return { ok: false, errorKey: 'rateLimited' };
  }

  const parsed = CashierAccessSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errorKey: zodMessageToErrorKey(parsed.error.errors[0]?.message) };
  }
  const { staffId, password } = parsed.data;

  // 1) Le membre doit appartenir à ce tenant (garanti par RLS) et ne pas déjà
  //    avoir un accès configuré.
  const { data: staffRowRaw, error: staffErr } = await supabase
    .from('staff')
    .select('*')
    .eq('id', staffId)
    .maybeSingle();
  const staffRow = staffRowRaw as StaffRow | null;
  if (staffErr || !staffRow) {
    return { ok: false, errorKey: 'staffNotFound' };
  }
  if (staffRow.user_id) {
    return { ok: false, errorKey: 'alreadyHasAccess' };
  }

  // L'email est un détail d'implémentation interne — jamais exposé au manager.
  const email = internalCashierEmail(staffId);

  // 2) Créer le compte d'authentification (service_role requis).
  const admin = createAdminClient();
  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    // tenant_id : requis par les policies RLS (current_tenant_id()) pour que
    // les lectures session du compte caissier passent. Son absence sur les
    // comptes historiques a causé toute une famille de bugs silencieux
    // (réglages par défaut, TVA fantôme…) — backfillée le 2026-06-12.
    app_metadata: { role: 'cashier', staff_id: staffId, tenant_id: SALON.tenantUuid },
  });
  if (userErr || !userData?.user) {
    return {
      ok: false,
      errorKey: 'accountCreationFailed',
      errorValues: { message: userErr?.message ?? '' },
    };
  }

  // 3) Lier le compte à la fiche staff.
  // On stocke UNIQUEMENT user_id — l'email interne se dérive de staffId au besoin
  // (internalCashierEmail). On ne touche PAS staff.email pour ne pas écraser
  // l'éventuel email de contact visible par la Direction.
  const { error: linkErr } = await admin
    .from('staff')
    .update({ user_id: userData.user.id } as never)
    .eq('id', staffId);
  if (linkErr) {
    // Rollback : supprimer le compte auth pour ne pas laisser d'orphelin.
    await admin.auth.admin.deleteUser(userData.user.id);
    return {
      ok: false,
      errorKey: 'accountLinkingFailed',
      errorValues: { message: linkErr.message },
    };
  }

  revalidatePath('/manager');
  return { ok: true };
}

// =============================================================================
// resetCashierPassword — la Direction redéfinit le mot de passe d'un caissier
// =============================================================================

const ResetCashierPasswordSchema = z.object({
  staffId: z.string().uuid('invalidStaffId'),
  password: CashierPasswordSchema,
});

export type ResetCashierPasswordInput = z.input<typeof ResetCashierPasswordSchema>;

export async function resetCashierPassword(
  input: ResetCashierPasswordInput,
): Promise<CashierAccessResult> {
  const ctx = await requireTenant();
  const supabase = await getServerSupabase();

  if (await callerIsCashier(supabase)) {
    return DIRECTION_ONLY_RESULT;
  }

  // Rate-limit cf. createCashierAccess — même bucket par manager userId.
  if (!(await rlCashierAdmin(ctx.user.id))) {
    return { ok: false, errorKey: 'rateLimited' };
  }

  const parsed = ResetCashierPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errorKey: zodMessageToErrorKey(parsed.error.errors[0]?.message) };
  }
  const { staffId, password } = parsed.data;

  // La fiche staff doit exister dans le tenant de la Direction (garanti par RLS)
  // et disposer d'un accès Caisse.
  const { data: staffRowRaw, error: staffErr } = await supabase
    .from('staff')
    .select('*')
    .eq('id', staffId)
    .maybeSingle();
  const staffRow = staffRowRaw as StaffRow | null;
  if (staffErr || !staffRow) {
    return { ok: false, errorKey: 'staffNotFound' };
  }
  const userId = staffRow.user_id;
  if (!userId) {
    return { ok: false, errorKey: 'noCashierAccessToReset' };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) {
    return {
      ok: false,
      errorKey: 'passwordResetFailed',
      errorValues: { message: error.message },
    };
  }
  // Aucune écriture sur la fiche staff → pas de revalidation nécessaire.
  return { ok: true };
}

// =============================================================================
// revokeCashierAccess — la Direction supprime l'accès Caisse d'un membre
// =============================================================================
//
// Supprime le compte d'authentification. La FK `staff.user_id → auth.users
// ON DELETE SET NULL` (migration 0010) délie automatiquement la fiche staff.

const StaffIdSchema = z.string().uuid('invalidStaffId');

export async function revokeCashierAccess(staffId: string): Promise<CashierAccessResult> {
  const ctx = await requireTenant();
  const supabase = await getServerSupabase();

  if (await callerIsCashier(supabase)) {
    return DIRECTION_ONLY_RESULT;
  }

  // Rate-limit cf. createCashierAccess — même bucket par manager userId.
  if (!(await rlCashierAdmin(ctx.user.id))) {
    return { ok: false, errorKey: 'rateLimited' };
  }

  const parsed = StaffIdSchema.safeParse(staffId);
  if (!parsed.success) {
    return { ok: false, errorKey: zodMessageToErrorKey(parsed.error.errors[0]?.message) };
  }

  // La fiche doit appartenir au tenant de la Direction (garanti par RLS).
  const { data: staffRowRaw, error: staffErr } = await supabase
    .from('staff')
    .select('*')
    .eq('id', parsed.data)
    .maybeSingle();
  const staffRow = staffRowRaw as StaffRow | null;
  if (staffErr || !staffRow) {
    return { ok: false, errorKey: 'staffNotFound' };
  }
  const userId = staffRow.user_id;
  if (!userId) {
    return { ok: false, errorKey: 'noCashierAccessToRevoke' };
  }

  // Supprime le compte auth → la FK ON DELETE SET NULL délie `staff.user_id`.
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    return {
      ok: false,
      errorKey: 'accessRevokeFailed',
      errorValues: { message: error.message },
    };
  }

  revalidatePath('/manager');
  return { ok: true };
}
