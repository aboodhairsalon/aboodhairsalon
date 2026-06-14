/**
 * Utilitaires d'export CSV — génération de fichiers + téléchargement client.
 *
 * Le CSV est encodé en UTF-8 avec un BOM pour qu'Excel ouvre correctement les
 * accents. Échappement RFC 4180 (guillemets, virgules, sauts de ligne). Module
 * pur — appelé uniquement depuis des gestionnaires d'événements côté client.
 */
import type { Sale } from '../_data/mock';

/** Marqueur d'ordre des octets UTF-8 (U+FEFF) — fait ouvrir le CSV proprement à Excel. */
const UTF8_BOM = String.fromCharCode(0xfeff);

/** Échappe une valeur pour une cellule CSV (RFC 4180). */
function csvCell(value: string | number): string {
  const s = String(value);
  return /["\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Assemble une grille de cellules en texte CSV (séparateur virgule, CRLF). */
function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/**
 * Construit le CSV des ventes — une ligne par vente.
 *
 * `barberName` résout l'id du barbier en nom lisible. `labels` contient les
 * traductions (headers + libellés méthode de paiement), résolues par
 * l'appelant via next-intl pour ne pas dépendre d'une locale figée côté
 * utilitaire pur. Avant l'audit T5.7, les headers étaient hardcodés en
 * français → CSV illisible pour un manager EN/AR.
 */
export interface SalesCsvLabels {
  date: string;
  time: string;
  barber: string;
  method: string;
  items: string;
  total: string;
  refunded: string;
  net: string;
  methodCard: string;
  methodCash: string;
  methodMobile: string;
}

export function buildSalesCsv(
  sales: Sale[],
  barberName: (id: string) => string,
  labels: SalesCsvLabels,
): string {
  // Le CSV trace 3 colonnes monétaires pour piste comptable :
  //  - Total facturé (gross)
  //  - Remboursé (cumulé sur la vente : 0, partiel, ou total)
  //  - Net = Total − Remboursé (ce qui est resté en caisse)
  // Libellés de marque (Visa / Cash / InstaPay) — identiques dans toutes les langues.
  const methodLabel = (m: Sale['method']): string => {
    switch (m) {
      case 'card':
        return 'Visa';
      case 'cash':
        return 'Cash';
      case 'mobile':
        return 'InstaPay';
    }
  };
  const header = [
    labels.date,
    labels.time,
    labels.barber,
    labels.method,
    labels.items,
    labels.total,
    labels.refunded,
    labels.net,
  ];
  const rows: (string | number)[][] = sales.map((s) => {
    const refunded = s.refundedCents ?? 0;
    return [
      s.date,
      s.time,
      barberName(s.barberId),
      methodLabel(s.method),
      s.items.map((i) => `${i.name} ×${i.qty}`).join(' ; '),
      (s.totalCents / 100).toString(),
      (refunded / 100).toString(),
      (Math.max(0, s.totalCents - refunded) / 100).toString(),
    ];
  });
  return toCsv([header, ...rows]);
}

/**
 * Libellés (déjà localisés) pour le CSV du rapport comptable.
 * Les en-têtes/sections sont passés par l'appelant via next-intl pour rester
 * indépendants de la locale figée côté utilitaire pur (cf. SalesCsvLabels).
 */
export interface ReportCsvLabels {
  reportTitle: string;
  salon: string;
  currencyLabel: string;
  currencyCode: string;
  periodLabel: string;
  periodValue: string; // « Mois — 01/06/2026 → 13/06/2026 »
  synthesis: string;
  revenueNet: string;
  sales: string;
  avgTicket: string;
  gross: string;
  discount: string;
  surplus: string;
  cashback: string;
  refunded: string;
  tips: string;
  tax: string;
  paymentsTitle: string;
  amount: string;
  visa: string;
  cash: string;
  instapay: string;
  other: string;
  byServiceTitle: string;
  byProductTitle: string;
  colName: string;
  colQty: string;
  colRevenue: string;
  colCost: string;
  colMargin: string;
  marginTotal: string;
  bookingsTitle: string;
  done: string;
  noShow: string;
  cancelled: string;
  upcoming: string;
  total: string;
  // Performance par coiffeur
  barberTitle: string;
  barberServices: string;
  barberTips: string;
  // Comparaison période précédente
  comparisonTitle: string;
  comparisonCurrent: string;
  comparisonPrevious: string;
  comparisonChange: string;
  // Clients
  clientsTitle: string;
  clientsNew: string;
  clientsReturning: string;
  clientsAnonymous: string;
  clientsDistinct: string;
  clientsNoShowRate: string;
  // Affluence
  peakTitle: string;
  peakByHour: string;
  peakByDay: string;
  /** Noms courts des 7 jours (index 0 = dimanche), résolus via Intl par l'appelant. */
  weekdayNames: string[];
}

/**
 * Construit le CSV du rapport comptable — document multi-sections (synthèse,
 * moyens de paiement, ventes par prestation/produit, rendez-vous).
 *
 * Les montants sont en décimal brut (séparateur point, 2 décimales) pour un
 * ré-import propre dans Excel / un logiciel comptable, indépendamment de la
 * locale. Contrairement au PDF, le CSV gère l'UTF-8 → c'est l'export à
 * privilégier en arabe (noms de prestations inclus).
 */
export function buildReportCsv(
  r: import('./report-actions').AccountingReport,
  L: ReportCsvLabels,
): string {
  const money = (cents: number) => (cents / 100).toFixed(2);
  const rows: (string | number)[][] = [];
  rows.push([L.reportTitle, L.salon]);
  rows.push([L.periodLabel, L.periodValue]);
  rows.push([L.currencyLabel, L.currencyCode]);
  rows.push([]);
  rows.push([L.synthesis]);
  rows.push([L.revenueNet, money(r.revenueNetCents)]);
  rows.push([L.sales, r.salesCount]);
  rows.push([L.avgTicket, money(r.avgTicketCents)]);
  rows.push([L.gross, money(r.grossCents)]);
  rows.push([L.surplus, money(r.surplusCents)]);
  rows.push([L.discount, money(r.discountCents)]);
  rows.push([L.cashback, money(r.cashbackCents)]);
  rows.push([L.refunded, money(r.refundedCents)]);
  rows.push([L.tips, money(r.tipsCents)]);
  rows.push([L.tax, money(r.taxCents)]);
  rows.push([]);
  rows.push([L.paymentsTitle, L.amount]);
  rows.push([L.visa, money(r.byMethod.visa)]);
  rows.push([L.cash, money(r.byMethod.cash)]);
  rows.push([L.instapay, money(r.byMethod.instapay)]);
  if (r.byMethod.other > 0) rows.push([L.other, money(r.byMethod.other)]);
  rows.push([]);
  rows.push([L.byServiceTitle, L.colQty, L.colRevenue]);
  for (const s of r.byService) rows.push([s.name, s.count, money(s.revenueCents)]);
  if (r.byProduct.length > 0) {
    rows.push([]);
    rows.push([L.byProductTitle, L.colQty, L.colRevenue, L.colCost, L.colMargin]);
    for (const p of r.byProduct) {
      rows.push([
        p.name,
        p.count,
        money(p.revenueCents),
        money(p.costCents ?? 0),
        money(p.marginCents ?? 0),
      ]);
    }
    rows.push([L.marginTotal, '', '', money(r.productCostCents), money(r.productMarginCents)]);
  }
  rows.push([]);
  rows.push([L.bookingsTitle]);
  rows.push([L.done, r.bookings.done]);
  rows.push([L.noShow, r.bookings.noShow]);
  rows.push([L.cancelled, r.bookings.cancelled]);
  rows.push([L.upcoming, r.bookings.upcoming]);
  rows.push([L.total, r.bookings.total]);

  // Performance par coiffeur
  if (r.byBarber.length > 0) {
    rows.push([]);
    rows.push([L.barberTitle, L.colRevenue, L.barberServices, L.barberTips]);
    for (const b of r.byBarber) {
      rows.push([b.name, money(b.revenueCents), b.serviceCount, money(b.tipsCents)]);
    }
  }

  // Comparaison vs période précédente
  const delta = (cur: number, prev: number) =>
    prev > 0 ? `${Math.round(((cur - prev) / prev) * 100)}%` : '—';
  rows.push([]);
  rows.push([L.comparisonTitle, L.comparisonCurrent, L.comparisonPrevious, L.comparisonChange]);
  rows.push([
    L.revenueNet,
    money(r.revenueNetCents),
    money(r.previous.revenueNetCents),
    delta(r.revenueNetCents, r.previous.revenueNetCents),
  ]);
  rows.push([
    L.sales,
    r.salesCount,
    r.previous.salesCount,
    delta(r.salesCount, r.previous.salesCount),
  ]);
  rows.push([
    L.done,
    r.bookings.done,
    r.previous.bookingsDone,
    delta(r.bookings.done, r.previous.bookingsDone),
  ]);

  // Clients
  const noShowRate =
    r.bookings.done + r.bookings.noShow > 0
      ? Math.round((r.bookings.noShow / (r.bookings.done + r.bookings.noShow)) * 100)
      : 0;
  rows.push([]);
  rows.push([L.clientsTitle]);
  rows.push([L.clientsNew, r.clients.newCount]);
  rows.push([L.clientsReturning, r.clients.returningCount]);
  rows.push([L.clientsAnonymous, r.clients.anonymousCount]);
  rows.push([L.clientsDistinct, r.clients.totalDistinct]);
  rows.push([L.clientsNoShowRate, `${noShowRate}%`]);

  // Affluence
  rows.push([]);
  rows.push([L.peakTitle]);
  rows.push([L.peakByHour]);
  for (let h = 0; h < 24; h++) {
    if ((r.peakHours[h] ?? 0) > 0) rows.push([`${h}h`, r.peakHours[h] ?? 0]);
  }
  rows.push([L.peakByDay]);
  for (const i of [1, 2, 3, 4, 5, 6, 0]) {
    rows.push([L.weekdayNames[i] ?? String(i), r.peakWeekdays[i] ?? 0]);
  }

  return toCsv(rows);
}

/** Déclenche le téléchargement d'un fichier CSV dans le navigateur. */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([UTF8_BOM, content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
