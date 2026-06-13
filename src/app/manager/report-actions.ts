'use server';
/**
 * Server Action — Rapport comptable du Manager (« travail d'expert comptable »).
 *
 * Fournit, pour une période (jour / semaine / mois courant, bornée à l'heure du
 * salon — Le Caire), une vue comptable complète :
 *   • encaissements nets, brut, remises, suppléments, cashback, pourboires, taxes ;
 *   • ventilation par moyen de paiement (Visa / Cash / InstaPay) ;
 *   • ventes par prestation et par produit (quel service vend le plus) ;
 *   • compteur de rendez-vous (réalisés / absents / annulés / à venir).
 *
 * Conventions de données (cf. booking-actions.ts) :
 *   • Une vente encaissée a `status='completed'`. Un remboursement TOTAL passe en
 *     `status='refunded'` (exclu) ; un remboursement PARTIEL garde `completed`
 *     mais incrémente `refunded_cents` → le net d'une vente = max(0, total − refunded).
 *     On reproduit ici la formule exacte du tableau de bord (page.tsx · computeStats)
 *     pour que les chiffres du rapport coïncident avec ceux du dashboard.
 *   • `sale_items.total_cents` est SIGNÉ : une remise est une ligne négative.
 *     Une prestation réelle a `service_id` ; un produit a `product_id` ;
 *     un supplément / une remise « libre » de la caisse a les deux à null
 *     (refId local `surplus-…` / `discount-…` filtré côté insert). On discrimine
 *     supplément (+) vs remise (−) par le SIGNE de la ligne.
 *
 * Garde : `requireTenant()` (auth manager) + rate-limit lecture (rlManagerRead).
 * Client admin (bypass RLS) comme le dashboard — single-tenant, scope tenant_id
 * conservé par prudence.
 */
import { createAdminClient } from '@/db';
import { SALON } from '@/config/salon';
import { requireTenant } from '../_data/auth-server';
import { utcIsoToZonedParts, zonedToUtcIso } from '../_lib/timezone';
import { rlManagerRead } from '../_lib/rate-limit';

export type ReportPeriod = 'day' | 'week' | 'month';

/** Une ligne de ventilation (prestation ou produit). */
export interface ReportLine {
  /** Libellé snapshot au moment de la vente (déjà dans la langue d'encaissement). */
  name: string;
  /** Quantité cumulée vendue. */
  count: number;
  /** Chiffre d'affaires cumulé de cette ligne (cents). */
  revenueCents: number;
  /** Coût d'achat cumulé (cents) — produits uniquement (prestations = undefined). */
  costCents?: number;
  /** Marge = CA − coût (cents) — produits uniquement (prestations = undefined). */
  marginCents?: number;
}

export interface AccountingReport {
  period: ReportPeriod;
  /** Borne UTC incluse (début de période, minuit Le Caire). */
  rangeStartIso: string;
  /** Borne UTC exclue (minuit du lendemain, Le Caire). */
  rangeEndIso: string;
  /** Jour de référence 'YYYY-MM-DD' à l'heure du salon (= aujourd'hui). */
  refDate: string;

  // — Encaissements —
  /** CA NET réellement encaissé = Σ max(0, total − refunded). Coïncide avec le dashboard. */
  revenueNetCents: number;
  /** CA BRUT = Σ des lignes positives (prestations + produits + suppléments). */
  grossCents: number;
  /** Remises accordées = Σ |lignes négatives|. */
  discountCents: number;
  /** Suppléments libres saisis en caisse (lignes positives sans service/produit). */
  surplusCents: number;
  /** Cashback fidélité utilisé par les clients (déduit du net). */
  cashbackCents: number;
  /** Remboursements partiels sur ventes restées actives (déduits du net). */
  refundedCents: number;
  /** Pourboires (à part du CA — reviennent aux coiffeurs). */
  tipsCents: number;
  /** Taxes collectées (0 si non configuré). */
  taxCents: number;
  /** Nombre de ventes encaissées (hors remboursement total). */
  salesCount: number;
  /** Ticket moyen net (cents). */
  avgTicketCents: number;

  /** Ventilation par moyen de paiement (net encaissé). */
  byMethod: { visa: number; cash: number; instapay: number; other: number };
  /** Ventes par prestation, triées par CA décroissant. */
  byService: ReportLine[];
  /** Ventes par produit, triées par CA décroissant (avec coût + marge). */
  byProduct: ReportLine[];
  /** Coût d'achat total des produits vendus (cents). */
  productCostCents: number;
  /** Marge totale produits = CA produits − coût produits (cents). */
  productMarginCents: number;

  /** Compteur de rendez-vous sur la période (par date du RDV, pas de la vente). */
  bookings: {
    done: number;
    noShow: number;
    cancelled: number;
    /** À venir + en cours (upcoming + in_chair). */
    upcoming: number;
    total: number;
  };

  /** Performance par coiffeur (CA encaissé, nb de prestations, pourboires). */
  byBarber: Array<{
    barberId: string;
    name: string;
    revenueCents: number;
    serviceCount: number;
    tipsCents: number;
  }>;

  /** Mêmes indicateurs sur la période précédente (pour les deltas %). */
  previous: {
    revenueNetCents: number;
    salesCount: number;
    bookingsDone: number;
  };

  /** Affluence par heure du jour (index 0–23, heure du Caire) — nb d'encaissements. */
  peakHours: number[];
  /** Affluence par jour de semaine (index 0=dimanche … 6=samedi) — nb d'encaissements. */
  peakWeekdays: number[];

  /** Mix clients sur la période (sur les ventes identifiées). */
  clients: {
    /** Clients dont le compte a été créé pendant la période. */
    newCount: number;
    /** Clients identifiés ayant déjà un compte antérieur. */
    returningCount: number;
    /** Ventes sans client rattaché (walk-in anonyme). */
    anonymousCount: number;
    /** Total de clients identifiés distincts sur la période. */
    totalDistinct: number;
  };
}

export type GetAccountingReportResult =
  | { ok: true; report: AccountingReport }
  | { ok: false; errorKey: string };

/** Ajoute `n` jours à une date 'YYYY-MM-DD' (calendrier, via UTC pour éviter toute dérive DST). */
function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y as number, (m as number) - 1, (d as number) + n));
  return dt.toISOString().slice(0, 10);
}

export async function getAccountingReport(
  period: ReportPeriod,
): Promise<GetAccountingReportResult> {
  // Single-tenant : requireTenant() suffit pour l'auth manager.
  const ctx = await requireTenant();

  // Rate-limit lecture manager (cf. dashboard) : bloque boucles UI + scraping.
  if (!(await rlManagerRead(ctx.user.id))) {
    return { ok: false, errorKey: 'rateLimited' };
  }

  const tz = SALON.timezone;
  // « Aujourd'hui » à l'heure du salon (Le Caire) — base de toutes les bornes.
  const refDate = utcIsoToZonedParts(new Date().toISOString(), tz).date; // 'YYYY-MM-DD'

  let startYmd = refDate;
  if (period === 'week') {
    // Début de semaine = lundi. getUTCDay : 0=dim..6=sam (midi pour éviter le bord TZ).
    const dow = new Date(`${refDate}T12:00:00Z`).getUTCDay();
    const back = dow === 0 ? 6 : dow - 1;
    startYmd = addDaysYmd(refDate, -back);
  } else if (period === 'month') {
    startYmd = `${refDate.slice(0, 8)}01`;
  }
  // Borne haute exclue = minuit du lendemain (couvre toute la journée d'aujourd'hui).
  const endYmd = addDaysYmd(refDate, 1);

  const startIso = zonedToUtcIso(startYmd, '00:00', tz);
  const endIso = zonedToUtcIso(endYmd, '00:00', tz);

  // Période PRÉCÉDENTE (comparaison « vs hier / semaine dernière / mois dernier »).
  // On décale les deux bornes d'une unité → comparaison « à date » (ex. 1–13 ce
  // mois-ci vs 1–13 le mois dernier).
  const shift = (ymd: string): string => {
    if (period === 'day') return addDaysYmd(ymd, -1);
    if (period === 'week') return addDaysYmd(ymd, -7);
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y as number, (m as number) - 2, d as number))
      .toISOString()
      .slice(0, 10);
  };
  const prevStartIso = zonedToUtcIso(shift(startYmd), '00:00', tz);
  const prevEndIso = zonedToUtcIso(shift(endYmd), '00:00', tz);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Pagination .range() en boucle (cf. dashboard — sans ça PostgREST tronque à 1000).
  const PAGE_SIZE = 1000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function fetchAllPages(buildQuery: () => any): Promise<{ rows: any[]; error: unknown }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allRows: any[] = [];
    let from = 0;
    const MAX_PAGES = 50; // garde-fou : 50 000 rows max
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
      if (error) return { rows: [], error };
      const chunk = (data ?? []) as unknown[];
      allRows.push(...chunk);
      if (chunk.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return { rows: allRows, error: null };
  }

  const [salesRes, bookingsRes, prevSalesRes, prevBookingsRes] = await Promise.all([
    fetchAllPages(() =>
      admin
        .from('sales')
        .select(
          'method, total_cents, tip_cents, tax_cents, refunded_cents, cashback_redeemed_cents, barber_id, client_id, created_at, sale_items(kind, service_id, product_id, name, qty, total_cents, barber_id)',
        )
        .eq('tenant_id', ctx.tenant.id)
        .eq('status', 'completed') // exclut refunded (total) / voided / pending
        .gte('created_at', startIso)
        .lt('created_at', endIso),
    ),
    fetchAllPages(() =>
      admin
        .from('bookings')
        .select('status')
        .eq('tenant_id', ctx.tenant.id)
        .gte('starts_at', startIso)
        .lt('starts_at', endIso),
    ),
    // Période précédente — colonnes minimales (juste de quoi calculer les deltas).
    fetchAllPages(() =>
      admin
        .from('sales')
        .select('total_cents, refunded_cents')
        .eq('tenant_id', ctx.tenant.id)
        .eq('status', 'completed')
        .gte('created_at', prevStartIso)
        .lt('created_at', prevEndIso),
    ),
    fetchAllPages(() =>
      admin
        .from('bookings')
        .select('status')
        .eq('tenant_id', ctx.tenant.id)
        .gte('starts_at', prevStartIso)
        .lt('starts_at', prevEndIso),
    ),
  ]);

  if (salesRes.error || bookingsRes.error || prevSalesRes.error || prevBookingsRes.error) {
    return { ok: false, errorKey: 'dbError' };
  }

  // ---------------------------------------------------------------------------
  // Agrégation des ventes
  // ---------------------------------------------------------------------------
  const byMethod = { visa: 0, cash: 0, instapay: 0, other: 0 };
  const svcMap = new Map<string, ReportLine>();
  const prodMap = new Map<string, ReportLine>();
  let revenueNetCents = 0;
  let grossCents = 0;
  let discountCents = 0;
  let surplusCents = 0;
  let cashbackCents = 0;
  let refundedCents = 0;
  let tipsCents = 0;
  let taxCents = 0;
  let salesCount = 0;

  for (const s of salesRes.rows) {
    const total = (s.total_cents as number) ?? 0;
    const refunded = (s.refunded_cents as number) ?? 0;
    const net = Math.max(0, total - refunded); // formule dashboard (refunds partiels)
    revenueNetCents += net;
    refundedCents += refunded;
    tipsCents += (s.tip_cents as number) ?? 0;
    taxCents += (s.tax_cents as number) ?? 0;
    cashbackCents += (s.cashback_redeemed_cents as number) ?? 0;
    salesCount += 1;

    const method = s.method as string;
    if (method === 'card') byMethod.visa += net;
    else if (method === 'cash') byMethod.cash += net;
    else if (method === 'mobile') byMethod.instapay += net;
    else byMethod.other += net;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const it of ((s.sale_items as any[]) ?? [])) {
      const line = (it.total_cents as number) ?? 0;
      const qty = (it.qty as number) ?? 1;

      // Brut / remises par le SIGNE (uniforme, indépendant du bucket).
      if (line >= 0) grossCents += line;
      else discountCents += -line;

      // Ventilation par catégorie.
      if (it.kind === 'product' || it.product_id) {
        const key = (it.product_id as string) ?? `name:${it.name}`;
        const e = prodMap.get(key) ?? { name: it.name as string, count: 0, revenueCents: 0 };
        e.count += qty;
        e.revenueCents += line;
        prodMap.set(key, e);
      } else if (it.service_id) {
        const key = it.service_id as string;
        const e = svcMap.get(key) ?? { name: it.name as string, count: 0, revenueCents: 0 };
        e.count += qty;
        e.revenueCents += line;
        svcMap.set(key, e);
      } else if (line >= 0) {
        // Ligne libre positive = supplément (la remise négative est déjà dans discountCents).
        surplusCents += line;
      }
    }
  }

  const byService = [...svcMap.values()].sort((a, b) => b.revenueCents - a.revenueCents);
  const byProduct = [...prodMap.values()].sort((a, b) => b.revenueCents - a.revenueCents);
  const avgTicketCents = salesCount > 0 ? Math.round(revenueNetCents / salesCount) : 0;

  // Coût d'achat → marge produits. On lit products.cost_cents pour les product_id
  // vus (mêmes conventions que getProductStats : coût ligne = cost_cents × qté,
  // marge = CA − coût ; produit orphelin/coût non saisi → coût 0). Les prestations
  // n'ont pas de coût d'achat (main-d'œuvre) → costCents/marginCents restent undefined.
  const productIds = [...prodMap.keys()].filter((k) => !k.startsWith('name:'));
  const costById = new Map<string, number>();
  if (productIds.length > 0) {
    const { data: costRows } = await admin
      .from('products')
      .select('id, cost_cents')
      .in('id', productIds);
    for (const p of ((costRows ?? []) as { id: string; cost_cents: number | null }[])) {
      costById.set(p.id, p.cost_cents ?? 0);
    }
  }
  let productCostCents = 0;
  for (const [key, line] of prodMap) {
    const unitCost = costById.get(key) ?? 0; // clé `name:…` (orphelin) → 0
    line.costCents = unitCost * line.count;
    line.marginCents = line.revenueCents - line.costCents;
    productCostCents += line.costCents;
  }
  const productMarginCents = byProduct.reduce((s, l) => s + (l.marginCents ?? 0), 0);

  // ---------------------------------------------------------------------------
  // Agrégation des rendez-vous (par date du RDV)
  // ---------------------------------------------------------------------------
  const bookings = { done: 0, noShow: 0, cancelled: 0, upcoming: 0, total: 0 };
  for (const b of bookingsRes.rows) {
    bookings.total += 1;
    const st = b.status as string;
    if (st === 'done') bookings.done += 1;
    else if (st === 'no_show') bookings.noShow += 1;
    else if (st === 'cancelled') bookings.cancelled += 1;
    else bookings.upcoming += 1; // upcoming + in_chair
  }

  // ---------------------------------------------------------------------------
  // Performance par coiffeur — CA par barber_id de ligne (fallback : barber de la
  // vente), nb de prestations (lignes service), pourboires par barber de la vente.
  // ---------------------------------------------------------------------------
  const barberAgg = new Map<string, { revenueCents: number; serviceCount: number; tipsCents: number }>();
  const barberBucket = (id: string) => {
    let b = barberAgg.get(id);
    if (!b) {
      b = { revenueCents: 0, serviceCount: 0, tipsCents: 0 };
      barberAgg.set(id, b);
    }
    return b;
  };
  for (const s of salesRes.rows) {
    const saleBarber = (s.barber_id as string | null) ?? null;
    const tip = (s.tip_cents as number) ?? 0;
    if (saleBarber && tip > 0) barberBucket(saleBarber).tipsCents += tip;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const it of ((s.sale_items as any[]) ?? [])) {
      const line = (it.total_cents as number) ?? 0;
      if (line <= 0) continue; // on ignore remises/lignes nulles pour la perf coiffeur
      const bid = (it.barber_id as string | null) ?? saleBarber;
      if (!bid) continue;
      const bucket = barberBucket(bid);
      bucket.revenueCents += line;
      if (it.service_id) bucket.serviceCount += (it.qty as number) ?? 1;
    }
  }
  const barberIds = [...barberAgg.keys()];
  const staffById = new Map<string, string>();
  if (barberIds.length > 0) {
    const { data: staffRows } = await admin.from('staff').select('id, name').in('id', barberIds);
    for (const st of ((staffRows ?? []) as { id: string; name: string }[])) {
      staffById.set(st.id, st.name);
    }
  }
  const byBarber = barberIds
    .map((id) => ({
      barberId: id,
      name: staffById.get(id) ?? '—',
      revenueCents: barberAgg.get(id)!.revenueCents,
      serviceCount: barberAgg.get(id)!.serviceCount,
      tipsCents: barberAgg.get(id)!.tipsCents,
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents);

  // ---------------------------------------------------------------------------
  // Affluence — encaissements groupés par heure + jour de semaine (Le Caire).
  // ---------------------------------------------------------------------------
  const peakHours = new Array(24).fill(0) as number[];
  const peakWeekdays = new Array(7).fill(0) as number[];
  for (const s of salesRes.rows) {
    const parts = utcIsoToZonedParts(s.created_at as string, tz); // { date, time }
    const hour = Number.parseInt(parts.time.slice(0, 2), 10);
    if (hour >= 0 && hour < 24) peakHours[hour] = (peakHours[hour] ?? 0) + 1;
    const wd = new Date(`${parts.date}T12:00:00Z`).getUTCDay(); // 0=dim..6=sam
    peakWeekdays[wd] = (peakWeekdays[wd] ?? 0) + 1;
  }

  // ---------------------------------------------------------------------------
  // Mix clients — nouveaux (compte créé pendant la période) vs fidèles.
  // ---------------------------------------------------------------------------
  const activeClientIds = new Set<string>();
  let anonymousCount = 0;
  for (const s of salesRes.rows) {
    const cid = s.client_id as string | null;
    if (cid) activeClientIds.add(cid);
    else anonymousCount += 1;
  }
  let newCount = 0;
  if (activeClientIds.size > 0) {
    const { data: cpRows } = await admin
      .from('client_profiles')
      .select('id, created_at')
      .in('id', [...activeClientIds]);
    const startMs = new Date(startIso).getTime();
    for (const cp of ((cpRows ?? []) as { id: string; created_at: string | null }[])) {
      if (cp.created_at && new Date(cp.created_at).getTime() >= startMs) newCount += 1;
    }
  }
  const clients = {
    newCount,
    returningCount: Math.max(0, activeClientIds.size - newCount),
    anonymousCount,
    totalDistinct: activeClientIds.size,
  };

  // ---------------------------------------------------------------------------
  // Période précédente — CA net, nb ventes, RDV réalisés (pour les deltas).
  // ---------------------------------------------------------------------------
  let prevRevenueNetCents = 0;
  for (const s of prevSalesRes.rows) {
    prevRevenueNetCents += Math.max(0, ((s.total_cents as number) ?? 0) - ((s.refunded_cents as number) ?? 0));
  }
  let prevBookingsDone = 0;
  for (const b of prevBookingsRes.rows) if (b.status === 'done') prevBookingsDone += 1;
  const previous = {
    revenueNetCents: prevRevenueNetCents,
    salesCount: prevSalesRes.rows.length,
    bookingsDone: prevBookingsDone,
  };

  return {
    ok: true,
    report: {
      period,
      rangeStartIso: startIso,
      rangeEndIso: endIso,
      refDate,
      revenueNetCents,
      grossCents,
      discountCents,
      surplusCents,
      cashbackCents,
      refundedCents,
      tipsCents,
      taxCents,
      salesCount,
      avgTicketCents,
      byMethod,
      byService,
      byProduct,
      productCostCents,
      productMarginCents,
      bookings,
      byBarber,
      previous,
      peakHours,
      peakWeekdays,
      clients,
    },
  };
}
