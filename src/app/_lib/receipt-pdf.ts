/**
 * Générateur de PDF de reçu — client-side avec jsPDF.
 *
 * Pas de dépendance serveur (le rendu se fait dans le navigateur), pas de
 * route API à maintenir. Le PDF a un layout simple : entête salon (logo +
 * nom + adresse + slogan), liste des items, total, mode de paiement, QR
 * fidélité si présent.
 *
 * Utilisé par :
 *   - cashier/ReceiptQRModal (bouton "Télécharger PDF")
 *   - client/page.tsx > Mes factures (bouton par ligne)
 *
 * Police par défaut Helvetica — supporte le Latin-1. Pour l'arabe, jsPDF
 * exige une font TTF custom (Amiri, Noto Sans Arabic) chargée en runtime.
 * On accepte un fallback minimal en AR pour l'instant : l'entête / total
 * passent en EN si la locale est AR, sinon le PDF aurait des carrés vides.
 */
import jsPDF from 'jspdf';

export interface ReceiptItem {
  name: string;
  qty: number;
  priceCents: number;
}

export interface SalonInfo {
  name: string;
  /** Logo en data URL (PNG/JPEG/SVG-data) — affiché en entête si présent. */
  logoDataUrl?: string | null;
  addressStreet?: string | null;
  addressCity?: string | null;
  addressZip?: string | null;
  branch?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  tagline?: string | null;
}

export interface ReceiptData {
  saleId: string;
  /** Numéro de ticket lisible « YYYY-MM-NNN ». `null` tant qu'il n'est pas
   *  attribué (vente encaissée hors-ligne, en attente de synchro) → le rendu
   *  retombe sur un identifiant technique provisoire. */
  receiptNumber?: string | null;
  /** Date + heure ISO de la vente (affichée localisée). */
  dateIso: string;
  /** Horaire affiché (déjà formaté HH:mm) — évite de re-calculer côté util. */
  time: string;
  items: ReceiptItem[];
  totalCents: number;
  tipCents?: number;
  method: 'card' | 'cash' | 'mobile';
  /** Mode de paiement déjà localisé (ex. "Carte", "Cash", "بطاقة"). */
  methodLabel: string;
  currency: string; // 'EUR' / 'EGP' / etc — passé à Intl.NumberFormat
  /** Nom du client (optionnel). */
  clientName?: string | null;
  /** QR code en data URL (générée par qrcode.toDataURL côté appelant). */
  qrDataUrl?: string | null;
  /** Texte du QR (URL vers l'espace client + phone). Affiché en petit sous le QR. */
  qrCaption?: string | null;
  /** Vente remboursée → on ajoute un cachet "REFUNDED" + on garde le PDF. */
  refunded?: boolean;
}

export interface ReceiptLabels {
  /** Titre du document (header) : « Reçu de caisse » / « Receipt » / « إيصال ». */
  documentTitle: string;
  /** Libellé "N° de vente" / "Sale #". */
  saleNumber: string;
  /** Libellé "Mode" / "Method". */
  method: string;
  /** Libellé "Client". */
  client: string;
  /** Libellé "Sous-total" — affiché si tipCents > 0 pour distinguer total/tip. */
  subtotal: string;
  /** Libellé "Pourboire". */
  tip: string;
  /** Libellé "Total". */
  total: string;
  /** Libellé "Quantité" colonne (court : "Qté", "Qty"). */
  qty: string;
  /** Libellé "Prix unitaire" — colonne tableau. */
  unitPrice: string;
  /** Libellé "Sous-total ligne". */
  lineTotal: string;
  /** Libellé "Désignation". */
  itemDesc: string;
  /** Texte affiché sous le QR : « Scannez pour retrouver votre facture ». */
  qrHint: string;
  /** Cachet "REMBOURSÉ" / "REFUNDED" si refunded=true. */
  refundedStamp: string;
  /** Footer petit texte (date impression). */
  printedOn: string;
  /** Pour formater la date longue. */
  bcp47: string;
}

/** Formatte un montant en centimes selon la devise + locale. */
function fmtMoney(cents: number, currency: string, bcp47: string): string {
  return new Intl.NumberFormat(bcp47, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Formatte une date ISO en date longue localisée. */
function fmtDateLong(iso: string, bcp47: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(bcp47, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/** Tronque un texte à une largeur — ajoute … si dépassement. */
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

/**
 * Construit le PDF du reçu — ouvre un Blob téléchargeable.
 * Format A6 paysage (~105×148 mm) : largeur ticket standard, hauteur
 * suffisante pour ~20 items + total + QR. Au-delà, le contenu déborde mais
 * jsPDF ne crée pas de page 2 automatiquement (un reçu = une page).
 */
export function buildReceiptPdf(data: ReceiptData, salon: SalonInfo, labels: ReceiptLabels): jsPDF {
  // Largeur 105 mm = ~298 pt. On utilise pt pour des chiffres entiers.
  const doc = new jsPDF({ unit: 'pt', format: [298, 600], orientation: 'portrait' });

  const W = 298;
  const MARGIN = 24;
  let y = MARGIN;

  // ── Logo (si data URL exploitable) — carré 48×48 pt centré.
  if (salon.logoDataUrl && salon.logoDataUrl.startsWith('data:image/')) {
    try {
      const imgType = salon.logoDataUrl.includes('image/png')
        ? 'PNG'
        : salon.logoDataUrl.includes('image/jpeg')
          ? 'JPEG'
          : 'PNG';
      doc.addImage(salon.logoDataUrl, imgType, (W - 48) / 2, y, 48, 48);
      y += 56;
    } catch {
      // Logo invalide / format non supporté → on continue sans
    }
  }

  // ── Nom du salon
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(salon.name, W / 2, y, { align: 'center' });
  y += 18;

  // ── Slogan (tagline)
  if (salon.tagline) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(salon.tagline, W / 2, y, { align: 'center' });
    doc.setTextColor(0);
    y += 12;
  }

  // ── Adresse / contact (3 lignes max compactes)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100);

  const addrLine = [salon.addressStreet, salon.addressZip, salon.addressCity]
    .filter(Boolean)
    .join(', ');
  if (addrLine) {
    doc.text(addrLine, W / 2, y, { align: 'center' });
    y += 10;
  }
  if (salon.branch) {
    doc.text(salon.branch, W / 2, y, { align: 'center' });
    y += 10;
  }
  const contactLine = [salon.phone, salon.email].filter(Boolean).join(' · ');
  if (contactLine) {
    doc.text(contactLine, W / 2, y, { align: 'center' });
    y += 10;
  }
  doc.setTextColor(0);
  y += 6;

  // ── Filet de séparation
  doc.setDrawColor(200);
  doc.line(MARGIN, y, W - MARGIN, y);
  y += 14;

  // ── Métadonnées : N° vente + date + client
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const dateLabel = fmtDateLong(data.dateIso, labels.bcp47);
  doc.text(
    `${labels.saleNumber} ${data.receiptNumber || data.saleId.slice(0, 8).toUpperCase()}`,
    MARGIN,
    y,
  );
  doc.text(`${dateLabel} · ${data.time}`, W - MARGIN, y, { align: 'right' });
  y += 12;

  if (data.clientName) {
    doc.text(`${labels.client} : ${truncate(doc, data.clientName, 200)}`, MARGIN, y);
    y += 12;
  }
  doc.text(`${labels.method} : ${data.methodLabel}`, MARGIN, y);
  y += 16;

  // ── Filet
  doc.line(MARGIN, y, W - MARGIN, y);
  y += 14;

  // ── Tableau items : Désignation | Qty | PU | Total
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(labels.itemDesc, MARGIN, y);
  doc.text(labels.qty, MARGIN + 140, y);
  doc.text(labels.unitPrice, MARGIN + 175, y);
  doc.text(labels.lineTotal, W - MARGIN, y, { align: 'right' });
  y += 8;
  doc.line(MARGIN, y, W - MARGIN, y);
  y += 10;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  for (const item of data.items) {
    const nameTrunc = truncate(doc, item.name, 130);
    doc.text(nameTrunc, MARGIN, y);
    doc.text(String(item.qty), MARGIN + 140, y);
    doc.text(fmtMoney(item.priceCents, data.currency, labels.bcp47), MARGIN + 175, y);
    doc.text(fmtMoney(item.priceCents * item.qty, data.currency, labels.bcp47), W - MARGIN, y, {
      align: 'right',
    });
    y += 12;
    if (y > 540) break; // pas plus d'une page
  }

  y += 4;
  doc.line(MARGIN, y, W - MARGIN, y);
  y += 14;

  // ── Sous-total (si pourboire) puis total
  const itemsSubtotal = data.items.reduce((s, i) => s + i.priceCents * i.qty, 0);
  if (data.tipCents && data.tipCents > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(labels.subtotal, MARGIN, y);
    doc.text(fmtMoney(itemsSubtotal, data.currency, labels.bcp47), W - MARGIN, y, {
      align: 'right',
    });
    y += 12;
    doc.text(labels.tip, MARGIN, y);
    doc.text(fmtMoney(data.tipCents, data.currency, labels.bcp47), W - MARGIN, y, {
      align: 'right',
    });
    y += 14;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(labels.total, MARGIN, y);
  doc.text(
    fmtMoney(data.totalCents + (data.tipCents ?? 0), data.currency, labels.bcp47),
    W - MARGIN,
    y,
    {
      align: 'right',
    },
  );
  y += 22;

  // ── QR code (centré, 80×80 pt)
  if (data.qrDataUrl) {
    try {
      doc.addImage(data.qrDataUrl, 'PNG', (W - 80) / 2, y, 80, 80);
      y += 86;
      if (data.qrCaption || labels.qrHint) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(100);
        doc.text(labels.qrHint, W / 2, y, { align: 'center' });
        y += 10;
        if (data.qrCaption) {
          doc.text(truncate(doc, data.qrCaption, W - 2 * MARGIN), W / 2, y, { align: 'center' });
          y += 10;
        }
        doc.setTextColor(0);
      }
    } catch {
      // QR invalide → on continue sans
    }
  }

  // ── Cachet REFUNDED en diagonale si remboursé
  if (data.refunded) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(48);
    doc.setTextColor(220, 30, 30);
    // Pose au centre du document, rotation 20°.
    const cx = W / 2;
    const cy = 280;
    doc.text(labels.refundedStamp, cx, cy, { align: 'center', angle: -20 });
    doc.setTextColor(0);
  }

  // ── Footer : date d'impression
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(150);
  const printedDate = fmtDateLong(new Date().toISOString(), labels.bcp47);
  doc.text(`${labels.printedOn} ${printedDate}`, W / 2, 580, { align: 'center' });
  doc.setTextColor(0);

  return doc;
}

/** Déclenche le téléchargement du PDF généré (raccourci d'usage). */
export function downloadReceiptPdf(
  data: ReceiptData,
  salon: SalonInfo,
  labels: ReceiptLabels,
  filename?: string,
): void {
  const doc = buildReceiptPdf(data, salon, labels);
  const name = filename ?? `receipt-${data.saleId.slice(0, 8)}.pdf`;
  doc.save(name);
}
