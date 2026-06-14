'use server';
/**
 * Server Action — génération PDF du reçu côté serveur (anti-falsification).
 *
 * Le PDF client-side (cf. `_lib/receipt-pdf.ts` + `getSaleReceiptSnapshot`)
 * reste falsifiable dans la fenêtre entre le snapshot serveur et le rendu
 * navigateur (un client peut intercepter et modifier la réponse). Cette
 * action génère le PDF intégralement côté serveur et retourne le binaire
 * en base64 — le client ne fait que déclencher le download.
 *
 * Bonus : footer signé HMAC. La signature couvre (saleId, total, date) +
 * `CLIENT_TOKEN_SECRET`. Une route `/verify/:hash` (à venir) permet de
 * confirmer qu'un PDF présenté par un client correspond bien à une vente
 * réelle — utile pour les contestations / SAV.
 *
 * jsPDF tourne en Node depuis v2 — on l'importe dynamiquement pour
 * éviter de gonfler le bundle client.
 */

import { createHmac } from 'crypto';
import { createAdminClient } from '@/db';
import { rlSalesIp, rlSalesPhone } from '../_lib/rate-limit';
import { getAuthedClientPhone } from './client-session';
import type { ClientErrorCode, ClientErrorValues } from './review-actions';

export type DownloadPdfResult =
  | { ok: true; pdfBase64: string; filename: string; verifyHash: string }
  | { ok: false; errorKey: ClientErrorCode; errorValues?: ClientErrorValues };

/** Calcule le hash HMAC qui sera affiché en footer du PDF. La signature
 *  couvre les valeurs financières clés (saleId, total, refunded) + secret
 *  serveur. */
function computeVerifyHash(saleId: string, totalCents: number, refunded: boolean): string {
  const secret =
    process.env['CLIENT_TOKEN_SECRET'] ??
    process.env['SUPABASE_SERVICE_ROLE_KEY'] ??
    'INSECURE_DEFAULT_VERIFY_SECRET';
  return createHmac('sha256', secret)
    .update(`${saleId}|${totalCents}|${refunded ? '1' : '0'}`)
    .digest('hex')
    .slice(0, 16); // 16 hex = 64 bits, suffisant contre forge naïve
}

/** Labels PDF figés par locale — pas d'i18n côté serveur, donc on hardcode
 *  les chaînes courtes des trois langues. */
const PDF_LABELS: Record<
  'fr' | 'en' | 'ar',
  {
    documentTitle: string;
    saleNumber: string;
    method: string;
    client: string;
    subtotal: string;
    tip: string;
    total: string;
    qty: string;
    unitPrice: string;
    lineTotal: string;
    itemDesc: string;
    refundedStamp: string;
    printedOn: string;
    verifyLabel: string;
    methodCard: string;
    methodCash: string;
    methodMobile: string;
    bcp47: string;
  }
> = {
  fr: {
    documentTitle: 'Reçu de caisse',
    saleNumber: 'Vente n°',
    method: 'Mode',
    client: 'Client',
    subtotal: 'Sous-total',
    tip: 'Pourboire',
    total: 'Total',
    qty: 'Qté',
    unitPrice: 'PU',
    lineTotal: 'Total',
    itemDesc: 'Désignation',
    refundedStamp: 'REMBOURSÉ',
    printedOn: 'Imprimé le',
    verifyLabel: 'Code d’authenticité',
    methodCard: 'Carte',
    methodCash: 'Espèces',
    methodMobile: 'Mobile',
    bcp47: 'fr-FR',
  },
  en: {
    documentTitle: 'Receipt',
    saleNumber: 'Sale #',
    method: 'Method',
    client: 'Client',
    subtotal: 'Subtotal',
    tip: 'Tip',
    total: 'Total',
    qty: 'Qty',
    unitPrice: 'Unit',
    lineTotal: 'Total',
    itemDesc: 'Description',
    refundedStamp: 'REFUNDED',
    printedOn: 'Printed on',
    verifyLabel: 'Verify code',
    methodCard: 'Card',
    methodCash: 'Cash',
    methodMobile: 'Mobile',
    bcp47: 'en-US',
  },
  ar: {
    documentTitle: 'إيصال البيع',
    saleNumber: 'رقم البيع',
    method: 'طريقة الدفع',
    client: 'العميل',
    subtotal: 'المجموع الفرعي',
    tip: 'الإكرامية',
    total: 'الإجمالي',
    qty: 'الكمية',
    unitPrice: 'السعر',
    lineTotal: 'الإجمالي',
    itemDesc: 'الوصف',
    refundedStamp: 'مردود',
    printedOn: 'طُبع في',
    verifyLabel: 'رمز التحقق',
    methodCard: 'بطاقة',
    methodCash: 'نقدي',
    methodMobile: 'جوال',
    bcp47: 'ar-EG',
  },
};

/**
 * Génère le PDF d'un reçu côté serveur et retourne le binaire base64.
 * Garde : (tenantId, saleId, phone) doivent matcher en DB (le phone agit
 * comme credential, cohérent avec `getSaleReceiptSnapshot`).
 *
 * Le client navigateur reçoit le base64 + le filename + le verifyHash, et
 * fait un download via blob — pas de chemin pour modifier le contenu.
 */
export async function downloadReceiptPdfServer(
  tenantId: string,
  saleId: string,
  phone: string,
  locale: 'fr' | 'en' | 'ar' = 'fr',
): Promise<DownloadPdfResult> {
  // 🔒 Source de vérité : téléphone du COOKIE de session vérifié, jamais du
  // paramètre `phone` (un attaquant pourrait télécharger le reçu d'autrui en
  // forgeant le numéro). Le paramètre est ignoré — gardé pour compat de
  // signature avec les call-sites existants.
  void phone;
  const authedPhone = await getAuthedClientPhone();
  if (!authedPhone) return { ok: false, errorKey: 'authRequired' };
  if (!tenantId || !saleId) {
    return { ok: false, errorKey: 'missingParams' };
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saleId)) {
    return { ok: false, errorKey: 'missingParams' };
  }
  const normalizedPhone = authedPhone;

  // Rate limit (mêmes buckets que getClientSales / snapshot).
  let ip = 'unknown';
  try {
    const { headers } = await import('next/headers');
    const h = await headers();
    ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown';
  } catch {
    // hors requête
  }
  const [phoneOk, ipOk] = await Promise.all([
    rlSalesPhone(tenantId, normalizedPhone),
    rlSalesIp(tenantId, ip),
  ]);
  if (!phoneOk || !ipOk) {
    return { ok: false, errorKey: 'tenantNotAuthorized' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // 1. Sale + items — filtre tenant + phone garantit l'ownership.
  const saleRes = await admin
    .from('sales')
    .select(
      'id, created_at, total_cents, tip_cents, method, status, client_name, sale_items(name, qty, unit_price_cents)',
    )
    .eq('id', saleId)
    
    .eq('client_phone', normalizedPhone)
    .maybeSingle();

  if (saleRes.error || !saleRes.data) {
    return { ok: false, errorKey: 'tenantNotAuthorized' };
  }
  const sale = saleRes.data as {
    id: string;
    created_at: string;
    total_cents: number;
    tip_cents: number | null;
    method: string;
    status: string | null;
    client_name: string | null;
    sale_items: { name: string; qty: number; unit_price_cents: number }[] | null;
  };

  // 2. Charger tenant + branding + settings en parallèle.
  const [tenantRes, brandingRes, settingsRes] = await Promise.all([
    admin.from('tenants').select('name, currency').eq('id', tenantId).maybeSingle(),
    admin.from('tenant_branding').select('logo_url').maybeSingle(),
    admin
      .from('tenant_settings')
      .select(
        'tagline, address_street, address_city, address_zip, branch, contact_phone, contact_email',
      )
      
      .maybeSingle(),
  ]);
  const tenant = (tenantRes.data ?? { name: '', currency: 'EUR' }) as {
    name: string;
    currency: string;
  };
  const branding = (brandingRes.data ?? { logo_url: null }) as { logo_url: string | null };
  const settings = (settingsRes.data ?? {}) as {
    tagline: string | null;
    address_street: string | null;
    address_city: string | null;
    address_zip: string | null;
    branch: string | null;
    contact_phone: string | null;
    contact_email: string | null;
  };

  // 3. Charger jsPDF dynamiquement (évite le bundle Edge si jamais inutilisé).
  const { default: jsPDF } = await import('jspdf');

  const labels = PDF_LABELS[locale];
  const refunded = sale.status === 'refunded';
  const dateObj = new Date(sale.created_at);
  const dateLong = new Intl.DateTimeFormat(labels.bcp47, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(dateObj);
  const time = `${String(dateObj.getUTCHours()).padStart(2, '0')}:${String(
    dateObj.getUTCMinutes(),
  ).padStart(2, '0')}`;

  // Libellés de marque (Visa / Cash / InstaPay) — identiques dans toutes les
  // langues, et compatibles jsPDF (latin), contrairement à un libellé arabe.
  const methodLabel =
    sale.method === 'card' ? 'Visa' : sale.method === 'cash' ? 'Cash' : 'InstaPay';

  const items = sale.sale_items ?? [];
  const itemsSubtotal = items.reduce((s, i) => s + (i.unit_price_cents ?? 0) * (i.qty ?? 1), 0);
  const grandTotal = sale.total_cents + (sale.tip_cents ?? 0);

  const fmtMoney = (cents: number) =>
    new Intl.NumberFormat(labels.bcp47, {
      style: 'currency',
      currency: tenant.currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(cents / 100);

  // 4. Construire le PDF — layout identique au client-side (cf. receipt-pdf.ts)
  //    pour que les deux versions soient indistinguables visuellement.
  const doc = new jsPDF({ unit: 'pt', format: [298, 620], orientation: 'portrait' });
  const W = 298;
  const MARGIN = 24;
  let y = MARGIN;

  if (branding.logo_url && branding.logo_url.startsWith('data:image/')) {
    try {
      const imgType = branding.logo_url.includes('image/png') ? 'PNG' : 'JPEG';
      doc.addImage(branding.logo_url, imgType, (W - 48) / 2, y, 48, 48);
      y += 56;
    } catch {
      // logo invalide → on continue
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(tenant.name, W / 2, y, { align: 'center' });
  y += 18;

  if (settings.tagline) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(settings.tagline, W / 2, y, { align: 'center' });
    doc.setTextColor(0);
    y += 12;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100);
  const addrLine = [settings.address_street, settings.address_zip, settings.address_city]
    .filter(Boolean)
    .join(', ');
  if (addrLine) {
    doc.text(addrLine, W / 2, y, { align: 'center' });
    y += 10;
  }
  if (settings.branch) {
    doc.text(settings.branch, W / 2, y, { align: 'center' });
    y += 10;
  }
  const contactLine = [settings.contact_phone, settings.contact_email].filter(Boolean).join(' · ');
  if (contactLine) {
    doc.text(contactLine, W / 2, y, { align: 'center' });
    y += 10;
  }
  doc.setTextColor(0);
  y += 6;

  doc.setDrawColor(200);
  doc.line(MARGIN, y, W - MARGIN, y);
  y += 14;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`${labels.saleNumber} ${sale.id.slice(0, 8).toUpperCase()}`, MARGIN, y);
  doc.text(`${dateLong} · ${time}`, W - MARGIN, y, { align: 'right' });
  y += 12;
  if (sale.client_name) {
    doc.text(`${labels.client} : ${sale.client_name.slice(0, 40)}`, MARGIN, y);
    y += 12;
  }
  doc.text(`${labels.method} : ${methodLabel}`, MARGIN, y);
  y += 16;

  doc.line(MARGIN, y, W - MARGIN, y);
  y += 14;

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
  for (const item of items) {
    doc.text(String(item.name).slice(0, 32), MARGIN, y);
    doc.text(String(item.qty), MARGIN + 140, y);
    doc.text(fmtMoney(item.unit_price_cents ?? 0), MARGIN + 175, y);
    doc.text(fmtMoney((item.unit_price_cents ?? 0) * (item.qty ?? 1)), W - MARGIN, y, {
      align: 'right',
    });
    y += 12;
    if (y > 540) break;
  }
  y += 4;
  doc.line(MARGIN, y, W - MARGIN, y);
  y += 14;

  if ((sale.tip_cents ?? 0) > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(labels.subtotal, MARGIN, y);
    doc.text(fmtMoney(itemsSubtotal), W - MARGIN, y, { align: 'right' });
    y += 12;
    doc.text(labels.tip, MARGIN, y);
    doc.text(fmtMoney(sale.tip_cents ?? 0), W - MARGIN, y, { align: 'right' });
    y += 14;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(labels.total, MARGIN, y);
  doc.text(fmtMoney(grandTotal), W - MARGIN, y, { align: 'right' });
  y += 22;

  if (refunded) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(48);
    doc.setTextColor(220, 30, 30);
    doc.text(labels.refundedStamp, W / 2, 280, { align: 'center', angle: -20 });
    doc.setTextColor(0);
  }

  // Footer : date d'impression + code de vérification HMAC
  const verifyHash = computeVerifyHash(sale.id, sale.total_cents, refunded);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(150);
  const printedDate = new Intl.DateTimeFormat(labels.bcp47, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
  doc.text(`${labels.printedOn} ${printedDate}`, W / 2, 590, { align: 'center' });
  doc.text(`${labels.verifyLabel}: ${verifyHash}`, W / 2, 602, { align: 'center' });
  doc.setTextColor(0);

  // 5. Sérialiser en base64 — `output('arraybuffer')` retourne un Buffer
  //    qu'on encode pour le passage Server Action → client.
  const arrayBuffer = doc.output('arraybuffer') as ArrayBuffer;
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  const filename = `receipt-${sale.id.slice(0, 8)}.pdf`;

  return { ok: true, pdfBase64: base64, filename, verifyHash };
}
