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
import { getTranslations } from 'next-intl/server';
import { SALON } from '@/config/salon';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const tenantName = SALON.name;
  const canonicalUrl = SALON.url;
  const ogImageUrl = `${SALON.url}/client/og-image`;

  // Métadonnées localisées (titre + description) selon la langue active.
  const t = await getTranslations('site.meta');
  const title = t('title', { name: tenantName });
  const description = t('description', { name: tenantName });

  return {
    title,
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
