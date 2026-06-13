/**
 * /cashier — espace Caisse (Server Component).
 *
 * Charge les données réelles du jour depuis Supabase et passe les
 * collections initiales à CashierApp (Client Component).
 *
 * Auth : requireCashier() — redirection automatique si pas de session caissier.
 */
import { getLocale } from 'next-intl/server';
import { createAdminClient } from '@/db';
import { SALON } from '@/config/salon';
import { requireCashier } from '../_data/auth-server';
import { utcIsoToZonedParts } from '../_lib/timezone';
import { pickLocale, shortLocale, type I18nText } from '@/lib/pick-locale';
import type {
  Booking,
  BookingSource,
  Sale,
  Service,
  Product,
  Staff,
  StaffRole,
  CashierShift,
} from '../_data/mock';
import { CashierApp } from './CashierApp';

export const dynamic = 'force-dynamic';

// =============================================================================
// Helpers de mapping DB → types front
// =============================================================================

const SERVICE_ICONS = ['scissors', 'razor', 'crown', 'shield', 'star', 'sparkle'] as const;
type ServiceIcon = (typeof SERVICE_ICONS)[number];

function toServiceIcon(raw: string | null): ServiceIcon {
  return (SERVICE_ICONS as readonly string[]).includes(raw ?? '')
    ? (raw as ServiceIcon)
    : 'scissors';
}

const BOOKING_SOURCES: readonly BookingSource[] = [
  'client_app',
  'cashier',
  'walk_in',
  'manager',
  'waitlist',
  'widget',
] as const;

function toBookingSource(raw: unknown): BookingSource | undefined {
  return typeof raw === 'string' && (BOOKING_SOURCES as readonly string[]).includes(raw)
    ? (raw as BookingSource)
    : undefined;
}

// DB booking row (étendu pour le champ `service_id` qui peut remonter null avant 0012)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapBooking(row: any): Booking {
  // Heure AFFICHÉE = heure locale du salon (Le Caire), pas UTC. Les rows sont
  // stockés en UTC vrai (zonedToUtcIso à la création) ; les afficher en
  // getUTCHours décalait de −2/−3h. Audit timezone.
  const zoned = utcIsoToZonedParts(row.starts_at as string, SALON.timezone);
  // Extras persistés en DB (JSONB) — survivent au refresh + cross-device
  // (audit T2.9). Format strict côté front : { key, kind, refId, name,
  // priceCents, qty }. On filtre les entrées malformées (defense-in-depth
  // contre des données legacy avant migration 0035).
  const rawExtras = Array.isArray(row.extras) ? (row.extras as unknown[]) : [];
  const extras = rawExtras
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((raw: any) => {
      if (!raw || typeof raw !== 'object') return null;
      const kind = raw.kind === 'product' ? ('product' as const) : ('service' as const);
      return {
        key: String(raw.key ?? `${kind}-${raw.refId ?? 'unknown'}-${Date.now()}`),
        kind,
        refId: String(raw.refId ?? ''),
        name: String(raw.name ?? ''),
        priceCents: Number(raw.priceCents ?? 0),
        qty: Math.max(1, Number(raw.qty ?? 1)),
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null && e.name.length > 0);

  return {
    id: row.id as string,
    clientName: (row.client_display_name as string) ?? '',
    clientPhone: (row.client_phone as string | null) ?? undefined,
    serviceId: (row.service_id as string) ?? '',
    barberId: (row.barber_id as string) ?? '',
    date: zoned.date,
    time: zoned.time,
    status:
      row.status === 'in_chair' ? 'in-chair' : (row.status as 'upcoming' | 'done' | 'cancelled'),
    paid: (row.paid as boolean) ?? false,
    amountCents: (row.amount_cents as number) ?? 0,
    extras,
    source: toBookingSource(row.source),
  };
}

// DB sale row (avec sale_items eager-loaded)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSale(row: any): Sale {
  // Heure locale salon (cf. mapBooking) — pas UTC.
  const zoned = utcIsoToZonedParts(row.created_at as string, SALON.timezone);
  return {
    id: row.id as string,
    receiptNumber: (row.receipt_number as string | null) ?? null,
    date: zoned.date,
    time: zoned.time,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items: ((row.sale_items as any[]) ?? []).map((si) => ({
      type: si.kind === 'product' ? ('product' as const) : ('service' as const),
      name: si.name as string,
      priceCents: si.unit_price_cents as number,
      qty: (si.qty as number) ?? 1,
      barberId: (si.barber_id as string | null) ?? undefined,
    })),
    method: (['card', 'cash', 'mobile'] as const).includes(row.method) ? row.method : 'card',
    totalCents: (row.total_cents as number) ?? 0,
    barberId: (row.barber_id as string) ?? '',
    clientName: (row.client_name as string | null) ?? undefined,
    tipCents: (row.tip_cents as number) ?? 0,
    refunded: row.status === 'refunded',
    refundedAt: (row.refunded_at as string | null) ?? undefined,
    refundReason: (row.refund_reason as string | null) ?? undefined,
    refundedCents: (row.refunded_cents as number | null) ?? 0,
    cashbackRedeemedCents: (row.cashback_redeemed_cents as number | null) ?? 0,
  };
}

// =============================================================================
// Page Server Component
// =============================================================================

export default async function CashierPage() {
  const { tenantId, staffId, slug } = await requireCashier();

  const admin = createAdminClient();

  // Fenêtre "aujourd'hui" en UTC (le salon peut ajuster via timezone plus tard)
  const now = new Date();
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
  const todayEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  ).toISOString();

  // Fenêtre étendue pour l'onglet « Rendez-vous » avec sélecteur Jour/Semaine/Mois.
  // On charge -7j → +45j pour couvrir : semaine en cours (qui peut chevaucher
  // le mois précédent), mois en cours, début du mois suivant. Le filtre par
  // période est appliqué côté client — pas de round-trip à chaque clic.
  const bookingsRangeStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 7),
  ).toISOString();
  const bookingsRangeEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 46),
  ).toISOString();

  // Requêtes parallèles
  const [bookingsRes, salesRes, servicesRes, productsRes, staffRes, tenantRes] = await Promise.all([
    admin
      .from('bookings')
      .select('*')
      
      .gte('starts_at', bookingsRangeStart)
      .lt('starts_at', bookingsRangeEnd)
      .not('status', 'in', '("cancelled","no_show")')
      .order('starts_at', { ascending: true }),

    admin
      .from('sales')
      .select('*, sale_items(*)')
      
      .gte('created_at', todayStart)
      .lt('created_at', todayEnd)
      .order('created_at', { ascending: false }),

    admin
      .from('services')
      .select('*, service_barbers(barber_id)')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),

    admin.from('products').select('*').eq('is_active', true),

    admin
      .from('staff')
      .select('*')
      
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),

    admin.from('tenants').select('name, category_i18n').eq('id', tenantId).maybeSingle(),
  ]);

  // Langue courante + map de traduction des sections.
  const locale = shortLocale(await getLocale());
  const catMap =
    (((tenantRes.data as { category_i18n?: Record<string, I18nText> } | null)?.category_i18n ??
      {}) as Record<string, I18nText>);
  const localizedCategory = (cat: string | null): string | undefined =>
    cat ? pickLocale(catMap[cat], locale, cat) : undefined;

  // Mapping DB → types front
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const initialBookings: Booking[] = ((bookingsRes.data as any[]) ?? []).map(mapBooking);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const initialSales: Sale[] = ((salesRes.data as any[]) ?? []).map(mapSale);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const services: Service[] = ((servicesRes.data as any[]) ?? []).map((r) => ({
    id: r.id as string,
    name: pickLocale(r.name_i18n as I18nText, locale, r.name as string),
    duration: r.duration_min as number,
    priceCents: r.price_cents as number,
    icon: toServiceIcon(r.icon as string | null),
    desc: pickLocale(r.description_i18n as I18nText, locale, (r.description as string) ?? ''),
    category: localizedCategory(r.category as string | null),
    barberIds: ((r.service_barbers as { barber_id: string }[] | null) ?? []).map(
      (sb) => sb.barber_id,
    ),
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const initialProducts: Product[] = ((productsRes.data as any[]) ?? []).map((r) => ({
    id: r.id as string,
    name: pickLocale(r.name_i18n as I18nText, locale, r.name as string),
    priceCents: r.price_cents as number,
    costCents: (r.cost_cents as number) ?? 0,
    stock: r.stock as number,
    low: r.low_threshold as number,
    sku: r.sku as string,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const staff: Staff[] = ((staffRes.data as any[]) ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    initials: r.initials as string,
    tone: r.tone as string,
    isActive: r.is_active as boolean,
    isAbsent: (r.is_absent as boolean | null) ?? false,
    phone: (r.phone as string | null) ?? undefined,
    email: (r.email as string | null) ?? undefined,
    photoUrl: (r.photo_url as string | null) ?? null,
    roles: (r.roles as StaffRole[] | null) ?? ['barber'],
    shift: (r.shift as CashierShift | null) ?? undefined,
    commissionBp: (r.commission_bp as number | null) ?? undefined,
    cashierUserId: (r.user_id as string | null) ?? null,
    category: (r.category as string | null) ?? undefined,
  }));

  const tenantName = (tenantRes.data as { name?: string } | null)?.name ?? '';

  return (
    <CashierApp
      initialBookings={initialBookings}
      initialSales={initialSales}
      services={services}
      initialProducts={initialProducts}
      staff={staff}
      cashierStaffId={staffId}
      tenantName={tenantName}
      slug={slug}
      tenantId={tenantId}
    />
  );
}
