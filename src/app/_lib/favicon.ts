/**
 * fetchSalonFavicon — résout l'icône favicon à utiliser.
 *
 * Single-tenant (Aboodhairsalon) :
 *  1. Si `salon_settings.logo_url` est posé ET valide (HTTPS bitmap ou data
 *     URL bitmap), on le retourne tel quel.
 *  2. Sinon, fallback statique `/brand/favicon.svg` (servi depuis public/).
 *  3. En dernier recours, SVG inline carré couleur de marque + initiale 'A'.
 *
 * Cache : LRU mémoire 60 s. Évite de poser une query DB sur CHAQUE page
 * (le browser refetch le favicon à chaque nav SPA + sur chaque onglet).
 * Le TTL court accepte une fenêtre de propagation post-upload : le manager
 * voit le maj dans la barre d'onglet dans la minute qui suit son upload.
 */
import { createAdminClient } from '@/db';
import { SALON } from '@/config/salon';

interface CacheEntry {
  iconUrl: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 60 * 1000;
let cache: CacheEntry | null = null;

const FALLBACK_FAVICON = '/brand/favicon.svg';

/** Compat-shim avec l'ancienne API multi-tenant. `_tenantId` est ignoré.
 *  Conservé pour les call-sites qui passent `headers().get('x-tenant-id')`. */
export async function fetchTenantFavicon(_tenantId?: string): Promise<string> {
  return fetchSalonFavicon();
}

export async function fetchSalonFavicon(): Promise<string> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.iconUrl;
  }

  let iconUrl = FALLBACK_FAVICON;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('tenant_branding')
      .select('logo_url')
      .eq('tenant_id', SALON.tenantUuid)
      .maybeSingle();
    const logo = data?.logo_url ?? null;

    // Accepte data URL bitmap (PNG/JPEG/WebP/SVG) OU HTTPS URL bitmap.
    const isDataBitmap =
      typeof logo === 'string' && /^data:image\/(png|jpeg|jpg|webp|svg\+xml);/.test(logo);
    const isHttpsBitmap =
      typeof logo === 'string' && /^https:\/\/.+\.(png|jpe?g|webp|ico|svg)(\?.*)?$/i.test(logo);

    if (logo && (isDataBitmap || isHttpsBitmap)) {
      iconUrl = logo;
    } else {
      // Fallback statique servi depuis public/brand/favicon.svg.
      iconUrl = FALLBACK_FAVICON;
    }
  } catch {
    // Fail silently — un favicon manquant n'est jamais une raison de casser
    // le rendu. Le fallback statique est servi.
    iconUrl = FALLBACK_FAVICON;
  }

  cache = { iconUrl, expiresAt: Date.now() + CACHE_TTL_MS };
  return iconUrl;
}

/** Génère un SVG inline avec l'initiale du salon + couleur de marque.
 *  Utilisé en dernier recours quand même /brand/favicon.svg n'est pas dispo. */
export function generateFallbackFaviconDataURL(): string {
  const initial = Array.from(SALON.name)[0]?.toUpperCase() ?? 'A';
  const primary = SALON.brand.primary;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="12" fill="${primary}"/>` +
    `<text x="32" y="44" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" ` +
    `font-size="38" font-weight="700" fill="white">${escapeSvg(initial)}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function escapeSvg(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Invalide le cache — à appeler depuis le manager après upload logo. */
export function clearFaviconCache(): void {
  cache = null;
}
