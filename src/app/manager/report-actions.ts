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
  /** Ventes par produit, triées par CA décroissant. */
  byProduct: ReportLine[];

  /** Compteur de rendez-vous sur la période (par date du RDV, pas de la vente). */
  bookings: {
    done: number;
    noShow: number;
    cancelled: number;
    /** À venir + en cours (upcoming + in_chair). */
    upcoming: number;
    total: number;
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

  const [salesRes, bookingsRes] = await Promise.all([
    fetchAllPages(() =>
      admin
        .from('sales')
        .select(
          'method, total_cents, tip_cents, tax_cents, refunded_cents, cashback_redeemed_cents, sale_items(kind, service_id, product_id, name, qty, total_cents)',
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
  ]);

  if (salesRes.error || bookingsRes.error) {
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
      bookings,
    },
  };
}
