import 'server-only';
/**
 * Charge le contexte du salon pour la page marketing /site.
 *
 * Single-tenant : on lit `tenants`, `tenant_branding`, `tenant_settings` via
 * `.maybeSingle()` (la table ne contient qu'UNE ligne en mono-app). Les valeurs
 * statiques (timezone, currency, brand colors) viennent en fallback de
 * `@/config/salon` si la DB est vide ou pas encore initialisée.
 *
 * Plus de guard `x-tenant-id` (le middleware ne pose plus ces headers) — le
 * salon est unique et la page marketing est toujours servie pour Aboodhairsalon.
 */
import { getLocale } from 'next-intl/server';
import { createAdminClient } from '@/db';
import { SALON } from '@/config/salon';
import { pickLocale, shortLocale, type I18nText } from '@/lib/pick-locale';

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const [tenantRes, brandingRes, settingsRes, servicesRes, staffRes, galleryRes] =
    await Promise.all([
      admin.from('tenants').select('*').maybeSingle(),
      admin.from('tenant_branding').select('*').maybeSingle(),
      admin.from('tenant_settings').select('*').maybeSingle(),
      admin
        .from('services')
        .select('id, name, name_i18n, duration_min, price_cents, icon, sort_order')
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

  // Si la DB est totalement vide (premier boot, tables non seedées), on
  // construit quand même un objet exploitable à partir de la config statique.
  // Les sections services/staff/gallery seront simplement vides côté UI.
  const t = tenantRes.data as Record<string, unknown> | null;
  const b = brandingRes.data as Record<string, unknown> | null;
  const s = settingsRes.data as Record<string, unknown> | null;

  // Langue active — pour résoudre les noms de prestations multilingues.
  const locale = shortLocale(await getLocale());

  return {
    tenant: {
      id: (t?.['id'] as string | undefined) ?? SALON.slug,
      slug: (t?.['slug'] as string | undefined) ?? SALON.slug,
      name: (t?.['name'] as string | undefined) ?? SALON.name,
      currency: (t?.['currency'] as string | undefined) ?? SALON.currency,
      timezone: (t?.['timezone'] as string | undefined) ?? SALON.timezone,
    },
    branding: {
      logo_url: (b?.['logo_url'] as string | null | undefined) ?? SALON.logoUrl,
      brand_primary: (b?.['brand_primary'] as string | undefined) ?? SALON.brand.primary,
      brand_glow: (b?.['brand_glow'] as string | undefined) ?? SALON.brand.glow,
      brand_deep: (b?.['brand_deep'] as string | undefined) ?? SALON.brand.deep,
    },
    settings: {
      tagline: (s?.['tagline'] as string | null | undefined) ?? SALON.tagline,
      address_street: (s?.['address_street'] as string | null | undefined) ?? null,
      address_city: (s?.['address_city'] as string | null | undefined) ?? SALON.address.city,
      address_zip: (s?.['address_zip'] as string | null | undefined) ?? null,
      branch: (s?.['branch'] as string | null | undefined) ?? null,
      contact_phone: (s?.['contact_phone'] as string | null | undefined) ?? SALON.contact.phone,
      contact_email: (s?.['contact_email'] as string | null | undefined) ?? SALON.contact.email,
      contact_website: (s?.['contact_website'] as string | null | undefined) ?? null,
      contact_instagram:
        (s?.['contact_instagram'] as string | null | undefined) ?? SALON.contact.instagram,
      hours_text: (s?.['hours_text'] as string | null | undefined) ?? null,
      maps_url:
        (s?.['maps_url'] as string | null | undefined) ?? SALON.contact.googleMapsUrl ?? null,
    },
    // Nom de prestation résolu dans la langue active (name_i18n) — sinon /site
    // affichait toujours le nom brut de la DB (souvent en arabe) quelle que
    // soit la langue choisie par le visiteur. Repli sur le nom brut si manquant.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    services: ((servicesRes.data ?? []) as any[]).map((sv) => ({
      ...sv,
      name: pickLocale(sv.name_i18n as I18nText, locale, sv.name as string),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    staff: (staffRes.data ?? []) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    gallery: (galleryRes.data ?? []) as any,
  };
}
