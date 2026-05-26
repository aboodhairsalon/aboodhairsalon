/**
 * Manifest PWA de l'espace Réservation client.
 *
 * Servi à `/{slug}/client/manifest` après réécriture par le middleware,
 * qui injecte les headers `x-tenant-*` (nom, slug, couleur). Le manifest
 * est dynamique : nom + couleur + LOGO viennent du tenant courant. Quand
 * le client installe la PWA sur son écran d'accueil, il voit le vrai
 * logo du salon comme icône (au lieu d'un carré générique).
 */
import { headers } from 'next/headers';
import { createAdminClient } from '@/db';
import { buildSpaceManifest } from '../../_pwa/manifest-builder';

export const dynamic = 'force-dynamic';

export async function GET() {
  const h = await headers();
  const tenantId = h.get('x-tenant-id');
  const tenantName = h.get('x-tenant-name') ?? 'Salon';
  const brandPrimary = h.get('x-tenant-brand-primary') ?? '#D08C4F';
  const slug = h.get('x-tenant-slug') ?? '';

  // Lit le logo du tenant pour l'utiliser comme icône PWA. Bypass RLS via
  // l'admin client — `tenant_branding.logo_url` est de toute façon servi
  // publiquement sur les pages /client, donc pas de fuite (le tenant_id
  // est déjà résolu par le middleware via le slug public).
  let logoUrl: string | null = null;
  if (tenantId) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createAdminClient() as any;
      const res = await admin
        .from('tenant_branding')
        .select('logo_url')
        
        .maybeSingle();
      logoUrl = (res.data as { logo_url?: string } | null)?.logo_url ?? null;
    } catch {
      // Best-effort : si la DB est down, on tombe sur l'icône SVG fallback.
    }
  }

  const manifest = buildSpaceManifest({
    spaceLabel: 'Réservation',
    spacePath: 'client',
    tenantName,
    brandPrimary,
    slug,
    logoUrl,
  });

  return new Response(JSON.stringify(manifest), {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
