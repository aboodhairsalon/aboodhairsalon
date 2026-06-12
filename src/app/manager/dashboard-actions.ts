'use server';
/**
 * Server Action — séries de données pour le Tableau de bord du Manager.
 *
 * Le composant `ManagerDashboard` est un Client Component : il ne peut pas
 * interroger Supabase directement. Cette action lui fournit les réservations
 * et les ventes du tenant sur une fenêtre glissante (les N derniers jours),
 * de quoi calculer les KPI de la période sélectionnée ET de la période
 * précédente (tendances + sparklines).
 *
 * Fenêtre maximale utile : 60 jours (vue « Mois » = 30 jours courants +
 * 30 jours précédents). On charge toujours large pour éviter un aller-retour
 * réseau à chaque changement de période côté client.
 *
 * Utilise le client admin (bypass RLS) — la garde auth est assurée par le
 * layout /manager (requireTenant). On revérifie tout de même le tenant via
 * requireTenant() ici pour qu'un tenantId arbitraire ne fuite jamais de data.
 */
import { createAdminClient } from '@/db';
import { SALON } from '@/config/salon';
import { requireTenant } from '../_data/auth-server';
import { utcIsoToZonedParts } from '../_lib/timezone';
import { rlManagerRead } from '../_lib/rate-limit';
import type { Booking, Sale } from '../_data/mock';
import { DASHBOARD_WINDOW_DAYS, type GetDashboardSeriesResult } from './dashboard-types';

// DB row → type front. Aligné sur le mapping de /cashier (mêmes conventions :
// `date` ISO `YYYY-MM-DD`, `time` `HH:mm` en UTC, statut `in_chair`→`in-chair`).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapBooking(row: any): Booking {
  // Date + heure locale salon (Le Caire) — pas UTC. Sinon le groupement
  // par jour du dashboard décale les RDV de fin/début de journée. Audit TZ.
  const zoned = utcIsoToZonedParts(row.starts_at as string, SALON.timezone);
  return {
    id: row.id as string,
    clientName: (row.client_display_name as string) ?? '',
    serviceId: (row.service_id as string) ?? '',
    barberId: (row.barber_id as string) ?? '',
    date: zoned.date,
    time: zoned.time,
    status:
      row.status === 'in_chair' ? 'in-chair' : (row.status as 'upcoming' | 'done' | 'cancelled'),
    paid: (row.paid as boolean) ?? false,
    amountCents: (row.amount_cents as number) ?? 0,
    extras: [],
  };
}

// DB row → type front. La date d'une vente est sa `created_at` (cohérent avec
// /cashier — `completed_at` peut être null pour les ventes encore en cours).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSale(row: any): Sale {
  const zoned = utcIsoToZonedParts(row.created_at as string, SALON.timezone);
  return {
    id: row.id as string,
    date: zoned.date,
    time: zoned.time,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items: ((row.sale_items as any[]) ?? []).map((si) => ({
      type: si.kind === 'product' ? ('product' as const) : ('service' as const),
      name: si.name as string,
      priceCents: si.unit_price_cents as number,
      qty: (si.qty as number) ?? 1,
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

/**
 * Charge réservations + ventes du tenant sur les `DASHBOARD_WINDOW_DAYS`
 * derniers jours (borne incluse aujourd'hui).
 *
 * @param tenantId — UUID du tenant (résolu par requireTenant côté composant).
 */
export async function getDashboardSeries(tenantId: string): Promise<GetDashboardSeriesResult> {
  if (!tenantId) return { ok: false, errorKey: 'tenantMissing' };

  // Single-tenant : pas de guard cross-tenant (il n'y a qu'une instance).
  // `requireTenant()` suffit pour vérifier l'auth manager.
  const ctx = await requireTenant();

  // Rate-limit lecture manager : 120/min/userId. Bloque les boucles UI
  // buggées + scraping (audit T4.2).
  if (!(await rlManagerRead(ctx.user.id))) {
    return { ok: false, errorKey: 'dbError', errorValues: { message: 'rate_limited' } };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Fenêtre en UTC : début = minuit il y a (WINDOW - 1) jours, fin = minuit demain.
  const now = new Date();
  const windowStart = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - (DASHBOARD_WINDOW_DAYS - 1),
    ),
  ).toISOString();
  const windowEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  ).toISOString();

  // Pagination via .range() en boucle — sans ça, Supabase REST tronque
  // silencieusement à 1000 rows. Pour un tenant avec >30 ventes/jour sur la
  // fenêtre de 90j, ça représente 2700+ rows → 2/3 des données ignorées par
  // le dashboard (KPI faussé). Audit T4.1.
  const PAGE_SIZE = 1000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function fetchAllPages(buildQuery: () => any): Promise<{ rows: any[]; error: unknown }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allRows: any[] = [];
    let from = 0;
    // Hard cap : 50 pages = 50 000 rows. Au-delà, on suspecte un bug
    // (window mal bornée, fuite de tenant_id, etc.) et on stop.
    const MAX_PAGES = 50;
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
      if (error) return { rows: [], error };
      const chunk = (data ?? []) as unknown[];
      allRows.push(...chunk);
      if (chunk.length < PAGE_SIZE) break; // dernière page atteinte
      from += PAGE_SIZE;
    }
    return { rows: allRows, error: null };
  }

  const [bookingsRes, salesRes] = await Promise.all([
    fetchAllPages(() =>
      admin
        .from('bookings')
        .select('*')
        
        .gte('starts_at', windowStart)
        .lt('starts_at', windowEnd)
        .order('starts_at', { ascending: true }),
    ),
    fetchAllPages(() =>
      admin
        .from('sales')
        .select('*, sale_items(*)')
        
        .gte('created_at', windowStart)
        .lt('created_at', windowEnd)
        .order('created_at', { ascending: true }),
    ),
  ]);

  if (bookingsRes.error) {
    return {
      ok: false,
      errorKey: 'loadReservationsFailed',
      errorValues: { message: (bookingsRes.error as { message?: string }).message ?? '' },
    };
  }
  if (salesRes.error) {
    return {
      ok: false,
      errorKey: 'dbError',
      errorValues: { message: (salesRes.error as { message?: string }).message ?? '' },
    };
  }

  const bookings: Booking[] = bookingsRes.rows.map(mapBooking);
  const sales: Sale[] = salesRes.rows.map(mapSale);

  return { ok: true, series: { bookings, sales } };
}
