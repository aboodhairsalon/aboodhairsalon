/**
 * Manifest PWA de l'espace Réservation client.
 *
 * Single-tenant : nom + couleur viennent de @/config/salon, logo lu depuis
 * la ligne unique `salon_settings` via `fetchSalonLogo()`. Quand le client
 * installe la PWA sur son écran d'accueil, il voit le vrai logo du salon
 * comme icône (au lieu d'un carré générique).
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
    // Best-effort : si la DB est down, on tombe sur l'icône SVG fallback.
  }

  const manifest = buildSpaceManifest({
    spaceLabel: 'Réservation',
    spacePath: 'client',
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
