/**
 * /cashier layout — Server Component.
 *
 * Injecte les CSS vars de branding du tenant (`--color-brand-*`) depuis les
 * headers x-tenant-brand-* posés par le middleware, et bascule l'espace en
 * thème clair via une surcharge scopée des tokens de surface (cf.
 * `light-theme.ts`) — sans impacter le marketing ni le funnel SaaS.
 *
 * Pas d'appel auth : la garde `requireCashier()` est appelée directement
 * dans chaque page protégée (cashier/page.tsx). Le layout reste public pour
 * que /cashier/login puisse s'afficher sans boucle de redirection infinie.
 */
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { LIGHT_SURFACE_VARS } from '../_components/light-theme';

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const slug = h.get('x-tenant-slug') ?? '';
  return {
    manifest: slug ? `/${slug}/cashier/manifest` : '/cashier/manifest',
  };
}

export default async function CashierLayout({ children }: { children: ReactNode }) {
  const headersList = await headers();
  const primary = headersList.get('x-tenant-brand-primary') ?? '#D08C4F';
  const deep = headersList.get('x-tenant-brand-deep') ?? '#9B5F26';

  return (
    <div
      className="text-ink min-h-screen"
      style={
        {
          ...LIGHT_SURFACE_VARS,
          background:
            'radial-gradient(ellipse 120% 50% at 50% 0%, #E3E2DD 0%, #EAE8E3 45%, #E5E4DE 100%)',
          '--color-brand-primary': primary,
          // Sur fond clair, le copper « glow » est ramené au copper profond
          // pour rester lisible en texte d'accent.
          '--color-brand-glow': deep,
          '--color-brand-deep': deep,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}
