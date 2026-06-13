/**
 * Impression directe du ticket de caisse — HTML 80 mm via iframe caché.
 *
 * Contrairement au PDF (jsPDF, police latine → l'arabe s'affiche en carrés),
 * l'impression HTML rend nativement l'arabe + le RTL. Un clic « Imprimer »
 * ouvre directement la boîte de dialogue d'impression du navigateur, ce qui
 * convient aux imprimantes thermiques (rouleau 80 mm, le standard POS) comme
 * aux imprimantes A4 / « Enregistrer en PDF ».
 *
 * Réutilise les mêmes structures que le PDF (`ReceiptData`, `SalonInfo`) pour
 * que la caisse n'ait qu'un seul jeu de données à fournir.
 */
import type { ReceiptData, SalonInfo } from './receipt-pdf';

export interface ReceiptPrintLabels {
  documentTitle: string;
  saleNumber: string;
  method: string;
  client: string;
  subtotal: string;
  tip: string;
  total: string;
  qty: string;
  unitPrice: string;
  itemDesc: string;
  qrHint: string;
  printedOn: string;
  thankYou: string;
  /** Étiquette « Exemplaire client » (1er ticket). */
  copyClient: string;
  /** Étiquette « Exemplaire commerçant » (2e ticket — conservé par le salon). */
  copyMerchant: string;
  /** Locale BCP-47 (formatage montants + sens RTL si 'ar…'). */
  bcp47: string;
}

/**
 * Convertit une URL d'image (ex. logo Supabase https) en data URL base64.
 * Utile pour le PDF jsPDF, qui n'accepte QUE des data URLs (une URL https
 * est ignorée → pas de logo). Le HTML, lui, charge l'URL directement.
 *
 * Tolérant : renvoie `null` en cas d'échec (CORS, 404, timeout) → l'appelant
 * génère alors le document sans logo, sans planter.
 */
export async function imageUrlToDataUrl(
  url: string | null | undefined,
  timeoutMs = 2500,
): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:image/')) return url; // déjà une data URL
  if (typeof fetch === 'undefined') return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal, cache: 'force-cache' });
    clearTimeout(timer);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Échappe le HTML — les noms (salon, articles, client) viennent de la DB. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtMoney(cents: number, currency: string, bcp47: string): string {
  return new Intl.NumberFormat(bcp47, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function fmtDateLong(iso: string, bcp47: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(bcp47, { year: 'numeric', month: 'short', day: 'numeric' }).format(
    d,
  );
}

/** Construit le document HTML autonome du ticket (80 mm). */
export function buildReceiptHtml(
  data: ReceiptData,
  salon: SalonInfo,
  L: ReceiptPrintLabels,
): string {
  const rtl = L.bcp47.startsWith('ar');
  const money = (c: number) => fmtMoney(c, data.currency, L.bcp47);
  const itemsSubtotal = data.items.reduce((s, i) => s + i.priceCents * i.qty, 0);
  const hasTip = !!data.tipCents && data.tipCents > 0;
  const grandTotal = data.totalCents + (data.tipCents ?? 0);

  const logo =
    salon.logoDataUrl && /^https?:|^data:image\//.test(salon.logoDataUrl)
      ? `<img class="logo" src="${esc(salon.logoDataUrl)}" alt="" />`
      : '';

  const addr = [salon.addressStreet, salon.addressZip, salon.addressCity].filter(Boolean).join(', ');
  const contact = [salon.phone, salon.email].filter(Boolean).join(' · ');

  const headLines = [
    salon.tagline ? `<div class="mut">${esc(salon.tagline)}</div>` : '',
    addr ? `<div class="mut">${esc(addr)}</div>` : '',
    salon.branch ? `<div class="mut">${esc(salon.branch)}</div>` : '',
    contact ? `<div class="mut">${esc(contact)}</div>` : '',
  ].join('');

  const itemsHtml = data.items
    .map((it) => {
      const line = it.priceCents * it.qty;
      return `<div class="it">
        <div class="it-name">${esc(it.name)}</div>
        <div class="row it-sub"><span>${it.qty} × ${esc(money(it.priceCents))}</span><span>${esc(money(line))}</span></div>
      </div>`;
    })
    .join('');

  const qr =
    data.qrDataUrl && data.qrDataUrl.startsWith('data:image/')
      ? `<img class="qr" src="${esc(data.qrDataUrl)}" alt="" />
         <div class="mut c">${esc(L.qrHint)}</div>`
      : '';

  const printedOn = `<div class="foot">${esc(L.printedOn)} ${esc(
    fmtDateLong(new Date().toISOString(), L.bcp47),
  )}</div>`;

  // Un exemplaire du ticket. `copyLabel` distingue l'exemplaire client du
  // commerçant (impression en double exigée légalement). Logo + QR partagés.
  const renderCopy = (copyLabel: string) => `
  <div class="copy">
    ${logo}
    <div class="c xl">${esc(salon.name)}</div>
    <div class="c">${headLines}</div>
    <hr class="hr" />
    <div class="row"><span>${esc(L.saleNumber)} ${esc(data.receiptNumber || data.saleId.slice(0, 8).toUpperCase())}</span></div>
    <div class="row"><span>${esc(fmtDateLong(data.dateIso, L.bcp47))} · ${esc(data.time)}</span></div>
    ${data.clientName ? `<div class="row"><span>${esc(L.client)} : ${esc(data.clientName)}</span></div>` : ''}
    <div class="row"><span>${esc(L.method)} : ${esc(data.methodLabel)}</span></div>
    ${data.refunded ? `<div class="stamp">${esc(L.documentTitle)} ✗</div>` : ''}
    <hr class="hr" />
    ${itemsHtml}
    <hr class="hr" />
    ${
      hasTip
        ? `<div class="row"><span>${esc(L.subtotal)}</span><span>${esc(money(itemsSubtotal))}</span></div>
           <div class="row"><span>${esc(L.tip)}</span><span>${esc(money(data.tipCents ?? 0))}</span></div>`
        : ''
    }
    <div class="row total-row"><span>${esc(L.total)}</span><span>${esc(money(grandTotal))}</span></div>
    ${qr}
    <div class="thanks">${esc(L.thankYou)}</div>
    <div class="copy-label">${esc(copyLabel)}</div>
    ${printedOn}
  </div>`;

  // 2 exemplaires : 1er = client, 2e = commerçant. Ligne de découpe entre eux
  // (l'imprimante thermique sort les deux à la suite sur le rouleau).
  return `<!doctype html><html dir="${rtl ? 'rtl' : 'ltr'}" lang="${esc(L.bcp47.slice(0, 2))}">
<head><meta charset="utf-8" />
<style>
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { width: 80mm; font-family: 'Courier New', ui-monospace, monospace; font-size: 12px; color: #000; line-height: 1.4; }
  .copy { padding: 5mm 4mm; }
  .c { text-align: center; }
  .b { font-weight: 700; }
  .lg { font-size: 15px; }
  .xl { font-size: 19px; font-weight: 700; letter-spacing: .5px; }
  .mut { font-size: 10px; opacity: .75; }
  .hr { border: 0; border-top: 1px dashed #000; margin: 7px 0; }
  .logo { max-width: 34mm; max-height: 18mm; object-fit: contain; margin: 0 auto 5px; display: block; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .it { margin: 4px 0; }
  .it-name { font-weight: 700; }
  .it-sub { opacity: .85; }
  .total-row { font-size: 17px; font-weight: 700; margin-top: 3px; }
  .qr { width: 38mm; height: 38mm; display: block; margin: 8px auto 2px; }
  .thanks { text-align: center; font-weight: 700; margin-top: 9px; }
  .copy-label { text-align: center; font-weight: 700; font-size: 11px; letter-spacing: 1px; border: 1px solid #000; padding: 2px 0; margin: 7px 0 4px; }
  .foot { text-align: center; font-size: 9px; opacity: .65; margin-top: 4px; }
  .stamp { text-align: center; color: #b91c1c; font-weight: 700; border: 2px solid #b91c1c; padding: 2px; margin: 6px 0; letter-spacing: 2px; }
  .cut { text-align: center; font-size: 10px; opacity: .6; letter-spacing: 1px; padding: 4px 4mm 6px; }
</style></head>
<body>
  ${renderCopy(L.copyClient)}
  <div class="cut">✂ — — — — — — — — — — — — — — —</div>
  ${renderCopy(L.copyMerchant)}
</body></html>`;
}

/**
 * Imprime le ticket : écrit le HTML dans un iframe caché, attend le chargement
 * des images (logo + QR) puis déclenche `print()`. L'iframe est retiré après.
 */
export function printReceipt(data: ReceiptData, salon: SalonInfo, labels: ReceiptPrintLabels): void {
  if (typeof window === 'undefined') return;
  const html = buildReceiptHtml(data, salon, labels);

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument ?? win?.document;
  if (!win || !doc) {
    iframe.remove();
    return;
  }

  let printed = false;
  const cleanup = () => {
    // Délai : laisser la boîte d'impression s'emparer du contenu avant de retirer.
    window.setTimeout(() => iframe.remove(), 1500);
  };
  const triggerPrint = () => {
    if (printed) return;
    printed = true;
    try {
      win.focus();
      win.print();
    } catch {
      /* impression annulée / indisponible */
    }
    cleanup();
  };

  doc.open();
  doc.write(html);
  doc.close();

  // Attendre le chargement des images (logo distant + QR) avant d'imprimer,
  // sinon le ticket peut s'imprimer sans le logo. Fallback : timeout de sécurité.
  const imgs = Array.from(doc.images ?? []);
  if (imgs.length === 0) {
    window.setTimeout(triggerPrint, 150);
  } else {
    let remaining = imgs.length;
    const done = () => {
      if (--remaining <= 0) triggerPrint();
    };
    for (const img of imgs) {
      if (img.complete) done();
      else {
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      }
    }
  }
  // Garde-fou : imprime quoi qu'il arrive après 2,5 s (image bloquée / lente).
  window.setTimeout(triggerPrint, 2500);
}
