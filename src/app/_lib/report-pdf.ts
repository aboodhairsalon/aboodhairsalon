/**
 * Générateur PDF du rapport comptable — client-side avec jsPDF.
 *
 * Document A4 portrait : entête salon, synthèse (KPI), détail comptable
 * (brut → net), moyens de paiement, ventes par prestation / produit, et
 * compteur de rendez-vous. Pagination automatique si le contenu déborde.
 *
 * Police Helvetica (Latin-1). L'arabe n'est pas rendu par jsPDF sans font TTF
 * custom + reshaping/bidi → comme pour le reçu (receipt-pdf.ts), l'appelant
 * passe des libellés latins (EN) quand la locale est AR. Les montants sont
 * formatés avec une locale latine (digits occidentaux) pour rester lisibles.
 * Pour un export 100 % arabe, utiliser le CSV (UTF-8, sans contrainte de font).
 */
import jsPDF from 'jspdf';
import type { AccountingReport } from '../manager/report-actions';

export interface ReportPdfSalon {
  name: string;
  logoDataUrl?: string | null;
  branch?: string | null;
  addressCity?: string | null;
}

/** Tous les libellés du document (déjà résolus + latins). */
export interface ReportPdfLabels {
  documentTitle: string; // « Rapport comptable »
  periodLabel: string; // « Période »
  periodName: string; // « Jour » / « Semaine » / « Mois »
  range: string; // « 13/06/2026 → 13/06/2026 »
  generatedOn: string; // « Généré le »
  generatedDate: string; // date formatée
  // Synthèse / KPI
  revenueNet: string;
  sales: string;
  avgTicket: string;
  bookingsDone: string;
  // Détail comptable
  accountingTitle: string;
  gross: string;
  discount: string;
  surplus: string;
  cashback: string;
  refunded: string;
  net: string;
  tips: string;
  tax: string;
  // Moyens de paiement
  paymentsTitle: string;
  visa: string;
  cash: string;
  instapay: string;
  other: string;
  share: string;
  // Tables ventes
  byServiceTitle: string;
  byProductTitle: string;
  colName: string;
  colQty: string;
  colRevenue: string;
  colCost: string;
  colMargin: string;
  marginTotal: string;
  // Rendez-vous
  bookingsTitle: string;
  done: string;
  noShow: string;
  cancelled: string;
  upcoming: string;
  total: string;
  // Format monétaire
  currency: string; // 'EGP'
  bcp47: string; // locale latine pour Intl ('fr-FR' / 'en-US')
}

function fmtMoney(cents: number, currency: string, bcp47: string): string {
  return new Intl.NumberFormat(bcp47, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function truncate(doc: jsPDF, text: string, maxWidth: number): string {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (doc.getTextWidth(text.slice(0, mid) + '…') <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

/** Construit le PDF du rapport — A4 portrait, pagination auto. */
export function buildReportPdf(
  r: AccountingReport,
  salon: ReportPdfSalon,
  L: ReportPdfLabels,
): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' }); // 595 × 842 pt
  const W = 595;
  const M = 40; // marge
  const RIGHT = W - M;
  let y = M;

  const money = (c: number) => fmtMoney(c, L.currency, L.bcp47);

  /** Saut de page si on dépasse la zone utile, en réservant `need` pt. */
  function ensure(need: number) {
    if (y + need > 800) {
      doc.addPage();
      y = M;
    }
  }

  // ── Entête : logo + nom + sous-titre ──────────────────────────────────────
  if (salon.logoDataUrl && salon.logoDataUrl.startsWith('data:image/')) {
    try {
      const imgType = salon.logoDataUrl.includes('image/jpeg') ? 'JPEG' : 'PNG';
      doc.addImage(salon.logoDataUrl, imgType, M, y, 40, 40);
    } catch {
      /* logo invalide → on continue */
    }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(salon.name, M + 50, y + 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(90);
  doc.text(L.documentTitle, M + 50, y + 32);
  doc.setTextColor(0);

  // Bloc période (aligné à droite)
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(`${L.periodLabel} : ${L.periodName}`, RIGHT, y + 12, { align: 'right' });
  doc.text(L.range, RIGHT, y + 24, { align: 'right' });
  doc.text(`${L.generatedOn} ${L.generatedDate}`, RIGHT, y + 36, { align: 'right' });
  doc.setTextColor(0);
  y += 56;

  doc.setDrawColor(210);
  doc.line(M, y, RIGHT, y);
  y += 20;

  // ── Synthèse : 4 KPI en boîtes ────────────────────────────────────────────
  const kpis: Array<[string, string]> = [
    [L.revenueNet, money(r.revenueNetCents)],
    [L.sales, String(r.salesCount)],
    [L.avgTicket, money(r.avgTicketCents)],
    [L.bookingsDone, String(r.bookings.done)],
  ];
  const gap = 12;
  const boxW = (RIGHT - M - gap * 3) / 4;
  const boxH = 54;
  kpis.forEach(([label, value], i) => {
    const x = M + i * (boxW + gap);
    doc.setFillColor(245, 245, 247);
    doc.setDrawColor(225);
    doc.roundedRect(x, y, boxW, boxH, 6, 6, 'FD');
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(truncate(doc, label.toUpperCase(), boxW - 16), x + 10, y + 18);
    doc.setTextColor(20);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(truncate(doc, value, boxW - 16), x + 10, y + 40);
    doc.setFont('helvetica', 'normal');
  });
  doc.setTextColor(0);
  y += boxH + 24;

  /** Dessine un titre de section. */
  function sectionTitle(title: string) {
    ensure(40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(20);
    doc.text(title, M, y);
    doc.setTextColor(0);
    doc.setFont('helvetica', 'normal');
    y += 8;
    doc.setDrawColor(225);
    doc.line(M, y, RIGHT, y);
    y += 16;
  }

  /** Ligne « label … montant » (2 colonnes). `strong` = gras + filet au-dessus. */
  function kvRow(label: string, value: string, opts?: { strong?: boolean; muted?: boolean }) {
    ensure(20);
    if (opts?.strong) {
      doc.setDrawColor(180);
      doc.line(M, y - 8, RIGHT, y - 8);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
    }
    doc.setTextColor(opts?.muted ? 120 : 30);
    doc.text(label, M, y);
    doc.text(value, RIGHT, y, { align: 'right' });
    doc.setTextColor(0);
    y += opts?.strong ? 20 : 16;
  }

  // ── Détail comptable (brut → net) ─────────────────────────────────────────
  sectionTitle(L.accountingTitle);
  kvRow(L.gross, money(r.grossCents));
  if (r.surplusCents > 0) kvRow(L.surplus, `+ ${money(r.surplusCents)}`);
  if (r.discountCents > 0) kvRow(L.discount, `− ${money(r.discountCents)}`, { muted: true });
  if (r.cashbackCents > 0) kvRow(L.cashback, `− ${money(r.cashbackCents)}`, { muted: true });
  if (r.refundedCents > 0) kvRow(L.refunded, `− ${money(r.refundedCents)}`, { muted: true });
  kvRow(L.net, money(r.revenueNetCents), { strong: true });
  kvRow(L.tips, money(r.tipsCents), { muted: true });
  if (r.taxCents > 0) kvRow(L.tax, money(r.taxCents), { muted: true });
  y += 12;

  // ── Moyens de paiement ────────────────────────────────────────────────────
  sectionTitle(L.paymentsTitle);
  const methodTotal = r.byMethod.visa + r.byMethod.cash + r.byMethod.instapay + r.byMethod.other;
  const pct = (v: number) => (methodTotal > 0 ? `${Math.round((v / methodTotal) * 100)} %` : '0 %');
  const methods: Array<[string, number]> = [
    [L.visa, r.byMethod.visa],
    [L.cash, r.byMethod.cash],
    [L.instapay, r.byMethod.instapay],
  ];
  if (r.byMethod.other > 0) methods.push([L.other, r.byMethod.other]);
  for (const [label, val] of methods) {
    ensure(18);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(30);
    doc.text(label, M, y);
    doc.setTextColor(120);
    doc.text(pct(val), M + 180, y, { align: 'right' });
    doc.setTextColor(30);
    doc.text(money(val), RIGHT, y, { align: 'right' });
    doc.setTextColor(0);
    y += 16;
  }
  y += 12;

  /**
   * Table des ventes. Services = 3 colonnes (Désignation | Qté | CA).
   * Produits (`withMargin`) = 5 colonnes + total marge (Désignation | Qté | CA
   * | Coût | Marge). Surligne la 1ʳᵉ ligne (top vente).
   */
  function salesTable(title: string, lines: AccountingReport['byService'], withMargin = false) {
    if (lines.length === 0) return;
    sectionTitle(title);
    const xQty = withMargin ? M + 250 : M + 360;
    const xRev = withMargin ? M + 355 : RIGHT;
    const xCost = M + 455;
    const xMargin = RIGHT;
    const nameW = withMargin ? 195 : 320;
    // En-têtes de colonnes
    ensure(18);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(L.colName, M, y);
    doc.text(L.colQty, xQty, y, { align: 'right' });
    doc.text(L.colRevenue, xRev, y, { align: 'right' });
    if (withMargin) {
      doc.text(L.colCost, xCost, y, { align: 'right' });
      doc.text(L.colMargin, xMargin, y, { align: 'right' });
    }
    doc.setTextColor(0);
    doc.setFont('helvetica', 'normal');
    y += 14;
    lines.forEach((line, i) => {
      ensure(18);
      if (i === 0) {
        // Top vente : fond léger
        doc.setFillColor(250, 247, 235);
        doc.rect(M - 4, y - 11, RIGHT - M + 8, 16, 'F');
      }
      doc.setFontSize(10);
      doc.setTextColor(30);
      doc.text(truncate(doc, line.name, nameW), M, y);
      doc.setTextColor(90);
      doc.text(String(line.count), xQty, y, { align: 'right' });
      doc.setTextColor(30);
      doc.text(money(line.revenueCents), xRev, y, { align: 'right' });
      if (withMargin) {
        doc.setTextColor(120);
        doc.text(money(line.costCents ?? 0), xCost, y, { align: 'right' });
        doc.setTextColor(30);
        doc.text(money(line.marginCents ?? 0), xMargin, y, { align: 'right' });
      }
      doc.setTextColor(0);
      y += 16;
    });
    if (withMargin) {
      ensure(20);
      doc.setDrawColor(200);
      doc.line(M, y - 8, RIGHT, y - 8);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(30);
      doc.text(L.marginTotal, M, y);
      doc.text(money(r.productCostCents), xCost, y, { align: 'right' });
      doc.text(money(r.productMarginCents), xMargin, y, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(0);
      y += 18;
    }
    y += 12;
  }

  salesTable(L.byServiceTitle, r.byService);
  salesTable(L.byProductTitle, r.byProduct, true);

  // ── Rendez-vous ───────────────────────────────────────────────────────────
  sectionTitle(L.bookingsTitle);
  kvRow(L.done, String(r.bookings.done));
  kvRow(L.noShow, String(r.bookings.noShow), { muted: true });
  kvRow(L.cancelled, String(r.bookings.cancelled), { muted: true });
  kvRow(L.upcoming, String(r.bookings.upcoming), { muted: true });
  kvRow(L.total, String(r.bookings.total), { strong: true });

  // ── Pied de page sur chaque page : nom salon + n° page ────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.setTextColor(160);
    const footParts = [salon.name, salon.branch, salon.addressCity].filter(Boolean).join(' · ');
    doc.text(footParts, M, 820);
    doc.text(`${p} / ${pageCount}`, RIGHT, 820, { align: 'right' });
    doc.setTextColor(0);
  }

  return doc;
}

/** Déclenche le téléchargement du PDF du rapport. */
export function downloadReportPdf(
  r: AccountingReport,
  salon: ReportPdfSalon,
  labels: ReportPdfLabels,
  filename: string,
): void {
  const doc = buildReportPdf(r, salon, labels);
  doc.save(filename);
}
