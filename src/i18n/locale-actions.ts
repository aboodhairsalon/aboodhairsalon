'use server';
/**
 * Server Action — bascule de la langue active du visiteur.
 *
 * Écrit le cookie `NEXT_LOCALE` (durée 1 an, scope racine) qui sera lu par
 * `i18n/request.ts` à la prochaine requête, puis revalide le layout pour que
 * tous les Server Components soient re-rendus dans la nouvelle locale.
 */
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { isValidLocale, LOCALE_COOKIE } from './config';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function setLocale(
  locale: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isValidLocale(locale)) {
    return { ok: false, error: 'Locale invalide.' };
  }
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    maxAge: ONE_YEAR_SECONDS,
    path: '/',
    sameSite: 'lax',
    // Pas de `httpOnly: true` — le cookie peut être lu côté client par
    // next-intl pour les hydratations. Pas de donnée sensible dedans.
  });
  // Revalide tout l'arbre pour que chaque RSC se re-rende avec la nouvelle
  // locale (le cookie est lu côté serveur uniquement à `getRequestConfig`).
  revalidatePath('/', 'layout');
  return { ok: true };
}
