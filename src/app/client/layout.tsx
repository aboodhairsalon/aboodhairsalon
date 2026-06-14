/**
 * Layout /client — espace réservation public du salon.
 *
 * Single-tenant : le branding et les collections viennent du contexte chargé
 * par `getPublicTenantData()` (qui lit `salon_settings` + collections). Aucune
 * session Supabase Auth requise — l'espace client est entièrement public.
 *
 * Si la DB est inaccessible (premier boot ou maintenance), un message
 * d'orientation est affiché plutôt qu'une erreur.
 */
import type { Metadata } from 'next';
import { SALON } from '@/config/salon';
import { TenantProvider } from '../_components/TenantProvider';
import { ToastProvider } from '../_components/Toast';
import { getPublicTenantData } from './data';

export const dynamic = 'force-dynamic';

/**
 * Metadata + OpenGraph — quand un client partage le lien du salon sur
 * WhatsApp / iMessage / FB / Twitter / etc., la preview affiche :
 *  - le NOM du salon comme titre (Aboodhairsalon)
 *  - « Book in 1 click » comme accroche EN (demande business : viser un
 *    public international/touristique)
 *  - le logo du salon comme og:image (servi par /client/og-image)
 *
 * Le `<title>` du tab navigateur reste le nom du salon (UX desktop : on veut
 * savoir quel onglet est lequel quand on en a plusieurs).
 *
 * Single-tenant : tout est dérivé de `SALON.url` (config statique).
 */
export function generateMetadata(): Metadata {
  const tenantName = SALON.name;
  const ogImageUrl = `${SALON.url}/client/og-image`;
  const ogImage = {
    url: ogImageUrl,
    secureUrl: ogImageUrl,
    alt: tenantName,
    // Dimensions GARANTIES par next/og ImageResponse (1200×630 = format
    // standard Facebook/WhatsApp large preview). Si les crawlers vérifient
    // que dimensions déclarées matchent l'image servie (Facebook le fait),
    // ils acceptent.
    width: 1200,
    height: 630,
    type: 'image/png' as const,
  };

  // Demande business : sur la preview de partage, on veut
  //   - Titre = NOM DU SALON (« Aboodhairsalon »)
  //   - Description = « Book in 1 click » (accroche en anglais)
  //   - Image = logo
  // Cohérent avec la priorité EN sur /client (l'app elle-même est en anglais
  // par défaut, donc l'accroche aussi).
  const shareSubtitle = 'Book in 1 click';

  return {
    manifest: '/client/manifest',
    title: tenantName,
    description: shareSubtitle,
    // Override le `robots: { index: false, follow: false }` du root layout.
    // Sans ça, WhatsApp/Facebook/iMessage refusent silencieusement de générer
    // un link preview (ils respectent le noindex). Les pages /manager et
    // /cashier restent noindex via leur propre layout. Pour /client (page
    // publique de réservation), on AUTORISE l'indexation + preview OG —
    // c'est exactement ce qu'on veut quand un salon partage son lien.
    robots: { index: true, follow: true },
    openGraph: {
      title: tenantName,
      description: shareSubtitle,
      type: 'website',
      siteName: tenantName,
      images: [ogImage],
    },
    twitter: {
      card: 'summary_large_image',
      title: tenantName,
      description: shareSubtitle,
      images: [ogImageUrl],
    },
  };
}

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const session = await getPublicTenantData();

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0A0A0A] p-6 text-center">
        <div>
          <p className="text-[15px] text-[#A1A1AA]">Salon not found.</p>
          <p className="mt-2 text-[13px] text-[#52525B]">
            Use the link provided by your salon to access the booking area.
          </p>
        </div>
      </div>
    );
  }

  return (
    <TenantProvider value={session}>
      {/* ToastProvider — nécessaire pour que useToast() côté client
          (cancelBooking, futurs feedbacks) affiche des toasts au lieu
          de window.alert(). Sans ce wrapper, useToast() retourne une
          API silencieuse no-op. */}
      <ToastProvider>
        {/* Applique les tokens brand du tenant + safe-area pour mode PWA.
            En standalone (PWA installée), `viewport-fit=cover` + apple
            `black-translucent` font passer notre contenu SOUS la status-bar
            iOS. Sans padding-top = safe-area-inset-top, la salutation se
            retrouverait masquée par l'heure / Dynamic Island.
            Le padding s'applique aussi en mode web classique (env() = 0px
            alors) — pas besoin de media-query display-mode. */}
        <div
          className="min-h-screen"
          style={
            {
              '--color-brand-primary': session.branding.brand_primary,
              '--color-brand-glow': session.branding.brand_glow,
              '--color-brand-deep': session.branding.brand_deep,
              paddingTop: 'env(safe-area-inset-top, 0px)',
              background: '#F4F3F0',
            } as React.CSSProperties
          }
        >
          {children}
        </div>
      </ToastProvider>
    </TenantProvider>
  );
}
