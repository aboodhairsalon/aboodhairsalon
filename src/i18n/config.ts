/**
 * Configuration i18n — locales supportées par Aboodhairsalon.
 *
 * Trois langues actives :
 *  - FR : langue de travail interne (équipe + gérant)
 *  - EN : langue de communication client par défaut (touristes, expatriés,
 *         clients d'Alexandrie habitués à l'anglais)
 *  - AR : langue locale, RTL — pour les clients arabophones natifs
 *
 * Approche cookie-only (pas de préfixe URL) : la langue est mémorisée dans le
 * cookie `NEXT_LOCALE` (convention next-intl) + appliquée côté serveur dans
 * `i18n/request.ts`.
 *
 * RTL : seul `ar` bascule la direction du document. Voir `getDirection()`.
 */

export const locales = ['en', 'fr', 'ar'] as const;
export type Locale = (typeof locales)[number];

/** Locale par défaut globale (fallback si aucune détection ne donne mieux). */
export const defaultLocale: Locale = 'en';

/** Nom du cookie qui mémorise la langue choisie par le visiteur. */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

/** Étiquettes affichées dans le sélecteur (court — 2-3 caractères). */
export const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'FR',
  en: 'EN',
  ar: 'AR',
};

/** Nom complet de la langue dans sa propre langue (pour menus accessibles). */
export const LOCALE_NATIVE_NAMES: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
  ar: 'العربية',
};

/** Direction d'écriture — RTL uniquement pour l'arabe. */
export function getDirection(locale: Locale): 'ltr' | 'rtl' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/** Valide une chaîne arbitraire (cookie, header) et retourne une locale sûre. */
export function isValidLocale(value: string | undefined | null): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}
