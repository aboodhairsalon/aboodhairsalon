'use server';

/**
 * Envoi d'email au client après un remboursement (partiel ou total).
 *
 * Politique : c'est une information IMPORTANTE pour le client — il voit le
 * débit du salon disparaître sur sa carte, il doit comprendre pourquoi.
 * Sans email il pourrait :
 *  - Contester le refund auprès de sa banque (chargeback)
 *  - Croire à une erreur de la caissière
 *  - Manquer le motif (« on a refait votre coupe gratos, le 1er paiement
 *    était une erreur de saisie ») et perdre confiance dans le salon.
 *
 * Fire-and-forget : si l'envoi échoue (Resend down, email pas configuré
 * pour ce client, etc.), le refund DB reste valide. On ne bloque pas
 * l'opération comptable sur une dépendance externe.
 *
 * Composition email :
 *  - Subject localisé (fr/en/ar) — locale du tenant
 *  - Total remboursé + raison (si fournie)
 *  - Mention si refund partiel (« 50 EGP sur les 100 EGP de la vente »)
 *  - Pas de signature « no-reply » — le from inclut le nom du salon pour
 *    que le client puisse répondre directement à son salon.
 *
 * Sans email configuré côté tenant (RESEND_API_KEY absent) ou côté client
 * (client_profiles.email NULL) → silencieux, pas d'erreur remontée.
 */
import { Resend } from 'resend';
import { createAdminClient } from '@/db';
import { fmtMoney, type Currency } from '@/lib/money';
import { resolveFromHeader } from '../_lib/email-sender';
import { reportError } from '../_lib/error-reporter';

type Locale = 'fr' | 'en' | 'ar';

const LABELS: Record<
  Locale,
  {
    subject: (salon: string) => string;
    greeting: (name: string) => string;
    intro: (salon: string) => string;
    refundedTotal: string;
    fullRefund: string;
    partialRefund: (refunded: string, total: string) => string;
    reasonLabel: string;
    closingFull: string;
    closingPartial: string;
    bcp47: string;
  }
> = {
  fr: {
    subject: (salon) => `Confirmation de remboursement — ${salon}`,
    greeting: (name) => `Bonjour ${name},`,
    intro: (salon) => `Le salon ${salon} a procédé à un remboursement sur votre dernière vente.`,
    refundedTotal: 'Montant remboursé',
    fullRefund: 'Vente intégralement remboursée.',
    partialRefund: (refunded, total) =>
      `Remboursement partiel : ${refunded} sur ${total} payés. Le solde reste acquis au salon.`,
    reasonLabel: 'Motif',
    closingFull:
      'Le montant sera recrédité sur votre moyen de paiement initial sous quelques jours ouvrés.',
    closingPartial:
      'Le montant remboursé sera recrédité sur votre moyen de paiement initial sous quelques jours ouvrés.',
    bcp47: 'fr-FR',
  },
  en: {
    subject: (salon) => `Refund confirmation — ${salon}`,
    greeting: (name) => `Hello ${name},`,
    intro: (salon) => `${salon} has processed a refund on your recent purchase.`,
    refundedTotal: 'Refunded amount',
    fullRefund: 'Full refund processed.',
    partialRefund: (refunded, total) =>
      `Partial refund: ${refunded} out of ${total} paid. The remainder stays with the salon.`,
    reasonLabel: 'Reason',
    closingFull:
      'The amount will be credited back to your payment method within a few business days.',
    closingPartial:
      'The refunded amount will be credited back to your payment method within a few business days.',
    bcp47: 'en-US',
  },
  ar: {
    subject: (salon) => `تأكيد استرداد — ${salon}`,
    greeting: (name) => `مرحباً ${name}،`,
    intro: (salon) => `قام ${salon} بمعالجة استرداد على عملية البيع الأخيرة.`,
    refundedTotal: 'المبلغ المسترد',
    fullRefund: 'تمّ استرداد كامل عملية البيع.',
    partialRefund: (refunded, total) =>
      `استرداد جزئي: ${refunded} من ${total} مدفوعة. يبقى الرصيد للصالون.`,
    reasonLabel: 'السبب',
    closingFull: 'سيتمّ إعادة المبلغ إلى وسيلة الدفع الأصلية خلال أيام عمل قليلة.',
    closingPartial: 'سيتمّ إعادة المبلغ المسترد إلى وسيلة الدفع الأصلية خلال أيام عمل قليلة.',
    bcp47: 'ar-EG',
  },
};

export interface NotifyRefundInput {
  tenantId: string;
  clientPhone: string;
  saleId: string;
  /** Montant de CE refund (pas le cumulé). */
  refundedCents: number;
  /** total_cents original de la sale — sert à calculer si c'est un partiel. */
  saleTotalCents: number;
  fullyRefunded: boolean;
  reason: string | null;
}

/**
 * Best-effort. Toujours résout — jamais reject côté caller pour ne pas
 * bloquer la chaîne de refund. Les erreurs sont logguées console.warn
 * (Sentry tracera plus tard quand on l'aura branché).
 */
export async function notifyClientOfRefund(input: NotifyRefundInput): Promise<void> {
  const apiKey = process.env['RESEND_API_KEY'];
  if (!apiKey || apiKey.length < 10) {
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // 1. Lookup email du client via (tenant_id, phone)
  const profileRes = await admin
    .from('client_profiles')
    .select('phone, first_name, last_name, email')
    
    .eq('phone', input.clientPhone)
    .maybeSingle();
  const profile = profileRes.data as {
    phone: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
  if (!profile?.email) {
    // Pas d'email enregistré → on ne peut pas notifier. Le refund DB reste valide.
    return;
  }

  // 2. Tenant data (nom, locale, devise) pour personnaliser
  const tenantRes = await admin
    .from('tenants')
    .select('name, locale, currency')
    .eq('id', input.tenantId)
    .maybeSingle();
  const tenant = tenantRes.data as { name: string; locale: string; currency: Currency } | null;
  if (!tenant) return;

  const locale: Locale =
    tenant.locale === 'fr' || tenant.locale === 'en' || tenant.locale === 'ar'
      ? (tenant.locale as Locale)
      : 'fr';
  const labels = LABELS[locale];

  // 3. Compose
  const clientName =
    [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim() || profile.phone;
  const refundedFmt = fmtMoney(input.refundedCents, tenant.currency, labels.bcp47);
  const totalFmt = fmtMoney(input.saleTotalCents, tenant.currency, labels.bcp47);

  const lines: string[] = [
    labels.greeting(clientName),
    '',
    labels.intro(tenant.name),
    '',
    `${labels.refundedTotal} : ${refundedFmt}`,
    input.fullyRefunded ? labels.fullRefund : labels.partialRefund(refundedFmt, totalFmt),
  ];
  if (input.reason && input.reason.trim()) {
    lines.push(`${labels.reasonLabel} : ${input.reason.trim()}`);
  }
  lines.push('', input.fullyRefunded ? labels.closingFull : labels.closingPartial);
  const text = lines.join('\n');

  // HTML simple (pas de React Email — overkill pour notification courte)
  const html = `<!DOCTYPE html>
<html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}">
<head><meta charset="utf-8"><title>${labels.subject(tenant.name)}</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height:1.6; color:#222; max-width:560px; margin:0 auto; padding:24px;">
  <p>${labels.greeting(clientName)}</p>
  <p>${labels.intro(tenant.name)}</p>
  <div style="background:#f6f3ed; border:1px solid #e5dfd0; border-radius:8px; padding:16px; margin:18px 0;">
    <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.15em; color:#888; margin-bottom:4px;">${labels.refundedTotal}</div>
    <div style="font-size:24px; font-weight:600;">${refundedFmt}</div>
    <div style="font-size:13px; color:#555; margin-top:6px;">${input.fullyRefunded ? labels.fullRefund : labels.partialRefund(refundedFmt, totalFmt)}</div>
    ${
      input.reason && input.reason.trim()
        ? `<div style="font-size:13px; color:#555; margin-top:6px;"><strong>${labels.reasonLabel} :</strong> ${escapeHtml(input.reason.trim())}</div>`
        : ''
    }
  </div>
  <p style="font-size:13px; color:#555;">${input.fullyRefunded ? labels.closingFull : labels.closingPartial}</p>
</body>
</html>`;

  const fromHeader = await resolveFromHeader(input.tenantId, tenant.name);

  const resend = new Resend(apiKey);
  try {
    await resend.emails.send({
      from: fromHeader,
      to: profile.email,
      subject: labels.subject(tenant.name),
      text,
      html,
    });
  } catch (e) {
    reportError(e, {
      feature: 'refund-email',
      tenantId: input.tenantId,
      saleId: input.saleId,
    });
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
