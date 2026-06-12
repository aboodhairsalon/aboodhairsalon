'use server';
/**
 * Server Action — connexion Direction (manager).
 *
 * Avant : le formulaire signait directement côté navigateur
 * (supabase.auth.signInWithPassword) → AUCUN rate-limit → un attaquant
 * pouvait brute-forcer le mot de passe du gérant sans frein (l'email
 * aboodhairsalon@gmail.com est devinable). Les logins caissier ET client
 * étaient déjà rate-limités ; seul le manager ne l'était pas (audit sécu).
 *
 * Désormais : on passe par cette action server-side qui rate-limite par
 * email + IP, puis effectue le signIn server-side (pose le cookie de
 * session via l'adaptateur SSR). Réponse générique en cas d'échec — pas
 * de fuite « cet email existe-t-il ».
 */
import { headers } from 'next/headers';
import { getServerSupabase } from '../_data/supabase-server';
import { rlLoginEmail, rlLoginIp } from '../_lib/rate-limit';

export type ManagerLoginResult =
  | { ok: true }
  | { ok: false; code: 'invalidCredentials' | 'rateLimited' | 'missingParams' };

export async function loginManager(
  email: string,
  password: string,
): Promise<ManagerLoginResult> {
  const normalizedEmail = (email ?? '').trim().toLowerCase();
  if (!normalizedEmail || !password) return { ok: false, code: 'missingParams' };

  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown';
  const [emailOk, ipOk] = await Promise.all([
    rlLoginEmail(`manager:${normalizedEmail}`),
    rlLoginIp(ip),
  ]);
  if (!emailOk || !ipOk) return { ok: false, code: 'rateLimited' };

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });
  // Message générique — on ne distingue pas « email inconnu » de « mauvais
  // mot de passe » pour ne pas confirmer l'existence d'un compte.
  if (error) return { ok: false, code: 'invalidCredentials' };

  return { ok: true };
}
