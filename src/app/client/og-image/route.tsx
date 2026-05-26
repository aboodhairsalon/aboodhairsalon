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
 * Single-tenant : nom + couleur viennent de @/config/salon, logo lu depuis
 * la ligne unique `salon_settings` via le helper `fetchSalonLogo()`.
 *
 * Cache 1h CDN.
 */
import { ImageResponse } from 'next/og';
import { SALON } from '@/config/salon';
import { fetchSalonLogo } from '../../_data/tenant-brand';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Format standard OpenGraph 1200×630 (Facebook, WhatsApp, LinkedIn, Twitter…).
// Constante locale (PAS exportée) pour ne pas heurter `typedRoutes` qui
// n'accepte que les exports standards (GET/POST/etc) sur un Route Handler.
const SIZE = { width: 1200, height: 630 };

export async function GET(): Promise<Response> {
  const tenantName = SALON.name;
  const brandPrimary = SALON.brand.primary;

  let logoSrc: string | null = null;
  try {
    const logoUrl = await fetchSalonLogo();
    // ImageResponse / Satori accepte les data URLs ET les URLs HTTP(S).
    if (logoUrl) logoSrc = logoUrl;
  } catch {
    // best-effort — fallback à l'initiale ci-dessous
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
      ...SIZE,
      headers: {
        'Cache-Control': 'public, s-maxage=3600, max-age=600',
      },
    },
  );
}
