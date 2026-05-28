/**
 * Layout /manager — Server Component qui :
 *  1. Force l'auth (redirect /login si pas de session)
 *  2. Charge le tenant complet (tenants + branding + settings) du user connecté
 *  3. Injecte les données dans un TenantProvider pour les Client Components
 *
 * Aucune logique client ici — purement du chargement de données.
 */
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { LIGHT_SURFACE_VARS } from '../_components/light-theme';
import { TenantProvider } from '../_components/TenantProvider';
import { ToastProvider } from '../_components/Toast';
import { requireTenant } from '../_data/auth-server';
import type { Currency } from '@/lib/money';
import { getManagerCollections } from './data';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const slug = h.get('x-tenant-slug') ?? '';
  return {
    manifest: slug ? `/${slug}/manager/manifest` : '/manager/manifest',
  };
}

export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenant();
  const collections = await getManagerCollections(ctx.tenant.id);

  return (
    <TenantProvider
      value={{
        user: {
          id: ctx.user.id,
          email: ctx.user.email ?? '',
        },
        tenant: {
          id: ctx.tenant.id,
          slug: ctx.tenant.slug,
          name: ctx.tenant.name,
          currency: ctx.tenant.currency as Currency,
          timezone: ctx.tenant.timezone,
          locale: ctx.tenant.locale,
          plan: ctx.tenant.plan,
          status: ctx.tenant.status,
          trial_ends_at: ctx.tenant.trial_ends_at,
        },
        branding: ctx.branding,
        settings: {
          tax_rate_bp: ctx.settings.tax_rate_bp,
          legal_name: ctx.settings.legal_name,
          legal_address: ctx.settings.legal_address,
          tagline: ctx.settings.tagline,
          address_street: ctx.settings.address_street,
          address_city: ctx.settings.address_city,
          address_zip: ctx.settings.address_zip,
          branch: ctx.settings.branch,
          contact_phone: ctx.settings.contact_phone,
          contact_email: ctx.settings.contact_email,
          contact_website: ctx.settings.contact_website,
          contact_instagram: ctx.settings.contact_instagram,
          hours_text: ctx.settings.hours_text,
          maps_url: ctx.settings.maps_url,
          cashback_rate_bp: ctx.settings.cashback_rate_bp,
          email_from_address: ctx.settings.email_from_address,
        },
        collections,
      }}
    >
      {/* Thème clair white-label : surcharge des tokens de surface (clair) +
          couleur du tenant sur les tokens `--color-brand-*`. Sur fond clair,
          le copper « glow » est ramené au copper profond pour rester lisible. */}
      <div
        className="text-ink min-h-screen"
        style={
          {
            ...LIGHT_SURFACE_VARS,
            background:
              'radial-gradient(ellipse 120% 50% at 50% 0%, #E3E2DD 0%, #EAE8E3 45%, #E5E4DE 100%)',
            '--color-brand-primary': ctx.branding.brand_primary,
            '--color-brand-glow': ctx.branding.brand_deep,
            '--color-brand-deep': ctx.branding.brand_deep,
          } as React.CSSProperties
        }
      >
        <ToastProvider>
          {children}
        </ToastProvider>
      </div>
    </TenantProvider>
  );
}
