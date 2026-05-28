'use server';

/**
 * Envoi d'email au client quand son RDV est annulé PAR LE SALON.
 *
 * Symétrique a `notifyClientOfNewBooking` — mais sens inverse. Cas d'usage :
 * la caissière clique « Annuler » sur un RDV upcoming (T5.9), ou le manager
 * annule depuis l'onglet Reservations. Le client a besoin d'etre prevenu
 * pour ne pas se deplacer pour rien.
 *
 * Composition :
 *  - Subject localise selon `tenants.locale`
 *  - Message d'excuse + invitation a reprendre un RDV en ligne
 *  - Lien direct vers /{slug}/client (avec token signe)
 *
 * Fire-and-forget : Resend down ou client_profiles.email NULL → silencieux.
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
    intro: (salon: string, dateLong: string, time: string) => string;
    apology: string;
    rebookCta: string;
    seeYou: string;
    bcp47: string;
  }
> = {
  fr: {
    subject: (salon) => `Votre RDV a été annulé — ${salon}`,
    greeting: (name) => `Bonjour ${name},`,
    intro: (salon, dateLong, time) =>
      `Nous sommes désolés de devoir annuler votre rendez-vous chez ${salon} prévu le ${dateLong} à ${time}.`,
    apology:
      "Nous comprenons que c'est gênant. N'hésitez pas à reprendre un rendez-vous à un autre créneau — nous serons heureux de vous accueillir.",
    rebookCta: 'Reprendre un RDV',
    seeYou: 'À très bientôt !',
    bcp47: 'fr-FR',
  },
  en: {
    subject: (salon) => `Your booking has been cancelled — ${salon}`,
    greeting: (name) => `Hello ${name},`,
    intro: (salon, dateLong, time) =>
      `We're sorry to cancel your appointment at ${salon} on ${dateLong} at ${time}.`,
    apology:
      "We understand this is inconvenient. Please feel free to book another time slot — we'd be happy to welcome you.",
    rebookCta: 'Book again',
    seeYou: 'See you soon!',
    bcp47: 'en-US',
  },
  ar: {
    subject: (salon) => `تم إلغاء موعدك — ${salon}`,
    greeting: (name) => `مرحباً ${name}،`,
    intro: (salon, dateLong, time) =>
      `نأسف لإلغاء موعدك في ${salon} يوم ${dateLong} الساعة ${time}.`,
    apology: 'نتفهّم أن هذا غير ملائم. يمكنك حجز موعد آخر، وسنكون سعداء باستقبالك.',
    rebookCta: 'حجز موعد جديد',
    seeYou: 'إلى اللقاء قريباً!',
    bcp47: 'ar-EG',
  },
};

export interface NotifyCancellationInput {
  tenantId: string;
  bookingId: string;
}

export async function notifyClientOfCancellation(input: NotifyCancellationInput): Promise<void> {
  const apiKey = process.env['RESEND_API_KEY'];
  if (!apiKey || apiKey.length < 10) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // 1. Lookup booking + tenant + profile en parallèle
  const [bookingRes, tenantRes] = await Promise.all([
    admin
      .from('bookings')
      .select('id, starts_at, client_phone')
      .eq('id', input.bookingId)
      
      .maybeSingle(),
    admin
      .from('tenants')
      .select('name, slug, locale, timezone')
      .eq('id', input.tenantId)
      .maybeSingle(),
  ]);

  const booking = bookingRes.data as {
    id: string;
    starts_at: string;
    client_phone: string | null;
  } | null;
  const tenant = tenantRes.data as {
    name: string;
    slug: string;
    locale: string;
    timezone: string | null;
  } | null;
  if (!booking || !tenant || !booking.client_phone) return;

  const profileRes = await admin
    .from('client_profiles')
    .select('phone, first_name, last_name, email')
    
    .eq('phone', booking.client_phone)
    .maybeSingle();
  const profile = profileRes.data as {
    phone: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
  if (!profile?.email) return;

  const locale: Locale =
    tenant.locale === 'fr' || tenant.locale === 'en' || tenant.locale === 'ar'
      ? (tenant.locale as Locale)
      : 'fr';
  const labels = LABELS[locale];
  const tz = tenant.timezone || 'UTC';

  const zoned = utcIsoToZonedParts(booking.starts_at, tz);
  const dateLong = formatDateLong(booking.starts_at, labels.bcp47, tz);

  const clientName =
    [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim() || profile.phone;

  // Lien « Reprendre un RDV » avec token signé
  let rebookUrl = '';
  try {
    const token = createClientToken(input.tenantId, profile.phone);
    rebookUrl = `${SALON.spaces.book}/client?t=${encodeURIComponent(token)}&tab=book`;
  } catch {
    rebookUrl = '';
  }

  const subject = labels.subject(tenant.name);
  const introText = labels.intro(tenant.name, dateLong, zoned.time);

  const textLines = [labels.greeting(clientName), '', introText, '', labels.apology];
  if (rebookUrl) textLines.push('', `${labels.rebookCta} : ${rebookUrl}`);
  textLines.push('', labels.seeYou);
  const text = textLines.join('\n');

  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const html = `<!DOCTYPE html>
<html lang="${locale}" dir="${dir}">
<head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height:1.6; color:#222; max-width:560px; margin:0 auto; padding:24px;">
  <p>${escapeHtml(labels.greeting(clientName))}</p>
  <p>${escapeHtml(introText)}</p>
  <p style="color:#555;">${escapeHtml(labels.apology)}</p>
  ${
    rebookUrl
      ? `<div style="margin:24px 0;"><a href="${rebookUrl}" style="display:inline-block; background:#1a1714; color:#fff; padding:12px 20px; border-radius:8px; text-decoration:none; font-weight:600;">${escapeHtml(labels.rebookCta)}</a></div>`
      : ''
  }
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
      feature: 'cancel-email',
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
