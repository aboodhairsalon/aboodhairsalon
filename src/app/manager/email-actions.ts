'use server';
/**
 * Server Actions — envoi d'emails transactionnels (reçus).
 *
 * Le client utilise déjà l'email saisi à la création de profil (cf.
 * ClientSelector → createClientFromCashier). Cette action permet à la Caisse
 * de pousser le reçu en email tout de suite après l'encaissement.
 *
 * Sécurité :
 *  - Garde Direction OU Caisse (cf. refund-actions).
 *  - Le `to` est imposé par le serveur depuis `client_profiles.email` quand
 *    un téléphone client est rattaché à la vente — on ignore tout email
 *    fourni dans l'input du client (évite l'usage en bulk-mailer).
 *  - Si RESEND_API_KEY absent (dev sans config), retourne le code dédié et
 *    le client affiche un message clair (et le manager peut activer plus tard).
 *
 * Effets de bord :
 *  - `sales.receipt_email_sent` passe à true après succès — sert d'idempotence
 *    et d'historique audit.
 */
import { render } from '@react-email/render';
import { Resend } from 'resend';
import * as React from 'react';
import { z } from 'zod';
import { createAdminClient } from '@/db';
import { SALON } from '@/config/salon';
import { ReceiptEmail, type ReceiptEmailItem } from '@/emails';
import { utcIsoToZonedParts } from '../_lib/timezone';
import { getCurrentUser } from '../_data/auth-server';
import { createClientToken } from '../_lib/client-token';
import { resolveFromHeader } from '../_lib/email-sender';
import { rlEmailSale } from '../_lib/rate-limit';
import type { ManagerErrorCode, ManagerErrorValues } from './actions';

/** Codes étendus pour les retours d'envoi email. */
export type EmailErrorCode =
  | ManagerErrorCode
  | 'emailNotConfigured'
  | 'noClientEmail'
  | 'saleNotFound'
  | 'emailSendFailed';

export type SendEmailResult =
  | { ok: true }
  | { ok: false; errorKey: EmailErrorCode; errorValues?: ManagerErrorValues };

async function requireAnyTenantRole(): Promise<
  { ok: true; userId: string; tenantId: string } | { ok: false; errorKey: ManagerErrorCode }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, errorKey: 'directionOnly' as const };
  // Single-tenant : staff authentifié (manager/cashier) suffit. L'ancien
  // check exigeait app_metadata.tenant_id — absent des comptes caissier
  // historiques → l'envoi du reçu par email échouait depuis la caisse
  // (tenantMissing silencieux). Audit. Même garde que refund-actions.
  const role = user.app_metadata?.['role'] as string | undefined;
  if (role && role !== 'manager' && role !== 'cashier') {
    return { ok: false, errorKey: 'tenantMissing' as const };
  }
  return { ok: true, userId: user.id, tenantId: SALON.tenantUuid };
}

const SendReceiptEmailSchema = z.object({
  saleId: z.string().uuid('invalidStaffId'),
  /** Locale du destinataire — pour traduire le contenu. */
  locale: z.enum(['fr', 'en', 'ar']).default('fr'),
  /** Si true, contourne l'idempotence FAST PATH (sales.receipt_email_sent)
   *  et renvoie l'email. Le rate-limit (3/h par saleId) reste en place
   *  pour borner les abus. Audit T5.10. */
  forceResend: z.boolean().optional().default(false),
});

export type SendReceiptEmailInput = z.input<typeof SendReceiptEmailSchema>;

// Labels embarqués dans le serveur — pas d'i18n côté client pour le contenu
// de l'email (le serveur sait quoi envoyer dans quelle langue).
const EMAIL_LABELS: Record<
  'fr' | 'en' | 'ar',
  {
    subject: string;
    preview: string;
    greeting: string;
    intro: string;
    receiptHeading: string;
    saleNumber: string;
    date: string;
    method: string;
    client: string;
    itemDesc: string;
    qty: string;
    unit: string;
    total: string;
    subtotal: string;
    tip: string;
    grandTotal: string;
    refundedNotice: string;
    accessSpace: string;
    spaceCta: string;
    thanks: string;
    footer: string;
    methodCard: string;
    methodCash: string;
    methodMobile: string;
    bcp47: string;
  }
> = {
  fr: {
    subject: 'Votre reçu — {salon}',
    preview: 'Reçu de votre passage chez {salon}.',
    greeting: 'Bonjour',
    intro: 'Merci pour votre visite. Voici le détail de votre passage.',
    receiptHeading: 'Récapitulatif',
    saleNumber: 'Vente n°',
    date: 'Date',
    method: 'Paiement',
    client: 'Client',
    itemDesc: 'Désignation',
    qty: 'Qté',
    unit: 'PU',
    total: 'Total',
    subtotal: 'Sous-total',
    tip: 'Pourboire',
    grandTotal: 'Total réglé',
    refundedNotice: 'Cette vente a été remboursée. Ce reçu est conservé pour vos archives.',
    accessSpace: 'Retrouvez vos factures et vos points fidélité dans votre espace client.',
    spaceCta: 'Accéder à mon espace',
    thanks: 'À très bientôt !',
    footer:
      'Cet email a été envoyé automatiquement. Vous pouvez répondre directement à votre salon pour toute question.',
    methodCard: 'Carte',
    methodCash: 'Espèces',
    methodMobile: 'Mobile',
    bcp47: 'fr-FR',
  },
  en: {
    subject: 'Your receipt — {salon}',
    preview: 'Receipt for your visit at {salon}.',
    greeting: 'Hi',
    intro: 'Thanks for visiting. Here are the details of your purchase.',
    receiptHeading: 'Summary',
    saleNumber: 'Sale #',
    date: 'Date',
    method: 'Payment',
    client: 'Client',
    itemDesc: 'Description',
    qty: 'Qty',
    unit: 'Unit',
    total: 'Total',
    subtotal: 'Subtotal',
    tip: 'Tip',
    grandTotal: 'Total paid',
    refundedNotice: 'This sale has been refunded. The receipt is kept for your records.',
    accessSpace: 'Find your invoices and loyalty points in your client space.',
    spaceCta: 'Open my space',
    thanks: 'See you soon!',
    footer: 'This email was sent automatically. Reply to your salon directly for any question.',
    methodCard: 'Card',
    methodCash: 'Cash',
    methodMobile: 'Mobile',
    bcp47: 'en-US',
  },
  ar: {
    subject: 'إيصالك — {salon}',
    preview: 'إيصال زيارتك إلى {salon}.',
    greeting: 'مرحباً',
    intro: 'شكراً لزيارتك. إليك تفاصيل عمليتك.',
    receiptHeading: 'الملخص',
    saleNumber: 'رقم البيع',
    date: 'التاريخ',
    method: 'طريقة الدفع',
    client: 'العميل',
    itemDesc: 'الوصف',
    qty: 'الكمية',
    unit: 'السعر',
    total: 'الإجمالي',
    subtotal: 'المجموع الفرعي',
    tip: 'إكرامية',
    grandTotal: 'الإجمالي المدفوع',
    refundedNotice: 'تمّ ردّ هذا البيع. يُحفظ الإيصال في سجلاتك.',
    accessSpace: 'اعثر على فواتيرك ونقاط ولائك في مساحتك الشخصية.',
    spaceCta: 'فتح مساحتي',
    thanks: 'نراك قريباً!',
    footer: 'تم إرسال هذا البريد تلقائياً. يمكنك الردّ مباشرة على صالونك لأي سؤال.',
    methodCard: 'بطاقة',
    methodCash: 'نقدي',
    methodMobile: 'جوال',
    bcp47: 'ar-EG',
  },
};

/**
 * Envoie le reçu d'une vente par email au client rattaché.
 *
 * Lecture serveur pure : l'utilisateur ne peut pas spécifier de destinataire
 * — c'est le `client_profiles.email` lié au `client_phone` de la vente qui
 * sert. Évite tout usage détourné en mailer en masse.
 */
export async function sendReceiptEmail(input: SendReceiptEmailInput): Promise<SendEmailResult> {
  const guard = await requireAnyTenantRole();
  if (!guard.ok) return guard;

  const parsed = SendReceiptEmailSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errorKey: 'invalidData' };
  }
  const { saleId, locale, forceResend } = parsed.data;
  const labels = EMAIL_LABELS[locale];

  const apiKey = process.env['RESEND_API_KEY'];

  if (!apiKey || apiKey.length < 10) {
    return { ok: false, errorKey: 'emailNotConfigured' };
  }

  // Rate-limit anti-spam : 3 envois/heure par saleId. Défense en profondeur
  // contre une loop de clic même si le claim atomique passe (ex. deux
  // operators sur deux tablettes différentes). Au-delà = signal pour
  // l'équipe que quelque chose ne va pas dans le workflow.
  if (!(await rlEmailSale(saleId))) {
    return { ok: false, errorKey: 'emailSendFailed', errorValues: { message: '' } };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // 1. Charger la vente + items + tenant + branding. On SELECTionne aussi
  //    `receipt_email_sent` pour court-circuiter les double-envois (un user
  //    qui spamme le bouton "Envoyer par email" ne déclenche qu'un seul
  //    appel Resend — économie de quota + protection anti-flood pour le client).
  const saleRes = await admin
    .from('sales')
    .select(
      'id, created_at, client_phone, client_name, method, total_cents, tip_cents, status, receipt_email_sent, sale_items(name, qty, unit_price_cents)',
    )
    .eq('id', saleId)
    
    .maybeSingle();

  if (saleRes.error || !saleRes.data) {
    return { ok: false, errorKey: 'saleNotFound' };
  }
  const sale = saleRes.data;

  // Idempotence FAST PATH : déjà envoyé → succès sans rappeler Resend.
  // Le claim atomique ci-dessous est de toute façon plus robuste — ce check
  // évite juste les requêtes inutiles dans le cas non-concurrent typique.
  // SAUF si `forceResend=true` (audit T5.10) : la caissière relance
  // intentionnellement l'envoi (client qui n'a jamais recu, ou veut une
  // copie de plus). Le rate-limit (3/h par saleId) protege du spam.
  if (sale.receipt_email_sent === true && !forceResend) {
    return { ok: true };
  }

  // 2. Récupérer email du client via tenant_id + phone
  if (!sale.client_phone) {
    return { ok: false, errorKey: 'noClientEmail' };
  }
  const profileRes = await admin
    .from('client_profiles')
    .select('phone, first_name, last_name, email')
    
    .eq('phone', sale.client_phone)
    .maybeSingle();

  if (!profileRes.data?.email) {
    return { ok: false, errorKey: 'noClientEmail' };
  }
  const recipientEmail = profileRes.data.email;
  // `[null, null].filter(Boolean).join(' ').trim()` retourne '' (pas null) :
  // on doit promouvoir l'empty string en null explicitement, sinon le
  // template email reçoit clientName='' au lieu de null et affiche
  // "Bonjour ," au lieu de "Bonjour".
  const composedName = [profileRes.data.first_name, profileRes.data.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  const clientName = sale.client_name ?? (composedName || null);

  // 3. Charger tenant + branding + settings pour l'entête
  const [tenantRes, brandingRes, settingsRes] = await Promise.all([
    admin.from('tenants').select('id, name, slug, currency').eq('id', guard.tenantId).maybeSingle(),
    admin.from('tenant_branding').select('logo_url').maybeSingle(),
    admin
      .from('tenant_settings')
      .select('tagline, address_street, address_city, address_zip, contact_email')
      
      .maybeSingle(),
  ]);

  const tenant = tenantRes.data ?? { name: '', slug: '', currency: 'EUR' };
  const branding = brandingRes.data ?? { logo_url: null };
  const settings = settingsRes.data ?? {
    tagline: null,
    address_street: null,
    address_city: null,
    address_zip: null,
    contact_email: null,
  };
  const addressLine = [settings.address_street, settings.address_zip, settings.address_city]
    .filter(Boolean)
    .join(', ');

  const items: ReceiptEmailItem[] = (
    (sale.sale_items as { name: string; qty: number; unit_price_cents: number }[] | null) ?? []
  ).map((si) => ({ name: si.name, qty: si.qty ?? 1, priceCents: si.unit_price_cents ?? 0 }));

  const dateObj = new Date(sale.created_at);
  // Date + heure en timezone salon (Le Caire) — sur Vercel le serveur tourne
  // en UTC, donc sans timeZone l'heure du reçu était décalée de −2/−3h et
  // contredisait l'affichage caisse/client. Audit TZ.
  const dateLong = new Intl.DateTimeFormat(labels.bcp47, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: SALON.timezone,
  }).format(dateObj);
  const time = utcIsoToZonedParts(sale.created_at as string, SALON.timezone).time;

  // Libellés de marque (Visa / Cash / InstaPay) — identiques dans toutes les langues.
  const methodLabel =
    sale.method === 'card' ? 'Visa' : sale.method === 'cash' ? 'Cash' : 'InstaPay';

  // URL espace client : signée serveur-side via token HMAC pour ne pas
  // envoyer le téléphone client en clair dans le body email (loggué chez
  // Resend, le destinataire, son client mail, archivé indéfiniment…).
  // Le token contient {tenant, phone, exp 90j} et le serveur le vérifie
  // à l'arrivée (cf. client/page.tsx — verifyClientToken).
  // URL canonique de l'espace client : host-based (book.aboodhairsalon.com),
  // PAS de route path-slug `/{slug}/client` (elle n'existe pas → 404). Audit.
  const spaceUrl = `${SALON.spaces.book}/client?t=${encodeURIComponent(
    createClientToken(SALON.tenantUuid, sale.client_phone),
  )}`;

  // 4. Rendu HTML + envoi
  const subject = labels.subject.replace('{salon}', tenant.name);
  const previewText = labels.preview.replace('{salon}', tenant.name);
  const html = await render(
    React.createElement(ReceiptEmail, {
      salonName: tenant.name,
      logoUrl: branding.logo_url,
      tagline: settings.tagline,
      addressLine: addressLine || null,
      previewText,
      dateLong,
      time,
      saleId: sale.id,
      clientName,
      items,
      methodLabel,
      totalCents: sale.total_cents,
      tipCents: sale.tip_cents ?? undefined,
      currency: tenant.currency,
      bcp47: labels.bcp47,
      spaceUrl,
      refunded: sale.status === 'refunded',
      labels: {
        greeting: labels.greeting,
        intro: labels.intro,
        receiptHeading: labels.receiptHeading,
        saleNumber: labels.saleNumber,
        date: labels.date,
        method: labels.method,
        client: labels.client,
        itemDesc: labels.itemDesc,
        qty: labels.qty,
        unit: labels.unit,
        total: labels.total,
        subtotal: labels.subtotal,
        tip: labels.tip,
        grandTotal: labels.grandTotal,
        refundedNotice: labels.refundedNotice,
        accessSpace: labels.accessSpace,
        spaceCta: labels.spaceCta,
        thanks: labels.thanks,
        footer: labels.footer,
      },
    }),
  );

  // ── CLAIM ATOMIQUE : passe `receipt_email_sent` de false → true AVANT
  //    l'appel Resend. Si l'UPDATE matche 0 rows, c'est qu'un autre process
  //    concurrent (Direction + Caisse cliquent en même temps) a déjà claim
  //    → on retourne succès sans envoyer. Cf. audit-2 finding H : sans ce
  //    pattern, le check `if (sale.receipt_email_sent)` au début pouvait être
  //    franchi par deux requêtes parallèles → double envoi Resend.
  // En mode forceResend (T5.10), on relâche la garde `=false` : le UPDATE
  // matche que la vente soit déjà sent ou pas. Le rate-limit (3/h par saleId)
  // protège du spam et le claim reste atomique vs concurrent forced.
  let claimQuery = admin
    .from('sales')
    .update({ receipt_email_sent: true })
    .eq('id', saleId)
    ;
  if (!forceResend) {
    claimQuery = claimQuery.eq('receipt_email_sent', false);
  }
  const { data: claim } = await claimQuery.select('id');

  if (!claim || (claim as unknown[]).length === 0) {
    // Quelqu'un d'autre a déjà claim → succès sans envoi (idempotent).
    return { ok: true };
  }

  const resend = new Resend(apiKey);
  // Le from doit avoir un nom lisible si on veut éviter le filtrage spam.
  // Format `Salon Name <noreply@aboodhairsalon.com>` — sender per-tenant si
  // configuré via tenant_settings.email_from_address, sinon fallback global.
  const fromHeader = await resolveFromHeader(guard.tenantId, tenant.name ?? null);

  const sendRes = await resend.emails.send({
    from: fromHeader,
    to: recipientEmail,
    subject,
    html,
    // replyTo : si le salon a renseigné un `contact_email`, les réponses
    // tombent dessus ; sinon on omet le header (Resend mettra `from`).
    // Crucial parce que le footer du template promet "vous pouvez répondre".
    replyTo: settings.contact_email ?? undefined,
  });

  if (sendRes.error) {
    // Resend a échoué — il faut COMPENSER : on remet `receipt_email_sent`
    // à false pour permettre un nouveau réessai. Sans ce rollback, l'UPDATE
    // de claim ci-dessus bloque définitivement les retry futurs.
    await admin
      .from('sales')
      .update({ receipt_email_sent: false })
      .eq('id', saleId)
      ;
    // Log côté serveur pour debug, mais on ne renvoie pas le message Resend
    // brut au client (peut contenir des détails internes : ID de tentative,
    // queue position, raisons d'anti-spam). Le code suffit.

    console.error('[email-actions] resend send error', sendRes.error);
    return {
      ok: false,
      errorKey: 'emailSendFailed',
      errorValues: { message: '' },
    };
  }

  // `receipt_email_sent = true` est DÉJÀ posé par le claim atomique ci-dessus
  // — pas besoin de re-UPDATE. Si on est arrivés ici, Resend a accepté
  // l'email et la vente est marquée comme envoyée.
  return { ok: true };
}
