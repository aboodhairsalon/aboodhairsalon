import 'server-only';
/**
 * Chargement du contexte tenant pour l'espace client public.
 *
 * Contrairement au layout /manager (qui utilise requireTenant() + session RLS),
 * l'espace client est public : on lit tenant_id depuis le header x-tenant-id
 * posé par le middleware, puis on charge les données via le client admin
 * (bypass RLS). Aucune session Supabase Auth n'est requise.
 *
 * Retourne null si aucun tenant n'est résolu (accès direct à /client sans
 * slug dans l'URL) — le layout affiche alors un fallback.
 */
import { headers } from 'next/headers';
import { createAdminClient } from '@/db';
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
 * Charge le contexte complet du tenant (branding, settings, collections)
 * depuis les headers middleware, sans session Auth.
 *
 * Lit `x-tenant-id` et `x-tenant-slug` depuis les request headers.
 * Toutes les requêtes DB utilisent le client admin avec ``
 * pour garantir l'isolation des données malgré l'absence de RLS session.
 */
export async function getPublicTenantData(): Promise<TenantSession | null> {
  const headersList = await headers();
  const tenantId = headersList.get('x-tenant-id');
  const slug = headersList.get('x-tenant-slug');

  if (!tenantId || !slug) return null;

  const admin = createAdminClient();

  // Requêtes parallèles — aucune session, isolation via 
  const [tenantRes, brandingRes, settingsRes, staffRes, servicesRes, productsRes, galleryRes] =
    await Promise.all([
      admin.from('tenants').select('*').eq('id', tenantId).maybeSingle(),
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
        .select('*')
        
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

  if (!tenantRes.data) return null;

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
      id: t.id as string,
      slug: t.slug as string,
      name: t.name as string,
      currency: (t.currency as Currency) ?? 'EUR',
      timezone: (t.timezone as string) ?? 'Europe/Paris',
      locale: (t.locale as string) ?? 'fr-FR',
      plan: (t.plan as string) ?? 'starter',
      status: (t.status as string) ?? 'active',
      trial_ends_at: (t.trial_ends_at as string | null) ?? null,
    },
    branding: {
      logo_url: (b?.logo_url as string | null) ?? null,
      brand_primary: (b?.brand_primary as string) ?? '#D08C4F',
      brand_glow: (b?.brand_glow as string) ?? '#E8A867',
      brand_deep: (b?.brand_deep as string) ?? '#9B5F26',
      custom_domain: (b?.custom_domain as string | null) ?? null,
    },
    settings: {
      tax_rate_bp: (s?.tax_rate_bp as number) ?? 2000,
      legal_name: (s?.legal_name as string | null) ?? null,
      legal_address: (s?.legal_address as string | null) ?? null,
      tagline: (s?.tagline as string | null) ?? null,
      address_street: (s?.address_street as string | null) ?? null,
      address_city: (s?.address_city as string | null) ?? null,
      address_zip: (s?.address_zip as string | null) ?? null,
      branch: (s?.branch as string | null) ?? null,
      contact_phone: (s?.contact_phone as string | null) ?? null,
      contact_email: (s?.contact_email as string | null) ?? null,
      contact_website: (s?.contact_website as string | null) ?? null,
      contact_instagram: (s?.contact_instagram as string | null) ?? null,
      hours_text: (s?.hours_text as string | null) ?? null,
      maps_url: (s?.maps_url as string | null) ?? null,
      cashback_rate_bp: (s?.cashback_rate_bp as number | null) ?? 250,
      email_from_address: (s?.email_from_address as string | null) ?? null,
    },
    collections: { staff, services, products, gallery },
  };
}
