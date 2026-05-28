import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { getDirection, type Locale } from '@/i18n/config';
import { fontVariables } from './fonts';
import { fetchSalonFavicon } from './_lib/favicon';
import { SALON } from '@/config/salon';
import './globals.css';

/**
 * Root layout — Aboodhairsalon (single-tenant).
 *
 * Différences avec System A :
 *  - Favicon dynamique via `fetchSalonFavicon()` : utilise le logo du salon
 *    (`tenant_branding.logo_url`) s'il est posé et valide, sinon fallback
 *    statique `/brand/favicon.svg`.
 *  - Pas de `headers().get('x-tenant-id')` : le tenant est implicite.
 *  - Title/description via i18n (3 langues), même approche que System A.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app');
  // Favicon = logo du salon (tenant_branding.logo_url) si posé et valide ;
  // sinon fallback statique /brand/favicon.svg (géré dans fetchSalonFavicon).
  const faviconUrl = await fetchSalonFavicon();
  return {
    title: {
      default: t('title'),
      template: t('titleTemplate', { page: '%s' }),
    },
    description: t('description'),
    icons: {
      icon: faviconUrl,
      apple: faviconUrl,
      shortcut: faviconUrl,
    },
    metadataBase: new URL(SALON.url),
    openGraph: {
      title: t('title'),
      description: t('description'),
      url: SALON.url,
      siteName: SALON.name,
      images: ['/brand/og-image.png'],
      type: 'website',
    },
    robots: { index: true, follow: true },
    appleWebApp: {
      capable: true,
      // black-translucent : la barre de statut iOS devient transparente et
      // notre contenu peut passer dessous → app fullscreen vraie. On gère le
      // décalage haut via `env(safe-area-inset-top)` dans les headers stickies
      // des pages. Sur Android Chrome, la theme-color ci-dessous colore la
      // status-bar et le contenu commence dessous.
      statusBarStyle: 'black-translucent',
      title: SALON.name,
    },
  };
}

export const viewport: Viewport = {
  themeColor: '#0d0b08',
  // viewport-fit=cover indispensable pour que `env(safe-area-inset-*)`
  // retourne des valeurs >0 sur les iPhones avec encoche/Dynamic Island.
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = (await getLocale()) as Locale;
  const messages = await getMessages();
  const dir = getDirection(locale);
  return (
    <html lang={locale} dir={dir} className={fontVariables} suppressHydrationWarning>
      <body
        style={{
          // Background uniforme jusqu'aux bords physiques. En mode PWA
          // standalone, la status-bar iOS devient transparente et overlaie
          // notre contenu — sans ce background, on verrait du blanc derrière
          // l'heure/batterie sur iOS. La couleur matche le fond de l'app.
          background: '#0d0b08',
          margin: 0,
        }}
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
