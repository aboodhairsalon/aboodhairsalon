/**
 * Convertit un nom lisible en slug URL-safe.
 *
 *   slugify('Abood Hair Salon')        → 'abood-hair-salon'
 *   slugify('Maison Lefèvre — 1947')   → 'maison-lefevre-1947'
 *   slugify('  Le 5° Élément  ')       → 'le-5-element'
 *   slugify('@@@')                      → ''
 *
 * Règles :
 *  - lowercase ASCII
 *  - accents/diacritiques retirés (é → e, î → i, ç → c…)
 *  - tout ce qui n'est pas [a-z0-9] est compacté en un seul tiret
 *  - pas de tirets en début/fin
 *  - longueur max 50 caractères (Postgres `text` est illimité mais on cap pour URLs)
 *
 * Sortie vide possible si l'input ne contient que des caractères non-ASCII non-décomposables.
 * Le caller doit gérer le cas `result === ''` (ex. utiliser un fallback `tenant-{uuid}` ou refuser).
 */
export function slugify(input: string): string {
  return input
    .normalize('NFD') // décompose les diacritiques (é → e + ́)
    .replace(/[̀-ͯ]/g, '') // retire les marques de combinaison
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // tout non-alphanum → tiret
    .replace(/^-+|-+$/g, '') // strip tirets début/fin
    .slice(0, 50);
}

/**
 * Valide qu'un slug est conforme au format attendu (post-slugify).
 * Utile pour vérifier qu'un slug saisi manuellement (ou modifié) est valide.
 *
 * Règles : 1-50 chars, lowercase, alphanum + tirets, pas de tiret en début/fin,
 * pas de tirets doubles, pas vide.
 */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/.test(slug) && !slug.includes('--');
}

/**
 * Liste de slugs réservés que les tenants ne peuvent pas utiliser
 * (collision avec routes système, sous-domaines techniques, etc.).
 */
export const RESERVED_SLUGS: readonly string[] = [
  'admin',
  'api',
  'app',
  'auth',
  'login',
  'logout',
  'signup',
  'signin',
  'register',
  'pricing',
  'features',
  'about',
  'contact',
  'docs',
  'help',
  'support',
  'blog',
  'www',
  'mail',
  'email',
  'system-a',
  'system-aone',
  'systema',
  'systemaone',
  'cdn',
  'static',
  'assets',
  'public',
  '_next',
  'favicon',
  'robots',
  'sitemap',
] as const;

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.includes(slug);
}
