/**
 * Manifest PWA de l'espace Caisse.
 *
 * Servi à `/{slug}/cashier/manifest` après réécriture par le middleware,
 * qui injecte les headers `x-tenant-*`. Le manifest est dynamique : nom,
 * couleur ET LOGO viennent du tenant courant. Quand le caissier installe
 * la PWA sur son écran d'accueil, il voit le vrai logo du salon (au lieu
 * d'un carré générique avec l'initiale).
 */
import { createAdminClient } from '@/db';
import { headers } from 'next/headers';
import { buildSpaceManifest } from '../../_pwa/manifest-builder';

export const dynamic = 'force-dynamic';

export async function GET() {
  const h = await headers();
  const tenantId = h.get('x-tenant-id');
  const tenantName = h.get('x-tenant-name') ?? 'Salon';
  const brandPrimary = h.get('x-tenant-brand-primary') ?? '#D08C4F';
  const slug = h.get('x-tenant-slug') ?? '';

  // Lit le logo du tenant pour l'utiliser comme icône PWA (idem /client).
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
      // Best-effort : si DB down, fallback sur icône SVG initiale.
    }
  }

  const manifest = buildSpaceManifest({
    spaceLabel: 'Caisse',
    spacePath: 'cashier',
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
