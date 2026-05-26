/**
 * Layout /site — page MARKETING publique du salon (apex aboodhairsalon.com).
 *
 * Override le metadata + le robots du root layout : on autorise l'indexation
 * (c'est l'inverse de /manager + /cashier qui restent noindex) et on pose
 * le bon OG/twitter pour les partages.
 *
 * Pattern identique à /client/layout.tsx pour la métadata dynamique par tenant.
 */
import type { Metadata } from 'next';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const slug = h.get('x-tenant-slug') ?? '';
  const tenantName = h.get('x-tenant-name') ?? 'Salon';
  const tenantSource = h.get('x-tenant-source') ?? 'path';
  const currentHost = h.get('host') ?? '';
  const rootDomain = process.env['NEXT_PUBLIC_ROOT_DOMAIN'] ?? 'app.system-aone.com';
  const isLocalhost = currentHost.startsWith('localhost') || rootDomain.startsWith('localhost');
  const protocol = isLocalhost ? 'http' : 'https';

  // OG image servie depuis le host courant (custom_domain / subdomain) ou
  // depuis ROOT_DOMAIN + slug (path-based). On réutilise la même route
  // og-image que /client (déjà génère un 1200×630 propre avec logo + nom).
  let ogImageUrl: string;
  if (tenantSource === 'custom_domain' || tenantSource === 'subdomain') {
    ogImageUrl = `${protocol}://${currentHost}/client/og-image`;
  } else if (slug) {
    ogImageUrl = `${protocol}://${rootDomain}/${slug}/client/og-image`;
  } else {
    ogImageUrl = `${protocol}://${rootDomain}/client/og-image`;
  }

  // URL canonique = apex sans www (norme moderne — Google, GitHub, Vercel
  // l'utilisent comme préférence). Si quelqu'un partage le lien avec www,
  // les crawlers verront le canonical et conserveront le PageRank sur apex.
  const canonicalUrl =
    tenantSource === 'custom_domain'
      ? `${protocol}://${currentHost.replace(/^www\./, '')}`
      : `${protocol}://${currentHost}/`;

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
