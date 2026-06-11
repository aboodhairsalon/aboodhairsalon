'use server';
/**
 * Server Actions — authentification client par mot de passe.
 *
 * Modèle : l'identité reste le téléphone (client_profiles.phone). Le mot de
 * passe (hash scrypt) gate l'émission d'une SESSION (cookie httpOnly porteur
 * du token signé). Une fois connecté, toutes les lectures de données dérivent
 * le téléphone du cookie vérifié (cf. client-session.ts + actions verrouillées).
 *
 * Le téléphone sert d'identifiant de connexion alternatif à l'email, mais la
 * vérification d'identité (mot de passe) + la réinitialisation passent par
 * l'email enregistré (pas de SMS).
 */
import { createAdminClient } from '@/db';
import { SALON } from '@/config/salon';
import { hashPassword, verifyPassword, isPasswordStrongEnough } from './password';
import { setClientSession, clearClientSession } from './client-session';
import { createClientToken, verifyClientToken } from '../_lib/client-token';
import { resolveFromHeader } from '../_lib/email-sender';
import { rlLoginEmail, rlLoginIp } from '../_lib/rate-limit';

/** Lecture best-effort de l'IP appelante (rate-limit). */
async function callerIp(): Promise<string> {
  try {
    const { headers } = await import('next/headers');
    const h = await headers();
    return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Expiry court pour les liens « définir / réinitialiser le mot de passe ». */
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 h

// ─── loginClient ──────────────────────────────────────────────────────────────

export type ClientLoginResult =
  | { ok: true; phone: string }
  | {
      ok: false;
      code:
        | 'missingParams'
        | 'invalidCredentials'
        | 'mustSetPassword'
        | 'notFound'
        | 'rateLimited'
        | 'dbError';
    };

/**
 * Connexion par (email OU téléphone) + mot de passe. En cas de succès, pose le
 * cookie de session et retourne le téléphone. Ne révèle jamais si un compte
 * existe (codes génériques) — sauf `mustSetPassword` qui guide un client
 * historique (profil créé via booking, sans mot de passe) vers la définition.
 */
export async function loginClient(identifier: string, password: string): Promise<ClientLoginResult> {
  const raw = (identifier ?? '').trim();
  if (!raw || !password) return { ok: false, code: 'missingParams' };

  // Rate limit : par IP (casse le brute-force depuis une IP) + par identifiant.
  const ip = await callerIp();
  const [ipOk, idOk] = await Promise.all([rlLoginIp(ip), rlLoginEmail(raw.toLowerCase())]);
  if (!ipOk || !idOk) return { ok: false, code: 'rateLimited' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const isEmail = raw.includes('@');

  type ProfileRow = { phone: string; password_hash: string | null; email: string | null };
  let row: ProfileRow | null = null;
  if (isEmail) {
    const normalizedEmail = raw.toLowerCase();
    if (!EMAIL_RE.test(normalizedEmail)) return { ok: false, code: 'invalidCredentials' };
    const { data, error } = await admin
      .from('client_profiles')
      .select('phone, password_hash, email')
      .ilike('email', normalizedEmail)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) return { ok: false, code: 'dbError' };
    row = ((data as ProfileRow[]) ?? [])[0] ?? null;
  } else {
    const { data, error } = await admin
      .from('client_profiles')
      .select('phone, password_hash, email')
      .eq('phone', raw)
      .maybeSingle();
    if (error) return { ok: false, code: 'dbError' };
    row = (data as ProfileRow | null) ?? null;
  }

  if (!row) return { ok: false, code: 'notFound' };
  if (!row.password_hash) return { ok: false, code: 'mustSetPassword' };

  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) return { ok: false, code: 'invalidCredentials' };

  await setClientSession(row.phone);
  return { ok: true, phone: row.phone };
}

// ─── requestClientPasswordReset ────────────────────────────────────────────────

export type RequestResetResult = { ok: true } | { ok: false; code: 'missingParams' | 'rateLimited' };

/**
 * Envoie un lien « définir / réinitialiser le mot de passe » à l'email du
 * compte. Réponse TOUJOURS `{ ok: true }` quand l'email est bien formé (qu'un
 * compte existe ou non) → pas d'énumération d'emails. Sert aussi de « première
 * définition » pour les clients historiques sans mot de passe.
 */
export async function requestClientPasswordReset(email: string): Promise<RequestResetResult> {
  const normalizedEmail = (email ?? '').trim().toLowerCase();
  if (!normalizedEmail || !EMAIL_RE.test(normalizedEmail)) {
    return { ok: false, code: 'missingParams' };
  }

  const ip = await callerIp();
  const [ipOk, idOk] = await Promise.all([rlLoginIp(ip), rlLoginEmail(normalizedEmail)]);
  if (!ipOk || !idOk) return { ok: false, code: 'rateLimited' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from('client_profiles')
    .select('phone, email')
    .ilike('email', normalizedEmail)
    .order('created_at', { ascending: false })
    .limit(1);
  const row = ((data as { phone: string; email: string | null }[]) ?? [])[0] ?? null;

  // Compte trouvé → envoi du lien (best-effort). Sinon on ne fait rien mais on
  // renvoie quand même ok (anti-énumération).
  if (row?.phone) {
    const token = createClientToken(SALON.tenantUuid, row.phone, RESET_TOKEN_TTL_MS, 'reset');
    const link = `${SALON.spaces.book}/client/set-password?rt=${encodeURIComponent(token)}`;
    await sendResetEmail(normalizedEmail, link);
  }
  return { ok: true };
}

/** Email de définition/réinitialisation de mot de passe (bilingue FR/EN). */
async function sendResetEmail(to: string, link: string): Promise<void> {
  const resendKey = process.env['RESEND_API_KEY'];
  if (!resendKey) return; // best-effort : si Resend absent, pas d'envoi
  try {
    const { Resend } = (await import('resend')) as { Resend: new (k: string) => unknown };
    const from = await resolveFromHeader(SALON.tenantUuid, SALON.name);
    const resend = new Resend(resendKey) as {
      emails: {
        send: (a: {
          from: string;
          to: string[];
          subject: string;
          text: string;
          html: string;
          tags?: { name: string; value: string }[];
        }) => Promise<unknown>;
      };
    };
    const subject = `${SALON.name} — définir votre mot de passe / set your password`;
    const text =
      `Pour définir ou réinitialiser le mot de passe de votre compte ${SALON.name}, ` +
      `ouvrez ce lien (valable 1 heure) :\n\n${link}\n\n` +
      `Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.\n\n` +
      `— — —\n\n` +
      `To set or reset your ${SALON.name} account password, open this link ` +
      `(valid for 1 hour):\n\n${link}\n\n` +
      `If you didn't request this, you can ignore this email.`;
    const html =
      `<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#18160F;">` +
      `<h1 style="font-size:20px;font-weight:600;margin:0 0 16px;">${SALON.name}</h1>` +
      `<p style="font-size:14px;color:#5A554C;margin:0 0 20px;">Définissez ou réinitialisez le mot de passe de votre compte (lien valable 1 heure) :</p>` +
      `<p style="margin:0 0 24px;"><a href="${link}" style="display:inline-block;background:#1A1714;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-size:14px;font-weight:600;">Définir mon mot de passe</a></p>` +
      `<p style="font-size:12px;color:#8A8478;margin:0;">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email. / If you didn't request this, ignore this email.</p>` +
      `</div>`;
    await resend.emails.send({
      from,
      to: [to],
      subject,
      text,
      html,
      tags: [{ name: 'type', value: 'client-password-reset' }],
    });
  } catch {
    // best-effort
  }
}

// ─── setClientPassword ──────────────────────────────────────────────────────────

export type SetPasswordResult =
  | { ok: true; phone: string }
  | { ok: false; code: 'invalidToken' | 'weakPassword' | 'dbError' };

/**
 * Consomme un token de réinitialisation (depuis le lien email) et pose le
 * nouveau mot de passe (hash scrypt). En cas de succès, connecte directement
 * le client (pose la session).
 */
export async function setClientPassword(
  resetToken: string,
  newPassword: string,
): Promise<SetPasswordResult> {
  // expectedPurpose='reset' : seul un token émis par requestClientPasswordReset
  // peut servir ici. Un cookie de session volé est rejeté.
  const verified = verifyClientToken(resetToken, SALON.tenantUuid, 'reset');
  if (!verified?.phone) return { ok: false, code: 'invalidToken' };
  if (!isPasswordStrongEnough(newPassword)) return { ok: false, code: 'weakPassword' };

  const password_hash = await hashPassword(newPassword);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { error } = await admin
    .from('client_profiles')
    .update({ password_hash, updated_at: new Date().toISOString() })
    .eq('phone', verified.phone);
  if (error) return { ok: false, code: 'dbError' };

  await setClientSession(verified.phone);
  return { ok: true, phone: verified.phone };
}

// ─── logoutClient ────────────────────────────────────────────────────────────

export async function logoutClient(): Promise<{ ok: true }> {
  await clearClientSession();
  return { ok: true };
}
