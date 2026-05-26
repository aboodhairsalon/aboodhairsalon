/**
 * Manifest PWA de l'espace Direction (manager).
 *
 * Single-tenant : nom + couleur viennent de @/config/salon, logo lu depuis
 * la ligne unique `salon_settings` via `fetchSalonLogo()`. Quand le gérant
 * installe la PWA sur son écran d'accueil, il voit le vrai logo du salon
 * (au lieu d'un carré générique avec l'initiale).
 */
import { SALON } from '@/config/salon';
import { fetchSalonLogo } from '../../_data/tenant-brand';
import { buildSpaceManifest } from '../../_pwa/manifest-builder';

export const dynamic = 'force-dynamic';

export async function GET() {
  let logoUrl: string | null = null;
  try {
    logoUrl = await fetchSalonLogo();
  } catch {
    // Best-effort : si DB down, fallback sur icône SVG initiale.
  }

  const manifest = buildSpaceManifest({
    spaceLabel: 'Direction',
    spacePath: 'manager',
    tenantName: SALON.name,
    brandPrimary: SALON.brand.primary,
    slug: '', // single-tenant : pas de prefix slug dans les URLs PWA
    logoUrl,
  });

  return new Response(JSON.stringify(manifest), {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
