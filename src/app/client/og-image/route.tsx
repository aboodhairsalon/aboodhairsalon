/**
 * Route OG image dynamique : génère une image 1200×630 (format standard
 * Facebook / WhatsApp / LinkedIn) avec le logo du salon centré sur fond
 * crème + nom du salon + accroche "Book in 1 click".
 *
 * Utilise `next/og` (ImageResponse) qui rend du JSX en image PNG via
 * Satori. Avantages :
 *  - Dimensions GARANTIES 1200×630 (matche les meta tags exactement)
 *  - Format reconnu par TOUS les crawlers (Facebook, WhatsApp, iMessage,
 *    Twitter, LinkedIn, Telegram, Slack)
 *  - Composé : logo + texte = plus impactant qu'un logo seul
 *  - Pas besoin de resize image upstream
 *
 * Cache 1h CDN.
 */
import { ImageResponse } from 'next/og';
import { headers } from 'next/headers';
import { createAdminClient } from '@/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const contentType = 'image/png';
export const size = { width: 1200, height: 630 };

export async function GET(): Promise<Response> {
  const h = await headers();
  const tenantId = h.get('x-tenant-id');
  const tenantName = h.get('x-tenant-name') ?? 'Salon';
  const brandPrimary = h.get('x-tenant-brand-primary') ?? '#D08C4F';

  let logoSrc: string | null = null;
  if (tenantId) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createAdminClient() as any;
      const brandingRes = await admin
        .from('tenant_branding')
        .select('logo_url')
        
        .maybeSingle();
      const logoUrl = (brandingRes.data as { logo_url?: string | null } | null)?.logo_url ?? null;
      // ImageResponse / Satori accepte les data URLs ET les URLs HTTP(S).
      if (logoUrl) logoSrc = logoUrl;
    } catch {
      // best-effort — fallback à l'initiale ci-dessous
    }
  }

  const initial = tenantName.trim().charAt(0).toUpperCase() || '?';
  const isValidHex = /^#[0-9A-Fa-f]{6}$/.test(brandPrimary);
  const safePrimary = isValidHex ? brandPrimary : '#1A1714';

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #F4F3F0 0%, #ECEAE4 100%)',
        padding: '60px',
        fontFamily: 'sans-serif',
      }}
    >
      {/* Logo OU initiale dans un carré arrondi à la couleur du salon */}
      {logoSrc ? (
        <img
          src={logoSrc}
          width={240}
          height={240}
          alt=""
          style={{
            borderRadius: 48,
            objectFit: 'cover',
            boxShadow: '0 8px 32px rgba(40,35,28,0.18)',
          }}
        />
      ) : (
        <div
          style={{
            width: 240,
            height: 240,
            borderRadius: 48,
            background: safePrimary,
            color: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 144,
            fontWeight: 700,
            boxShadow: '0 8px 32px rgba(40,35,28,0.18)',
          }}
        >
          {initial}
        </div>
      )}

      {/* Nom du salon — gros titre */}
      <div
        style={{
          marginTop: 36,
          fontSize: 64,
          fontWeight: 700,
          color: '#18160F',
          textAlign: 'center',
          letterSpacing: '-0.02em',
        }}
      >
        {tenantName}
      </div>

      {/* Sous-titre accroche */}
      <div
        style={{
          marginTop: 12,
          fontSize: 32,
          fontWeight: 500,
          color: '#5A554C',
          textAlign: 'center',
        }}
      >
        Book in 1 click
      </div>
    </div>,
    {
      ...size,
      headers: {
        'Cache-Control': 'public, s-maxage=3600, max-age=600',
      },
    },
  );
}
