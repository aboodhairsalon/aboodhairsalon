'use server';

/**
 * Server Action — création d'un nouveau tenant (signup).
 *
 * Flow :
 *  1. Valide nom + email (+ slug optionnel)
 *  2. Génère slug auto (slugify(nom)) si non fourni, vérifie unicité + réservés
 *  3. INSERT tenants (defaults : currency=EGP, plan=starter, status=trial)
 *  4. INSERT tenant_branding (defaults cuivre/glow/deep)
 *  5. INSERT tenant_settings (defaults : tax 20%, deposit/cancel policies)
 *  6. createUser via service_role : email + mot de passe + app_metadata
 *     (email_confirm: true → connexion immédiate, le client enchaîne signInWithPassword)
 *
 * Rollback : si une étape échoue après INSERT tenant, on cleanup (DELETE cascade).
 * RLS bypass : service_role obligatoire pour INSERT sur `tenants` (policy
 * `tenants_super_admin_write` exige is_super_admin).
 */
import { headers } from 'next/headers';
import { createAdminClient } from '@/db';
import { z } from 'zod';
import { rlSignupIp } from '../_lib/rate-limit';
import { isReservedSlug, isValidSlug, slugify } from './slug';
import type { SignupErrorKey, SignupResult } from './types';

// Schéma de validation — les `message` Zod sont des CODES (pas du FR), résolus
// côté client contre `signup.errors.*` dans la locale active du visiteur.
// Permet de conserver une validation typée sans dupliquer les chaînes UI ici.
const SignupSchema = z.object({
  salonName: z.string().trim().min(2, 'salonNameTooShort').max(60, 'salonNameTooLong'),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  email: z.string().trim().toLowerCase().email('emailInvalid'),
  password: z.string().min(8, 'passwordTooShort').max(72, 'passwordTooLong'),
});

export async function signUp(input: {
  salonName: string;
  slug?: string;
  email: string;
  password: string;
}): Promise<SignupResult> {
  // Rate-limit anti-abuse (audit pre-launch 2026-05-23) : 3 inscriptions/h/IP.
  // Bloque la création massive de fake tenants pour squatter des slugs ou
  // saturer la DB. Un user légitime crée 1 compte, jamais 4 en 1h.
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown';
  if (!(await rlSignupIp(ip))) {
    return { ok: false, errorKey: 'rateLimited' };
  }

  const parsed = SignupSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    // Le `message` Zod EST déjà notre clé i18n (cf. schéma ci-dessus).
    const errorKey = (first?.message ?? 'invalidData') as SignupErrorKey;
    return {
      ok: false,
      errorKey,
      field: (first?.path[0] as 'salonName' | 'slug' | 'email' | 'password') ?? undefined,
    };
  }

  const { salonName, email, password } = parsed.data;
  const slug = parsed.data.slug ?? slugify(salonName);

  if (!slug || !isValidSlug(slug)) {
    return { ok: false, errorKey: 'slugInvalid', field: 'slug' };
  }
  if (isReservedSlug(slug)) {
    return { ok: false, errorKey: 'slugReserved', errorValues: { slug }, field: 'slug' };
  }

  const admin = createAdminClient();

  // 1) Vérifier slug unique
  const { data: existingSlug } = await admin
    .from('tenants')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (existingSlug) {
    return { ok: false, errorKey: 'slugTaken', errorValues: { slug }, field: 'slug' };
  }

  // 2) Vérifier email pas déjà utilisé.
  //
  // AVANT (BUG) : `admin.auth.admin.listUsers({page:1,perPage:1})` ne lit que
  // le 1er user de TOUTE la base — inopérant dès qu'il y a 2+ users. Audit
  // pre-launch 2026-05-23 a remonté ce bug qui causait crash silencieux post-
  // rollback à chaque 2e tentative avec un email déjà existant.
  //
  // FIX : on tente la création directement et on intercepte l'erreur
  // `email_exists` retournée par Supabase Auth. Pas besoin de pré-check —
  // `createUser` est atomique côté serveur, donc pas de race possible.
  // L'order est : tenant insert → branding → settings → createUser (où
  // l'erreur email peut survenir). Si elle survient, rollback complet
  // (DELETE tenants cascade) + retour `emailTaken`.

  // 3) INSERT tenants
  const { data: tenant, error: tenantErr } = await admin
    .from('tenants')
    .insert({
      slug,
      name: salonName,
      currency: 'EGP',
      timezone: 'Africa/Cairo',
      locale: 'fr-FR',
      plan: 'starter',
      status: 'trial',
      trial_ends_at: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
    })
    .select()
    .single();

  if (tenantErr || !tenant) {
    return {
      ok: false,
      errorKey: 'tenantCreation',
      errorValues: { message: tenantErr?.message ?? 'unknown' },
    };
  }

  // Helper rollback en cas d'échec sur les étapes suivantes
  const rollback = async () => {
    await admin.from('tenants').delete().eq('id', tenant.id);
  };

  // 4) INSERT tenant_branding (defaults)
  const { error: brandErr } = await admin.from('tenant_branding').insert({ tenant_id: tenant.id });
  if (brandErr) {
    await rollback();
    return { ok: false, errorKey: 'branding', errorValues: { message: brandErr.message } };
  }

  // 5) INSERT tenant_settings (defaults)
  const { error: settingsErr } = await admin
    .from('tenant_settings')
    .insert({ tenant_id: tenant.id });
  if (settingsErr) {
    await rollback();
    return { ok: false, errorKey: 'settings', errorValues: { message: settingsErr.message } };
  }

  // 6) Créer le compte (email + mot de passe) + lien tenant via app_metadata.
  //    email_confirm: true → connexion immédiate, sans magic link ni vérification email.
  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: 'manager' },
  });

  if (userErr || !userData?.user) {
    await rollback();
    // Détecte les variations de message « email déjà utilisé » que peut
    // renvoyer Supabase Auth selon la version (code `email_exists`, ou
    // message text contenant "already" / "exists" / "taken" / "registered").
    const msg = (userErr?.message ?? '').toLowerCase();
    const isEmailDup =
      userErr?.code === 'email_exists' ||
      /already\s+(been\s+)?registered/.test(msg) ||
      /email.*(taken|exists|in\s+use)/.test(msg) ||
      /user\s+already\s+exists/.test(msg);
    if (isEmailDup) {
      return {
        ok: false,
        errorKey: 'emailTaken',
        errorValues: { email },
        field: 'email',
      };
    }
    return {
      ok: false,
      errorKey: 'userCreation',
      errorValues: { message: userErr?.message ?? 'unknown' },
    };
  }

  // 7) Compte prêt — le client enchaîne avec signInWithPassword puis /manager.
  return {
    ok: true,
    tenant: { id: tenant.id, slug, name: tenant.name },
  };
}
