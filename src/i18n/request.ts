/**
 * Configuration de requête next-intl — résolution de la langue côté serveur
 * (lue par chaque Server Component et Server Action).
 *
 * Source de la langue, par ordre de priorité :
 *  1. Cookie `NEXT_LOCALE` posé par le LocaleSwitcher (préférence utilisateur)
 *  2. Header `Accept-Language` du navigateur (best-match contre nos locales)
 *  3. Default ROUTE-AWARE :
 *     - Espace public booking (root `/`, `/book/*`, `/profile/*`) → `en`
 *       (Alexandrie est un quartier touristique/international, clients qui
 *        scannent le QR ou cliquent sur le lien Instagram parlent souvent
 *        anglais — maximise la portée)
 *     - Espaces /cashier, /manager, /login → `fr` (équipe et gérant
 *       travaillent en français par défaut)
 */
import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { defaultLocale, isValidLocale, LOCALE_COOKIE, locales, type Locale } from './config';

/** Locale par défaut pour l'espace booking client (public). EN domine. */
const CLIENT_DEFAULT_LOCALE: Locale = 'en';
/** Locale par défaut pour les espaces équipe (cashier, manager, auth). */
const TEAM_DEFAULT_LOCALE: Locale = 'fr';

/** Détermine si la route courante est l'espace booking client (root + sub-pages
 *  de la vitrine — PAS /cashier, /manager, /login, etc.). Le middleware pose le
 *  header `x-pathname` avec le pathname canonique après éventuel rewrite. */
function isClientRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return true; // par défaut, on suppose qu'on est sur le booking
  if (
    pathname.startsWith('/cashier') ||
    pathname.startsWith('/manager') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/sys-diag')
  ) {
    return false;
  }
  return true;
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  const headersList = await headers();
  const pathname = headersList.get('x-pathname');

  const isClient = isClientRoute(pathname);

  let locale: Locale;

  if (isClient) {
    // Espace booking client : EN reste le DÉFAUT pour un PREMIER visiteur (sans
    // cookie) — visée touristique (Alexandrie). MAIS on respecte désormais tout
    // choix EXPLICITE du visiteur via le LocaleSwitcher (FR / EN / AR).
    //
    // (Avant : le cookie FR était ignoré → le sélecteur de langue était cassé
    // pour le français sur le booking, le client ne pouvait jamais voir le FR.)
    // Accept-Language reste ignoré ici : pas de cookie ⇒ EN par défaut.
    if (isValidLocale(cookieLocale)) {
      locale = cookieLocale;
    } else {
      locale = CLIENT_DEFAULT_LOCALE; // 'en' (premier visiteur, sans cookie)
    }
  } else {
    // Espaces /manager, /cashier, login : comportement classique.
    // Source : cookie explicite > Accept-Language > FR par défaut.
    if (isValidLocale(cookieLocale)) {
      locale = cookieLocale;
    } else {
      const acceptLang = headersList.get('accept-language') ?? '';
      const preferred = acceptLang
        .split(',')
        .map((part) => part.split(';')[0]?.trim().slice(0, 2).toLowerCase())
        .find((tag) => tag && (locales as readonly string[]).includes(tag));
      locale = isValidLocale(preferred) ? preferred : TEAM_DEFAULT_LOCALE;
    }
  }

  // Chargement du catalogue. Import dynamique : seul le fichier de la locale
  // active est embarqué dans le bundle de la requête (pas les 3 d'un coup).
  const messages = (await import(`./messages/${locale}.json`)).default;

  return {
    locale,
    messages,
  };
});

// Évite "unused" sur defaultLocale (gardé pour clarté de l'API export).
export { defaultLocale };
