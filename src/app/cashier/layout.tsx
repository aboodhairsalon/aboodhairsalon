/**
 * /cashier layout — Server Component.
 *
 * Injecte les CSS vars de branding du salon (`--color-brand-*`) depuis la
 * config statique `@/config/salon`, et bascule l'espace en thème clair via
 * une surcharge scopée des tokens de surface (cf. `light-theme.ts`).
 *
 * Pas d'appel auth : la garde `requireCashier()` est appelée directement
 * dans chaque page protégée (cashier/page.tsx). Le layout reste public pour
 * que /cashier/login puisse s'afficher sans boucle de redirection infinie.
 */
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SALON } from '@/config/salon';
import { LIGHT_SURFACE_VARS } from '../_components/light-theme';

export function generateMetadata(): Metadata {
  return {
    manifest: '/cashier/manifest',
  };
}

export default function CashierLayout({ children }: { children: ReactNode }) {
  const primary = SALON.brand.primary;
  const deep = SALON.brand.deep;

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
