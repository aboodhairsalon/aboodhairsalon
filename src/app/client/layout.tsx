/**
 * Layout /client — espace réservation public du salon.
 *
 * Charge le contexte tenant (branding, collections) depuis les headers
 * middleware (x-tenant-id, x-tenant-slug, x-tenant-brand-*) via
 * `getPublicTenantData()` — aucune session Supabase Auth requise.
 *
 * L'espace client est entièrement public : tout visiteur disposant de l'URL
 * /{slug}/client peut réserver sans créer de compte Direction.
 *
 * Si aucun tenant n'est résolu (accès direct /client sans slug), un message
 * d'orientation est affiché plutôt qu'une erreur.
 */
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { TenantProvider } from '../_components/TenantProvider';
import { ToastProvider } from '../_components/Toast';
import { getPublicTenantData } from './data';

export const dynamic = 'force-dynamic';

/**
 * Metadata + OpenGraph dynamiques par tenant — quand un client partage le
 * lien `/aboodhairsalon/client` sur WhatsApp / iMessage / FB / Twitter / etc.,
 * la preview affiche :
 *  - « Book in one click » comme titre accroche (toujours en anglais, demande
 *    business du fondateur pour viser un public international/touristique)
 *  - le nom du salon + ville comme description (donne le contexte)
 *  - le logo du salon comme og:image
 *
 * Le `<title>` du tab navigateur reste le nom du salon (UX desktop : on veut
 * savoir quel onglet est lequel quand on en a plusieurs).
 *
 * Les meta sont lues côté serveur depuis les headers middleware (déjà résolus
 * via le slug). Pour le logo, on requête `tenant_branding` car le data URL
 * n'est pas dans les headers (trop volumineux). En cas de DB down on tombe
 * sur un OG sans image — le partage reste cohérent (titre + desc OK).
 */
export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const slug = h.get('x-tenant-slug') ?? '';
  const tenantName = h.get('x-tenant-name') ?? 'Salon';
  const tenantSource = h.get('x-tenant-source') ?? 'path';

  // OG image : URL HTTPS absolue servie par notre route /client/og-image.
  // Les crawlers WhatsApp / Facebook / iMessage REFUSENT les data URLs et
  // les URLs relatives — ils exigent un host absolu fetchable.
  //
  // RÈGLE : on construit l'URL OG sur le MÊME host que celui de la requête
  // courante, sinon WhatsApp crawle un autre host (cross-origin) qui n'a
  // pas forcément les bons headers tenant. Pour `www.aboodhairsalon.com`,
  // l'OG image doit être servie depuis `www.aboodhairsalon.com/client/og-image`
  // (pas depuis app.system-aone.com).
  //
  //  - custom_domain    : host courant (ex. www.aboodhairsalon.com)
  //                       → /client/og-image (pas de slug prefix)
  //  - subdomain        : host courant (ex. aboodhairsalon.system-aone.com)
  //                       → /client/og-image
  //  - path             : ROOT_DOMAIN env (ex. app.system-aone.com)
  //                       → /{slug}/client/og-image
  const currentHost = h.get('host') ?? '';
  const rootDomain = process.env['NEXT_PUBLIC_ROOT_DOMAIN'] ?? 'app.system-aone.com';
  const isLocalhost = currentHost.startsWith('localhost') || rootDomain.startsWith('localhost');
  const protocol = isLocalhost ? 'http' : 'https';
  let ogImageUrl: string;
  if (tenantSource === 'custom_domain' || tenantSource === 'subdomain') {
    // Le tenant est résolu via le host — on sert /client/og-image directement
    // sur ce host. Pas de slug prefix dans le chemin.
    ogImageUrl = `${protocol}://${currentHost}/client/og-image`;
  } else if (slug) {
    // Path-based (app.system-aone.com/{slug}/...) — utilise ROOT_DOMAIN et
    // préfixe par le slug pour atteindre la route via le middleware rewrite.
    ogImageUrl = `${protocol}://${rootDomain}/${slug}/client/og-image`;
  } else {
    ogImageUrl = `${protocol}://${rootDomain}/client/og-image`;
  }
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

  // Manifest URL — pattern identique à l'OG image : sur custom_domain/subdomain
  // on sert /client/manifest directement (pas de slug prefix), sur path-based
  // on préfixe par le slug pour atteindre la route via le middleware rewrite.
  const manifestPath =
    tenantSource === 'custom_domain' || tenantSource === 'subdomain'
      ? '/client/manifest'
      : slug
        ? `/${slug}/client/manifest`
        : '/client/manifest';

  return {
    manifest: manifestPath,
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
          <p className="text-[15px] text-[#A1A1AA]">Aucun établissement trouvé.</p>
          <p className="mt-2 text-[13px] text-[#52525B]">
            Utilisez le lien fourni par votre salon pour accéder à l&apos;espace de réservation.
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
