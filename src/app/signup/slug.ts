/**
 * Helpers slug — copie locale (apps/tenant) pour éviter un TDZ webpack
 * sur la frontière Server Action ↔ Client Component qui partagent un import
 * depuis `@/lib`.
 *
 * Tests : couverts dans `packages/lib/src/slugify.test.ts` (même logique).
 */

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/.test(slug) && !slug.includes('--');
}

const RESERVED_SLUGS = new Set([
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
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}
