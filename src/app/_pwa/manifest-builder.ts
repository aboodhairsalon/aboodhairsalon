/**
 * Constructeur de manifest PWA — une PWA par espace, branding par tenant.
 *
 * Chaque espace de l'app tenant (Réservation, Caisse, Direction) expose son
 * propre manifest dynamique, scopé sur son URL, avec le nom du salon et sa
 * couleur de marque. L'icône est générée à la volée à partir de l'initiale
 * du nom + la couleur — pas de fichier image à gérer, tenant-flavored par
 * défaut. Sur l'écran d'accueil, un caissier installe sa Caisse, un gérant
 * sa Direction, un client sa Réservation — chacun comme une app distincte.
 */
import type { MetadataRoute } from 'next';

export type SpaceLabel = 'Réservation' | 'Caisse' | 'Direction';
export type SpacePath = 'client' | 'cashier' | 'manager';

export interface BuildManifestOptions {
  spaceLabel: SpaceLabel;
  spacePath: SpacePath;
  tenantName: string;
  brandPrimary: string;
  slug: string;
  /** Logo du salon (data URL ou URL absolue). Si présent et que c'est un
   *  data URL d'image bitmap valide, on l'utilise comme icône PWA — sinon
   *  fallback SVG initiale. */
  logoUrl?: string | null;
}

/** Construit le manifest PWA pour un espace donné, branding tenant. */
export function buildSpaceManifest(opts: BuildManifestOptions): MetadataRoute.Manifest {
  const base = opts.slug ? `/${opts.slug}/${opts.spacePath}` : `/${opts.spacePath}`;
  const safeName = opts.tenantName.trim() || 'Salon';
  const initial = safeName.charAt(0).toUpperCase();
  const safePrimary = isValidHex(opts.brandPrimary) ? opts.brandPrimary : '#D08C4F';

  // Logo accepté si :
  //  - data URL bitmap (PNG/JPEG/WebP)
  //  - HTTPS URL (typiquement Supabase Storage, ex .png/.jpg/.webp)
  // Le PNG via HTTPS marche universellement sur iOS/Android pour les
  // icônes PWA. On évite seulement les SVG (certains lanceurs Android les
  // rejettent comme icône).
  const isDataBitmap =
    opts.logoUrl && /^data:image\/(png|jpeg|jpg|webp);base64,/.test(opts.logoUrl);
  const isHttpsBitmap =
    opts.logoUrl && /^https:\/\/.+\.(png|jpe?g|webp)(\?.*)?$/i.test(opts.logoUrl);
  const useLogo = Boolean(isDataBitmap || isHttpsBitmap);

  // Fallback : icône SVG inline (carré arrondi couleur salon + initiale).
  const fallbackSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
    `<rect width="512" height="512" rx="96" fill="${safePrimary}"/>` +
    `<text x="256" y="360" text-anchor="middle" font-family="serif" ` +
    `font-size="320" font-weight="bold" fill="white">${escapeSvgText(initial)}</text>` +
    `</svg>`;
  const fallbackUrl = `data:image/svg+xml;utf8,${encodeURIComponent(fallbackSvg)}`;

  const iconUrl = useLogo ? opts.logoUrl! : fallbackUrl;
  // Détecte le mime-type depuis le data URL OU depuis l'extension HTTPS
  let iconType = 'image/svg+xml';
  if (useLogo) {
    if (isDataBitmap) {
      iconType = opts.logoUrl!.match(/^data:(image\/[a-z]+);/)?.[1] ?? 'image/png';
    } else {
      const ext = opts.logoUrl!.match(/\.(png|jpe?g|webp)(\?.*)?$/i)?.[1]?.toLowerCase();
      iconType =
        ext === 'webp'
          ? 'image/webp'
          : ext === 'jpg' || ext === 'jpeg'
            ? 'image/jpeg'
            : 'image/png';
    }
  }

  return {
    name: `${safeName} · ${opts.spaceLabel}`,
    short_name: safeName.slice(0, 14),
    description: `${opts.spaceLabel} — ${safeName}`,
    start_url: base,
    scope: base,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#E8E5DD',
    theme_color: safePrimary,
    lang: 'fr',
    icons: [
      { src: iconUrl, sizes: 'any', type: iconType, purpose: 'any' },
      { src: iconUrl, sizes: 'any', type: iconType, purpose: 'maskable' },
    ],
  };
}

function escapeSvgText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isValidHex(s: string | undefined): s is string {
  return typeof s === 'string' && /^#[0-9A-Fa-f]{6}$/.test(s);
}
