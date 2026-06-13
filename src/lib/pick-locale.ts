/**
 * Résolution d'un libellé de contenu multilingue (jsonb { fr, en, ar }) vers
 * la langue courante. Utilisé pour les noms/descriptions de prestations,
 * produits, sections — qui sont stockés par langue en base et doivent suivre
 * la locale choisie.
 *
 * Stratégie de repli : langue demandée → 1re traduction renseignée → `fallback`
 * (le texte d'origine `name`/`category`). Évite d'afficher un champ vide ou la
 * mauvaise langue à un client si une traduction manque.
 */
export type I18nText = Record<string, string> | null | undefined;

export function pickLocale(i18n: I18nText, locale: string, fallback: string): string {
  if (!i18n || typeof i18n !== 'object') return fallback;
  const direct = i18n[locale];
  if (direct && direct.trim()) return direct;
  const any = Object.values(i18n).find((v) => typeof v === 'string' && v.trim());
  return any || fallback;
}

/** Locale courte ('fr'|'en'|'ar') normalisée depuis une valeur next-intl
 *  (qui peut être 'fr-FR', 'fr', etc.). */
export function shortLocale(locale: string | null | undefined): string {
  return (locale ?? 'fr').slice(0, 2).toLowerCase();
}
