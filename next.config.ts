import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

/**
 * next.config — Aboodhairsalon (single-tenant fork).
 *
 * Différences avec System A monorepo :
 *  - PAS de `transpilePackages` (plus de @system-a/*)
 *  - PAS de `typedRoutes` strict — on désactive pour permettre les routes
 *    dynamiques basiques sans complexité monorepo
 *  - Headers sécurité IDENTIQUES (HSTS, CSP frame-ancestors, etc.)
 *  - Images : Supabase Storage du nouveau projet whitelisté + AVIF/WebP
 */
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const SUPABASE_HOSTNAME = process.env['NEXT_PUBLIC_SUPABASE_URL']
  ? new URL(process.env['NEXT_PUBLIC_SUPABASE_URL']).hostname
  : '';

const config: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  poweredByHeader: false,
  images: {
    remotePatterns: SUPABASE_HOSTNAME
      ? [
          {
            protocol: 'https',
            hostname: SUPABASE_HOSTNAME,
            pathname: '/storage/v1/object/public/**',
          },
        ]
      : [],
    formats: ['image/avif', 'image/webp'],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },
};

export default withNextIntl(config);
