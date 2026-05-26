/**
 * Cron job quotidien — rappels J-1 par email pour les RDV du lendemain.
 *
 * Déclenché par Vercel Cron (configuré dans vercel.json) à 18h UTC chaque
 * jour, ce qui correspond à ~20h Paris / 21h Le Caire — heure raisonnable
 * pour les rappels (le client est rentré chez lui mais pas couché).
 *
 * Algorithme :
 *  1. Query bookings status='upcoming' avec starts_at dans [J+1 00:00, J+2 00:00]
 *     du timezone de chaque tenant — donc on group par tenant.
 *  2. Pour chaque booking, on récupère email du client (via client_profiles.email
 *     OU client_phone si pas de profile).
 *  3. Envoi via Resend avec template HTML + texte localisé (locale du tenant).
 *  4. Tracking : ajout d'une colonne `reminder_sent_at` côté bookings pour
 *     éviter les doublons en cas de cron qui rejoue. Mais pour MVP on accepte
 *     que le cron fasse un double envoi rare (Resend dédup par messageId).
 *
 * Sécurité : la route exige le header `Authorization: Bearer ${CRON_SECRET}`.
 * Vercel Cron envoie automatiquement ce header si la variable d'env est set.
 * Sans le header (ex. quelqu'un qui scrape l'URL), 401.
 *
 * Limites MVP :
 *  - Email only (pas de WhatsApp/SMS — voir TODO Twilio plus tard)
 *  - Pas de dédup multi-run (idempotence à ajouter avec reminder_sent_at)
 *  - Template inline simple (pas de React Email pour rester rapide)
 */
import { headers } from 'next/headers';
import { createAdminClient } from '@/db';
import { Resend } from 'resend';
import { resolveFromHeader } from '../../../_lib/email-sender';
import {
  utcIsoToZonedParts,
  formatDateLong,
  fallbackTimezoneFromLocale,
} from '../../../_lib/timezone';

export const dynamic = 'force-dynamic';
// Limite Vercel : 60 s pour les routes Edge, 300 s pour Node (default).
// On laisse default (Node runtime) car Resend SDK + nombreux envois.
export const maxDuration = 60;

interface BookingRow {
  id: string;
  tenant_id: string;
  client_phone: string | null;
  client_display_name: string | null;
  starts_at: string;
  ends_at: string;
  services: { name: string } | null;
  staff: { name: string } | null;
  tenants: { name: string; slug: string; locale: string; timezone: string | null } | null;
}

interface ProfileRow {
  phone: string;
  email: string | null;
}

/** Templates email J-1 par locale du tenant. Inline pour rester simple —
 *  React Email serait overkill pour 3 paragraphes statiques. */
const TEMPLATES: Record<
  'fr' | 'en' | 'ar',
  (vars: {
    salonName: string;
    serviceName: string;
    barberName: string;
    dateLong: string;
    time: string;
    clientName: string;
  }) => { subject: string; text: string; html: string }
> = {
  fr: ({ salonName, serviceName, barberName, dateLong, time, clientName }) => ({
    subject: `Rappel : votre rendez-vous demain chez ${salonName}`,
    text: `Bonjour ${clientName},

Petit rappel : votre rendez-vous est prévu DEMAIN.

  ${serviceName}${barberName ? ` avec ${barberName}` : ''}
  ${dateLong} à ${time}
  ${salonName}

À très bientôt !`,
    html: `<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #18160F;">
  <p style="font-size: 14px; color: #8A8478; margin: 0 0 8px;">Bonjour ${clientName},</p>
  <h1 style="font-size: 22px; font-weight: 600; margin: 0 0 24px;">Votre rendez-vous est demain.</h1>
  <div style="background: #F4F3F0; border-radius: 16px; padding: 20px; margin: 0 0 24px;">
    <div style="font-size: 18px; font-weight: 600; margin-bottom: 6px;">${serviceName}</div>
    ${barberName ? `<div style="font-size: 14px; color: #5A554C;">avec ${barberName}</div>` : ''}
    <div style="font-size: 14px; color: #5A554C; margin-top: 12px;">${dateLong}<br>à ${time}</div>
    <div style="font-size: 13px; color: #8A8478; margin-top: 12px;">${salonName}</div>
  </div>
  <p style="font-size: 13px; color: #8A8478;">À très bientôt !</p>
</div>`,
  }),
  en: ({ salonName, serviceName, barberName, dateLong, time, clientName }) => ({
    subject: `Reminder: your appointment tomorrow at ${salonName}`,
    text: `Hello ${clientName},

Quick reminder: your appointment is TOMORROW.

  ${serviceName}${barberName ? ` with ${barberName}` : ''}
  ${dateLong} at ${time}
  ${salonName}

See you soon!`,
    html: `<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #18160F;">
  <p style="font-size: 14px; color: #8A8478; margin: 0 0 8px;">Hello ${clientName},</p>
  <h1 style="font-size: 22px; font-weight: 600; margin: 0 0 24px;">Your appointment is tomorrow.</h1>
  <div style="background: #F4F3F0; border-radius: 16px; padding: 20px; margin: 0 0 24px;">
    <div style="font-size: 18px; font-weight: 600; margin-bottom: 6px;">${serviceName}</div>
    ${barberName ? `<div style="font-size: 14px; color: #5A554C;">with ${barberName}</div>` : ''}
    <div style="font-size: 14px; color: #5A554C; margin-top: 12px;">${dateLong}<br>at ${time}</div>
    <div style="font-size: 13px; color: #8A8478; margin-top: 12px;">${salonName}</div>
  </div>
  <p style="font-size: 13px; color: #8A8478;">See you soon!</p>
</div>`,
  }),
  ar: ({ salonName, serviceName, barberName, dateLong, time, clientName }) => ({
    subject: `تذكير: موعدك غدًا في ${salonName}`,
    text: `مرحبًا ${clientName}،

تذكير سريع: موعدك غدًا.

  ${serviceName}${barberName ? ` مع ${barberName}` : ''}
  ${dateLong} الساعة ${time}
  ${salonName}

إلى اللقاء!`,
    html: `<div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #18160F; direction: rtl; text-align: right;">
  <p style="font-size: 14px; color: #8A8478; margin: 0 0 8px;">مرحبًا ${clientName}،</p>
  <h1 style="font-size: 22px; font-weight: 600; margin: 0 0 24px;">موعدك غدًا.</h1>
  <div style="background: #F4F3F0; border-radius: 16px; padding: 20px; margin: 0 0 24px;">
    <div style="font-size: 18px; font-weight: 600; margin-bottom: 6px;">${serviceName}</div>
    ${barberName ? `<div style="font-size: 14px; color: #5A554C;">مع ${barberName}</div>` : ''}
    <div style="font-size: 14px; color: #5A554C; margin-top: 12px;">${dateLong}<br>الساعة ${time}</div>
    <div style="font-size: 13px; color: #8A8478; margin-top: 12px;">${salonName}</div>
  </div>
  <p style="font-size: 13px; color: #8A8478;">إلى اللقاء!</p>
</div>`,
  }),
};

function pickLocale(localeRaw: string | null | undefined): 'fr' | 'en' | 'ar' {
  if (!localeRaw) return 'fr';
  const head = localeRaw.toLowerCase().slice(0, 2);
  return head === 'en' || head === 'ar' ? head : 'fr';
}

export async function GET(): Promise<Response> {
  // Auth : Vercel Cron envoie automatiquement `Authorization: Bearer ${CRON_SECRET}`.
  // Cette env var DOIT être configurée côté Vercel (Settings → Environment Variables).
  const h = await headers();
  const auth = h.get('authorization');
  const cronSecret = process.env['CRON_SECRET'];
  if (!cronSecret) {
    return new Response('Cron secret not configured', { status: 503 });
  }
  if (auth !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const resendKey = process.env['RESEND_API_KEY'];
  if (!resendKey) {
    return new Response('RESEND_API_KEY missing', { status: 503 });
  }
  const resend = new Resend(resendKey);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Fenêtre temporelle UTC : demain entre 00:00 et 23:59:59. Note : on
  // travaille en UTC ici parce que les RDV sont stockés en UTC ; le tenant
  // timezone n'intervient que pour formatter la date dans l'email.
  const now = new Date();
  const tomorrowStart = new Date(now);
  tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1);
  tomorrowStart.setUTCHours(0, 0, 0, 0);
  const dayAfterStart = new Date(tomorrowStart);
  dayAfterStart.setUTCDate(dayAfterStart.getUTCDate() + 1);

  // Query : bookings upcoming avec starts_at dans la fenêtre demain.
  // Joins pour récupérer service + barber + tenant en une seule round-trip.
  //
  // IDEMPOTENCE (audit pre-launch 2026-05-23) : on filtre `reminder_sent_at IS NULL`
  // pour éviter qu'un retry Vercel (timeout réseau, redeploy, manual run)
  // envoie 2-3 emails identiques au même client → spam complaints → Resend
  // blacklist le domaine. CRITIQUE avant lancement marketing.
  const bookingsRes = await admin
    .from('bookings')
    .select(
      'id, tenant_id, client_phone, client_display_name, starts_at, ends_at, ' +
        'services(name), staff(name), tenants(name, slug, locale, timezone)',
    )
    .eq('status', 'upcoming')
    .is('reminder_sent_at', null)
    .gte('starts_at', tomorrowStart.toISOString())
    .lt('starts_at', dayAfterStart.toISOString());

  if (bookingsRes.error) {
    return Response.json({ ok: false, error: bookingsRes.error.message }, { status: 500 });
  }
  const bookings = (bookingsRes.data as BookingRow[]) ?? [];
  if (bookings.length === 0) {
    return Response.json({ ok: true, sent: 0, skipped: 0, message: 'No bookings tomorrow' });
  }

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const booking of bookings) {
    if (!booking.client_phone || !booking.tenants) {
      skipped++;
      continue;
    }

    // Récup email du client via client_profiles
    const profileRes = await admin
      .from('client_profiles')
      .select('phone, email')
      
      .eq('phone', booking.client_phone)
      .maybeSingle();

    const email = (profileRes.data as ProfileRow | null)?.email;
    if (!email) {
      skipped++;
      continue;
    }

    const tenant = booking.tenants;
    const tz = tenant.timezone || fallbackTimezoneFromLocale(tenant.locale);
    const { time } = utcIsoToZonedParts(booking.starts_at, tz);
    const bcp47 =
      tenant.locale === 'ar-EG' ? 'ar-EG' : tenant.locale?.startsWith('en') ? 'en-US' : 'fr-FR';
    const dateLong = formatDateLong(booking.starts_at, bcp47, tz);
    const locale = pickLocale(tenant.locale);
    const template = TEMPLATES[locale];
    const { subject, text, html } = template({
      salonName: tenant.name,
      serviceName: booking.services?.name ?? 'Rendez-vous',
      barberName: booking.staff?.name ?? '',
      dateLong,
      time,
      clientName: booking.client_display_name?.split(' ')[0] ?? '',
    });

    // Sender per-tenant : `tenant_settings.email_from_address` si configuré
    // (ex. noreply@aboodhairsalon.com), sinon fallback RESEND_FROM_EMAIL.
    // Le domaine choisi DOIT être vérifié dans Resend (DKIM/SPF/DMARC).
    const fromHeader = await resolveFromHeader(booking.tenant_id, tenant.name);
    try {
      const sendRes = await resend.emails.send({
        from: fromHeader,
        to: [email],
        subject,
        text,
        html,
        // Tag pour analytics Resend (filtrer les reminders dans le dashboard)
        tags: [{ name: 'type', value: 'booking-reminder' }],
      });
      if (sendRes.error) {
        errors.push(`${booking.id}: ${sendRes.error.message}`);
        skipped++;
      } else {
        // IDEMPOTENCE : on marque le rappel comme envoyé en DB pour bloquer
        // les retries du cron. UPDATE atomique avec WHERE id pour ne pas
        // toucher un autre booking en cas de race théorique.
        const { error: updateErr } = await admin
          .from('bookings')
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', booking.id);
        if (updateErr) {
          // L'email est parti mais le flag n'a pas pu être posé. Au prochain
          // run le rappel serait renvoyé. On log mais ne crashe pas — un
          // double email est moins grave qu'un email manquant.
          errors.push(
            `${booking.id}: sent OK but UPDATE reminder_sent_at failed: ${updateErr.message}`,
          );
        }
        sent++;
      }
    } catch (e) {
      errors.push(`${booking.id}: ${(e as Error).message}`);
      skipped++;
    }
  }

  return Response.json({
    ok: true,
    total: bookings.length,
    sent,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
  });
}
