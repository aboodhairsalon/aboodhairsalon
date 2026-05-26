import 'server-only';
/**
 * Charge le contexte tenant pour la page marketing /site.
 *
 * Pattern identique à client/data.ts : lecture via x-tenant-id depuis les
 * headers middleware + admin client (RLS bypass car page publique).
 *
 * Différence : on charge UNIQUEMENT ce dont la page marketing a besoin
 * (branding + settings + services + staff + gallery). Pas de products,
 * pas de cashier_shifts, pas de RDV.
 */
import { headers } from 'next/headers';
import { createAdminClient } from '@/db';

export interface SiteTenantData {
  tenant: {
    id: string;
    slug: string;
    name: string;
    currency: string;
    timezone: string;
  };
  branding: {
    logo_url: string | null;
    brand_primary: string;
    brand_glow: string;
    brand_deep: string;
  };
  settings: {
    tagline: string | null;
    address_street: string | null;
    address_city: string | null;
    address_zip: string | null;
    branch: string | null;
    contact_phone: string | null;
    contact_email: string | null;
    contact_website: string | null;
    contact_instagram: string | null;
    hours_text: string | null;
    maps_url: string | null;
  };
  services: Array<{
    id: string;
    name: string;
    duration_min: number;
    price_cents: number;
    icon: string;
    sort_order: number;
  }>;
  staff: Array<{
    id: string;
    name: string;
    role: string | null;
    photo_url: string | null;
    initials: string;
    tone: string;
    sort_order: number;
  }>;
  gallery: Array<{
    id: string;
    photo_url: string;
    caption: string | null;
    sort_order: number;
  }>;
}

export async function getSiteTenantData(): Promise<SiteTenantData | null> {
  const h = await headers();
  const tenantId = h.get('x-tenant-id');
  if (!tenantId) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const [tenantRes, brandingRes, settingsRes, servicesRes, staffRes, galleryRes] =
    await Promise.all([
      admin.from('tenants').select('*').eq('id', tenantId).maybeSingle(),
      admin.from('tenant_branding').select('*').maybeSingle(),
      admin.from('tenant_settings').select('*').maybeSingle(),
      admin
        .from('services')
        .select('id, name, duration_min, price_cents, icon, sort_order')
        
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      admin
        .from('staff')
        .select('id, name, role, photo_url, initials, tone, sort_order')
        
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      admin
        .from('tenant_gallery')
        .select('id, photo_url, caption, sort_order')
        
        .order('sort_order', { ascending: true }),
    ]);

  if (!tenantRes.data || !brandingRes.data || !settingsRes.data) return null;

  return {
    tenant: {
      id: tenantRes.data.id,
      slug: tenantRes.data.slug,
      name: tenantRes.data.name,
      currency: tenantRes.data.currency,
      timezone: tenantRes.data.timezone,
    },
    branding: {
      logo_url: brandingRes.data.logo_url,
      brand_primary: brandingRes.data.brand_primary,
      brand_glow: brandingRes.data.brand_glow,
      brand_deep: brandingRes.data.brand_deep,
    },
    settings: {
      tagline: settingsRes.data.tagline,
      address_street: settingsRes.data.address_street,
      address_city: settingsRes.data.address_city,
      address_zip: settingsRes.data.address_zip,
      branch: settingsRes.data.branch,
      contact_phone: settingsRes.data.contact_phone,
      contact_email: settingsRes.data.contact_email,
      contact_website: settingsRes.data.contact_website,
      contact_instagram: settingsRes.data.contact_instagram,
      hours_text: settingsRes.data.hours_text,
      maps_url: settingsRes.data.maps_url,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    services: (servicesRes.data ?? []) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    staff: (staffRes.data ?? []) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    gallery: (galleryRes.data ?? []) as any,
  };
}
