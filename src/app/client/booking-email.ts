'use server';

/**
 * Envoi d'email de confirmation au client après la creation d'un RDV.
 *
 * Pourquoi : sans cet email, le client qui vient de reserver via /client
 * n'a AUCUN feedback persistant. Le seul retour est l'ecran de
 * confirmation in-app — s'il quitte la page, plus de trace de son RDV.
 * Pour les visiteurs marketing (qui ne creent pas de compte client), c'est
 * particulierement critique : ils ne retrouveront pas leur RDV dans
 * « Mes RDV » s'ils oublient leur telephone (le profile est en
 * localStorage avant la 1ere visite).
 *
 * Composition :
 *  - Subject localise selon `tenants.locale` (fr/en/ar)
 *  - Recap : salon + service + barbier + date + heure
 *  - Lien direct vers /{slug}/client?t={token signe} pour permettre au
 *    client de revenir dans son espace sans ressaisir son tel.
 *  - Lien Google Calendar (ICS via /client/booking/{id}/ics)
 *
 * Fire-and-forget : Resend down ou client_profiles.email NULL → silencieux.
 * Le RDV en DB reste valide quel que soit l'envoi.
 */
import { Resend } from 'resend';
import { createAdminClient } from '@/db';
import { createClientToken } from '../_lib/client-token';
import { resolveFromHeader } from '../_lib/email-sender';
import { reportError } from '../_lib/error-reporter';
import { formatDateLong, utcIsoToZonedParts } from '../_lib/timezone';
import { SALON } from '@/config/salon';

type Locale = 'fr' | 'en' | 'ar';

const LABELS: Record<
  Locale,
  {
    subject: (salon: string) => string;
    greeting: (name: string) => string;
    intro: (salon: string) => string;
    recapHeader: string;
    serviceLabel: string;
    barberLabel: string;
    dateLabel: string;
    timeLabel: string;
    addressLabel: string;
    openProfileCta: string;
    addToCalendarCta: string;
    cancelHint: string;
    seeYou: string;
    bcp47: string;
  }
> = {
  fr: {
    subject: (salon) => `Confirmation de votre RDV — ${salon}`,
    greeting: (name) => `Bonjour ${name},`,
    intro: (salon) => `Votre rendez-vous chez ${salon} est confirme.`,
    recapHeader: 'Recap du RDV',
    serviceLabel: 'Prestation',
    barberLabel: 'Avec',
    dateLabel: 'Date',
    timeLabel: 'Heure',
    addressLabel: 'Adresse',
    openProfileCta: 'Mon espace',
    addToCalendarCta: 'Ajouter au calendrier',
    cancelHint:
      "Pour annuler ou modifier votre RDV, ouvrez votre espace personnel. Annulation gratuite jusqu'a 2h avant.",
    seeYou: 'A bientot !',
    bcp47: 'fr-FR',
  },
  en: {
    subject: (salon) => `Your booking is confirmed — ${salon}`,
    greeting: (name) => `Hello ${name},`,
    intro: (salon) => `Your appointment at ${salon} is confirmed.`,
    recapHeader: 'Booking summary',
    serviceLabel: 'Service',
    barberLabel: 'With',
    dateLabel: 'Date',
    timeLabel: 'Time',
    addressLabel: 'Address',
    openProfileCta: 'My account',
    addToCalendarCta: 'Add to calendar',
    cancelHint:
      'To cancel or reschedule, open your account. Free cancellation up to 2h before the appointment.',
    seeYou: 'See you soon!',
    bcp47: 'en-US',
  },
  ar: {
    subject: (salon) => `تأكيد موعدك — ${salon}`,
    greeting: (name) => `مرحباً ${name}،`,
    intro: (salon) => `تم تأكيد موعدك في ${salon}.`,
    recapHeader: 'ملخص الموعد',
    serviceLabel: 'الخدمة',
    barberLabel: 'مع',
    dateLabel: 'التاريخ',
    timeLabel: 'الوقت',
    addressLabel: 'العنوان',
    openProfileCta: 'حسابي',
    addToCalendarCta: 'إضافة إلى التقويم',
    cancelHint: 'لإلغاء الموعد أو تغييره، افتح حسابك الشخصي. الإلغاء مجاني حتى ساعتين قبل الموعد.',
    seeYou: 'إلى اللقاء قريباً!',
    bcp47: 'ar-EG',
  },
};

export interface NotifyBookingInput {
  tenantId: string;
  bookingId: string;
  clientPhone: string;
  serviceName: string;
  barberName: string;
  startsAtIso: string;
  durationMin: number;
}

export async function notifyClientOfNewBooking(input: NotifyBookingInput): Promise<void> {
  const apiKey = process.env['RESEND_API_KEY'];
  if (!apiKey || apiKey.length < 10) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // 1. Lookup tenant (nom, slug, locale, timezone, address)
  const tenantRes = await admin
    .from('tenants')
    .select('name, slug, locale, timezone')
    .eq('id', input.tenantId)
    .maybeSingle();
  const tenant = tenantRes.data as {
    name: string;
    slug: string;
    locale: string;
    timezone: string | null;
  } | null;
  if (!tenant) return;

  // 2. Lookup client email
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
  if (!profile?.email) return;

  // 3. Lookup settings (adresse postale pour le recap)
  const settingsRes = await admin
    .from('tenant_settings')
    .select('address_street, address_city, address_zip')
    
    .maybeSingle();
  const settings = settingsRes.data as {
    address_street: string | null;
    address_city: string | null;
    address_zip: string | null;
  } | null;
  const addressLine = [
    settings?.address_street,
    [settings?.address_zip, settings?.address_city].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');

  const locale: Locale =
    tenant.locale === 'fr' || tenant.locale === 'en' || tenant.locale === 'ar'
      ? (tenant.locale as Locale)
      : 'fr';
  const labels = LABELS[locale];
  const tz = tenant.timezone || 'UTC';

  const zoned = utcIsoToZonedParts(input.startsAtIso, tz);
  const dateLong = formatDateLong(input.startsAtIso, labels.bcp47, tz);

  const clientName =
    [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim() || profile.phone;

  // Token signe pour le lien « Mon espace » — 90j TTL.
  let openProfileUrl = '';
  try {
    const token = createClientToken(input.tenantId, profile.phone);
    // Single-tenant : l'espace client est servi par le sous-domaine booking
    // (plus de path-based slug ni de domaine System A).
    openProfileUrl = `${SALON.spaces.book}/client?t=${encodeURIComponent(token)}`;
  } catch {
    // Si CLIENT_TOKEN_SECRET absent (dev), on bypass le CTA — pas critique
    openProfileUrl = '';
  }

  const icsUrl = `${SALON.spaces.book}/client/booking/${input.bookingId}/ics`;

  const subject = labels.subject(tenant.name);

  const textLines = [
    labels.greeting(clientName),
    '',
    labels.intro(tenant.name),
    '',
    `${labels.recapHeader} :`,
    `  - ${labels.serviceLabel} : ${input.serviceName}`,
    `  - ${labels.barberLabel} : ${input.barberName}`,
    `  - ${labels.dateLabel} : ${dateLong}`,
    `  - ${labels.timeLabel} : ${zoned.time}`,
  ];
  if (addressLine) textLines.push(`  - ${labels.addressLabel} : ${addressLine}`);
  textLines.push('', labels.cancelHint, '');
  if (openProfileUrl) textLines.push(`${labels.openProfileCta} : ${openProfileUrl}`);
  textLines.push(`${labels.addToCalendarCta} : ${icsUrl}`);
  textLines.push('', labels.seeYou);
  const text = textLines.join('\n');

  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const html = `<!DOCTYPE html>
<html lang="${locale}" dir="${dir}">
<head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height:1.6; color:#222; max-width:560px; margin:0 auto; padding:24px;">
  <p>${escapeHtml(labels.greeting(clientName))}</p>
  <p>${escapeHtml(labels.intro(tenant.name))}</p>
  <div style="background:#f6f3ed; border:1px solid #e5dfd0; border-radius:8px; padding:16px; margin:18px 0;">
    <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.15em; color:#888; margin-bottom:10px;">${escapeHtml(labels.recapHeader)}</div>
    <div style="margin-bottom:6px;"><strong>${escapeHtml(labels.serviceLabel)} :</strong> ${escapeHtml(input.serviceName)}</div>
    <div style="margin-bottom:6px;"><strong>${escapeHtml(labels.barberLabel)} :</strong> ${escapeHtml(input.barberName)}</div>
    <div style="margin-bottom:6px;"><strong>${escapeHtml(labels.dateLabel)} :</strong> ${escapeHtml(dateLong)}</div>
    <div style="margin-bottom:6px;"><strong>${escapeHtml(labels.timeLabel)} :</strong> ${escapeHtml(zoned.time)}</div>
    ${addressLine ? `<div><strong>${escapeHtml(labels.addressLabel)} :</strong> ${escapeHtml(addressLine)}</div>` : ''}
  </div>
  <div style="margin:18px 0;">
    ${openProfileUrl ? `<a href="${openProfileUrl}" style="display:inline-block; background:#1a1714; color:#fff; padding:10px 18px; border-radius:8px; text-decoration:none; font-weight:600; margin-${dir === 'rtl' ? 'left' : 'right'}:10px;">${escapeHtml(labels.openProfileCta)}</a>` : ''}
    <a href="${icsUrl}" style="display:inline-block; background:#f4f3f0; color:#1a1714; padding:10px 18px; border-radius:8px; text-decoration:none; font-weight:600; border:1px solid #e5dfd0;">${escapeHtml(labels.addToCalendarCta)}</a>
  </div>
  <p style="font-size:13px; color:#555;">${escapeHtml(labels.cancelHint)}</p>
  <p style="margin-top:18px;">${escapeHtml(labels.seeYou)}</p>
</body>
</html>`;

  const fromHeader = await resolveFromHeader(input.tenantId, tenant.name);

  const resend = new Resend(apiKey);
  try {
    await resend.emails.send({
      from: fromHeader,
      to: profile.email,
      subject,
      text,
      html,
    });
  } catch (e) {
    reportError(e, {
      feature: 'booking-confirmation-email',
      tenantId: input.tenantId,
      bookingId: input.bookingId,
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
