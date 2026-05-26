/**
 * Layout /site — page MARKETING publique du salon (apex aboodhairsalon.com).
 *
 * Override le metadata + le robots du root layout : on autorise l'indexation
 * (c'est l'inverse de /manager + /cashier qui restent noindex) et on pose
 * le bon OG/twitter pour les partages.
 *
 * Single-tenant : nom + URL canonique + OG image viennent de @/config/salon.
 */
import type { Metadata } from 'next';
import { SALON } from '@/config/salon';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const tenantName = SALON.name;
  const canonicalUrl = SALON.url;
  const ogImageUrl = `${SALON.url}/client/og-image`;

  const description = `Premium men's grooming at ${tenantName}. Bespoke haircuts, beard care and treatments delivered with precision and discretion.`;

  return {
    title: `${tenantName} — Men's salon`,
    description,
    alternates: { canonical: canonicalUrl },
    robots: { index: true, follow: true },
    openGraph: {
      title: tenantName,
      description,
      type: 'website',
      siteName: tenantName,
      url: canonicalUrl,
      images: [
        {
          url: ogImageUrl,
          secureUrl: ogImageUrl,
          alt: tenantName,
          width: 1200,
          height: 630,
          type: 'image/png',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: tenantName,
      description,
      images: [ogImageUrl],
    },
  };
}

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
