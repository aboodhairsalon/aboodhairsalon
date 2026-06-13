import 'server-only';
/**
 * Chargement du contexte salon pour l'espace client public.
 *
 * Single-tenant : on lit `tenants`, `tenant_branding`, `tenant_settings` via
 * `.maybeSingle()` (la table ne contient qu'UNE ligne en mono-app). Les valeurs
 * statiques (timezone, currency, brand colors, slug) viennent en fallback de
 * `@/config/salon` si la DB est vide.
 *
 * Plus de guard `x-tenant-id` / `x-tenant-slug` (le middleware ne pose plus ces
 * headers). L'espace client est public — aucune session Supabase Auth requise,
 * lecture via client admin (RLS bypass).
 */
import { createAdminClient } from '@/db';
import { SALON } from '@/config/salon';
import type { TenantSession } from '../_components/TenantProvider';
import type { Currency } from '@/lib/money';
import type { CashierShift, Product, Service, Staff, StaffRole } from '../_data/mock';

const SERVICE_ICONS = ['scissors', 'razor', 'crown', 'shield', 'star', 'sparkle'] as const;
type ServiceIcon = (typeof SERVICE_ICONS)[number];

function toServiceIcon(raw: string | null): ServiceIcon {
  return (SERVICE_ICONS as readonly string[]).includes(raw ?? '')
    ? (raw as ServiceIcon)
    : 'scissors';
}

/**
 * Charge le contexte complet du salon (branding, settings, collections).
 *
 * Toutes les requêtes utilisent le client admin (bypass RLS) puisque l'espace
 * /client est public et ne porte pas de session. Les fallbacks SALON sont
 * appliqués si une ligne est absente — l'UI doit toujours afficher quelque
 * chose de cohérent même au premier boot.
 */
export async function getPublicTenantData(): Promise<TenantSession | null> {
  const admin = createAdminClient();

  // Requêtes parallèles — toutes via admin client (RLS bypass), une seule
  // instance salon donc `.maybeSingle()` sur les tables de config.
  const [tenantRes, brandingRes, settingsRes, staffRes, servicesRes, productsRes, galleryRes] =
    await Promise.all([
      admin.from('tenants').select('*').maybeSingle(),
      admin.from('tenant_branding').select('*').maybeSingle(),
      admin.from('tenant_settings').select('*').maybeSingle(),
      admin
        .from('staff')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
      admin
        .from('services')
        .select('*, service_barbers(barber_id)')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
      admin
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: true }),
      admin
        .from('tenant_gallery')
        .select('id, photo_url, caption, sort_order')
        .order('sort_order', { ascending: true }),
    ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = tenantRes.data as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = brandingRes.data as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = settingsRes.data as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const staff: Staff[] = ((staffRes.data as any[]) ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    initials: r.initials as string,
    tone: r.tone as string,
    isActive: r.is_active as boolean,
    phone: (r.phone as string | null) ?? undefined,
    email: (r.email as string | null) ?? undefined,
    photoUrl: (r.photo_url as string | null) ?? null,
    roles: (r.roles as StaffRole[] | null) ?? ['barber'],
    shift: (r.shift as CashierShift | null) ?? undefined,
    commissionBp: (r.commission_bp as number | null) ?? undefined,
    cashierUserId: (r.user_id as string | null) ?? null,
    category: (r.category as string | null) ?? undefined,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const services: Service[] = ((servicesRes.data as any[]) ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    duration: r.duration_min as number,
    priceCents: r.price_cents as number,
    icon: toServiceIcon(r.icon as string | null),
    desc: (r.description as string) ?? '',
    category: (r.category as string | null) ?? undefined,
    barberIds: ((r.service_barbers as { barber_id: string }[] | null) ?? []).map(
      (sb) => sb.barber_id,
    ),
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const products: Product[] = ((productsRes.data as any[]) ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    priceCents: r.price_cents as number,
    costCents: (r.cost_cents as number) ?? 0,
    stock: r.stock as number,
    low: r.low_threshold as number,
    sku: r.sku as string,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gallery = ((galleryRes.data as any[]) ?? []).map((r) => ({
    id: r.id as string,
    photoUrl: r.photo_url as string,
    caption: (r.caption as string | null) ?? null,
  }));

  return {
    // Pas d'utilisateur connecté — espace public.
    tenant: {
      id: (t?.id as string) ?? SALON.slug,
      slug: (t?.slug as string) ?? SALON.slug,
      name: (t?.name as string) ?? SALON.name,
      currency: ((t?.currency as Currency) ?? (SALON.currency as Currency)) as Currency,
      timezone: (t?.timezone as string) ?? SALON.timezone,
      locale: (t?.locale as string) ?? SALON.currencyLocale,
      plan: (t?.plan as string) ?? 'production',
      status: (t?.status as string) ?? 'active',
      trial_ends_at: (t?.trial_ends_at as string | null) ?? null,
    },
    branding: {
      logo_url: (b?.logo_url as string | null) ?? SALON.logoUrl,
      brand_primary: (b?.brand_primary as string) ?? SALON.brand.primary,
      brand_glow: (b?.brand_glow as string) ?? SALON.brand.glow,
      brand_deep: (b?.brand_deep as string) ?? SALON.brand.deep,
      custom_domain: (b?.custom_domain as string | null) ?? null,
    },
    settings: {
      tax_rate_bp: (s?.tax_rate_bp as number) ?? 1400, // 14% VAT Égypte
      legal_name: (s?.legal_name as string | null) ?? null,
      legal_address: (s?.legal_address as string | null) ?? null,
      tagline: (s?.tagline as string | null) ?? SALON.tagline,
      address_street: (s?.address_street as string | null) ?? null,
      address_city: (s?.address_city as string | null) ?? SALON.address.city,
      address_zip: (s?.address_zip as string | null) ?? null,
      branch: (s?.branch as string | null) ?? null,
      contact_phone: (s?.contact_phone as string | null) ?? SALON.contact.phone,
      contact_email: (s?.contact_email as string | null) ?? SALON.contact.email,
      contact_website: (s?.contact_website as string | null) ?? null,
      contact_instagram: (s?.contact_instagram as string | null) ?? SALON.contact.instagram,
      hours_text: (s?.hours_text as string | null) ?? null,
      maps_url: (s?.maps_url as string | null) ?? SALON.contact.googleMapsUrl ?? null,
      cashback_rate_bp: (s?.cashback_rate_bp as number | null) ?? 250,
      email_from_address: (s?.email_from_address as string | null) ?? null,
    },
    collections: { staff, services, products, gallery },
  };
}
