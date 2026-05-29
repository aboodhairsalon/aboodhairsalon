'use server';

/**
 * Server actions pour la gestion des RDV CLIENT (côté espace public de
 * réservation) — création AILLEURS (`booking-public-action.ts`), ici on
 * couvre :
 *   - getClientBookings    : liste des RDV d'un client (Mes RDV)
 *   - cancelClientBooking  : annulation d'un RDV par son propriétaire
 *   - getTakenSlots        : créneaux déjà occupés par un barbier à une date
 *
 * SÉCURITÉ — Les 3 actions prennent `tenantId` depuis les headers middleware
 * (jamais depuis l'input client). Pour les lookup par phone (Mes RDV, cancel),
 * un token magic-link signé HMAC pourrait être ajouté ici pour bloquer les
 * énumérations cross-client — au minimum, les rate-limit IP/phone Upstash
 * existants couvrent l'attaque opportuniste.
 *
 * Ce fichier comble les bugs P0 remontés par l'audit pre-launch 2026-05-23 :
 *   - « Mes RDV » jamais chargé depuis la DB (state local vide pour tenant connecté)
 *   - cancelBooking était local-only (mensonge à l'utilisateur + slot reste bloqué)
 *   - takenSlots ignore les RDV serveur → double-booking systématique
 */

import { headers } from 'next/headers';
import { createAdminClient } from '@/db';
import { SALON } from '@/config/salon';
import { rlSalesIp, rlSalesPhone } from '../_lib/rate-limit';
import { sendPushToTenant } from '../manager/push-actions';
import { getAuthedClientPhone } from './client-session';

// ─── Types partagés ──────────────────────────────────────────────────────────

export interface ClientBookingRow {
  id: string;
  date: string; // YYYY-MM-DD (local au TZ du tenant)
  time: string; // HH:mm
  status: 'upcoming' | 'in_chair' | 'done' | 'cancelled' | 'no_show';
  paid: boolean;
  amountCents: number;
  serviceId: string | null;
  barberId: string | null;
  clientName: string;
}

export type ClientBookingsResult =
  | { ok: true; bookings: ClientBookingRow[] }
  | { ok: false; errorKey: string; errorValues?: Record<string, string | number> };

export type CancelBookingResult =
  | { ok: true }
  | { ok: false; errorKey: string; errorValues?: Record<string, string | number> };

export type TakenSlotsResult = { ok: true; takenTimes: string[] } | { ok: false; errorKey: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown';
}

/** Extrait HH:mm + YYYY-MM-DD d'un timestamp UTC selon le TZ tenant.
 *  Retombe sur le format JS par défaut si le TZ est invalide. */
function formatLocalDateTime(
  startsAtUtc: string,
  timezone: string | null,
): { date: string; time: string } {
  try {
    const d = new Date(startsAtUtc);
    const tz = timezone ?? 'UTC';
    // Intl pour extraire les composants dans le TZ cible.
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
    return {
      date: `${parts['year']}-${parts['month']}-${parts['day']}`,
      time: `${parts['hour'] === '24' ? '00' : parts['hour']}:${parts['minute']}`,
    };
  } catch {
    // Fallback UTC.
    const d = new Date(startsAtUtc);
    return {
      date: d.toISOString().slice(0, 10),
      time: d.toISOString().slice(11, 16),
    };
  }
}

// ─── Action : liste des RDV du client ────────────────────────────────────────

/**
 * Récupère les RDV d'un client (identifié par téléphone) pour le tenant courant.
 *
 * - Retourne TOUS les statuts (upcoming, in_chair, done, cancelled, no_show)
 *   sur les 90 derniers jours + tous les futurs — l'UI Mes RDV filtre côté
 *   client pour les onglets « À venir » / « Passés ».
 * - Rate-limited par phone (10/min) + IP (30/min) — symétrique à getClientSales.
 */
export async function getClientBookings(
  tenantIdInput: string,
  phone: string,
): Promise<ClientBookingsResult> {
  // Single-tenant : tenant = constante SALON.tenantUuid (le middleware de ce
  // fork ne pose plus de header x-tenant-id ; `tenantIdInput` est gardé pour la
  // compat des call-sites mais n'est plus utilisé).
  const tenantId = SALON.tenantUuid;

  // 🔒 Source de vérité : le téléphone vient du COOKIE de session vérifié,
  // jamais du paramètre reçu (forgeable). Le paramètre est ignoré.
  const authedPhone = await getAuthedClientPhone();
  if (!authedPhone) return { ok: false, errorKey: 'authRequired' };
  void phone;
  const trimmedPhone = authedPhone;

  const ip = await clientIp();
  if (!(await rlSalesPhone(tenantId, trimmedPhone))) {
    return { ok: false, errorKey: 'rateLimited' };
  }
  if (!(await rlSalesIp(tenantId, ip))) {
    return { ok: false, errorKey: 'rateLimited' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Récupère le timezone du tenant pour formater les dates locales.
  const tenantRow = await admin.from('tenants').select('timezone').eq('id', tenantId).maybeSingle();
  const tz = (tenantRow.data as { timezone?: string } | null)?.timezone ?? 'UTC';

  // Borne basse : 90 derniers jours (couvre l'historique « Passés ») ; pas
  // de borne haute (tous les RDV futurs visibles).
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setUTCDate(ninetyDaysAgo.getUTCDate() - 90);

  const { data, error } = await admin
    .from('bookings')
    .select(
      // BUG fix 2026-05-24 : `client_name` n'existe pas sur la table bookings
      // — seulement `client_display_name`. L'ancien SELECT renvoyait une 400
      // « column does not exist » → `r.ok=false` → UI silencieuse → « Mes RDV »
      // affichait « Aucun RDV » pour TOUS les clients du tenant. Confirmé
      // en DB live (cf. docs/audits/2026-05-24-audit-chirurgical.md T1.1).
      'id, starts_at, status, paid, amount_cents, service_id, barber_id, client_display_name, client_phone',
    )
    
    .eq('tenant_id', tenantId)
    .eq('client_phone', trimmedPhone)
    .gte('starts_at', ninetyDaysAgo.toISOString())
    .order('starts_at', { ascending: false })
    .limit(100);

  if (error) {
    return { ok: false, errorKey: 'dbError', errorValues: { message: error.message } };
  }

  const bookings: ClientBookingRow[] = (data ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (b: any) => {
      const { date, time } = formatLocalDateTime(b.starts_at, tz);
      return {
        id: b.id,
        date,
        time,
        status: b.status,
        paid: Boolean(b.paid),
        amountCents: Number(b.amount_cents ?? 0),
        serviceId: b.service_id,
        barberId: b.barber_id,
        clientName: b.client_display_name ?? '',
      };
    },
  );

  return { ok: true, bookings };
}

// ─── Action : annulation d'un RDV par son propriétaire ───────────────────────

/**
 * Annule un RDV pour le compte du client identifié par son téléphone.
 *
 * - Triple garde : tenant_id (header) + booking.id (input) + client_phone == phone (WHERE).
 * - Idempotent : UPDATE WHERE status='upcoming' — si déjà annulé/passé, no-op.
 * - Limite à 24h avant le RDV (les annulations « last-minute » doivent passer
 *   par téléphone au salon — fairness pour le barbier).
 */
export async function cancelClientBooking(
  tenantIdInput: string,
  phone: string,
  bookingId: string,
): Promise<CancelBookingResult> {
  // Single-tenant : tenant = constante SALON.tenantUuid (plus de header x-tenant-id).
  const tenantId = SALON.tenantUuid;

  // 🔒 Source de vérité : le téléphone vient du COOKIE de session vérifié,
  // jamais du paramètre reçu (forgeable). Le paramètre est ignoré.
  const authedPhone = await getAuthedClientPhone();
  if (!authedPhone) return { ok: false, errorKey: 'authRequired' };
  void phone;
  const trimmedPhone = authedPhone;

  // Rate-limit (anti-spam annulations).
  const ip = await clientIp();
  if (!(await rlSalesPhone(tenantId, trimmedPhone))) {
    return { ok: false, errorKey: 'rateLimited' };
  }
  if (!(await rlSalesIp(tenantId, ip))) {
    return { ok: false, errorKey: 'rateLimited' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // SELECT du RDV pour vérifier ownership + statut + bornes temporelles.
  const { data: booking, error: fetchErr } = await admin
    .from('bookings')
    .select('id, status, starts_at, client_phone, tenant_id')
    .eq('id', bookingId)
    .eq('tenant_id', tenantId)
    
    .maybeSingle();

  if (fetchErr) {
    return { ok: false, errorKey: 'dbError', errorValues: { message: fetchErr.message } };
  }
  if (!booking) {
    return { ok: false, errorKey: 'bookingNotFound' };
  }
  if (booking.client_phone !== trimmedPhone) {
    // On retourne `bookingNotFound` plutôt que `forbidden` pour ne pas leak
    // l'existence du booking à un attaquant.
    return { ok: false, errorKey: 'bookingNotFound' };
  }
  if (booking.status !== 'upcoming') {
    return { ok: false, errorKey: 'bookingNotCancellable' };
  }
  const startsAt = new Date(booking.starts_at);
  const now = new Date();
  const msUntilStart = startsAt.getTime() - now.getTime();
  // Anti last-minute : refuse si <2h (au lieu du 24h initialement prévu — UX
  // plus permissive pour le client, le salon peut toujours noter no_show).
  if (msUntilStart < 2 * 3600 * 1000) {
    return { ok: false, errorKey: 'bookingTooSoonToCancel' };
  }

  // UPDATE atomique : WHERE status='upcoming' garantit qu'on n'écrase pas
  // un statut déjà transitionné côté caisse (in_chair, done).
  const { error: updateErr } = await admin
    .from('bookings')
    .update({ status: 'cancelled' })
    .eq('id', bookingId)
    .eq('tenant_id', tenantId)
    
    .eq('client_phone', trimmedPhone)
    .eq('status', 'upcoming');

  if (updateErr) {
    return { ok: false, errorKey: 'dbError', errorValues: { message: updateErr.message } };
  }

  // Notification push au manager : le salon doit savoir immédiatement
  // qu'un slot vient de se libérer (pour replanifier walk-in, contacter
  // une liste d'attente, ou simplement éviter d'attendre un client qui
  // ne viendra plus). Best-effort : pas de VAPID ou pas de souscription
  // manager → silencieux.
  void (async () => {
    try {
      const tenantRowForLocale = await admin
        .from('tenants')
        .select('locale')
        .eq('id', tenantId)
        .maybeSingle();
      const tLocale = (tenantRowForLocale.data as { locale?: string } | null)?.locale ?? 'fr';
      const locale: 'fr' | 'en' | 'ar' = tLocale === 'ar' || tLocale === 'en' ? tLocale : 'fr';
      const labels = {
        fr: { title: 'RDV annulé', body: "Un client vient d'annuler un rendez-vous." },
        en: { title: 'Booking cancelled', body: 'A client just cancelled an appointment.' },
        ar: { title: 'إلغاء موعد', body: 'قام عميل بإلغاء موعده للتو.' },
      }[locale];
      await sendPushToTenant(
        tenantId,
        {
          title: labels.title,
          body: labels.body,
          url: '/manager?tab=reserv',
          tag: 'booking-cancelled',
        },
        { role: 'manager' },
      );
      // Idem côté caisse — le poste en salle voit l'annulation immédiatement.
      await sendPushToTenant(
        tenantId,
        {
          title: labels.title,
          body: labels.body,
          url: '/cashier',
          tag: 'booking-cancelled',
        },
        { role: 'cashier' },
      );
    } catch {
      // best-effort
    }
  })();

  return { ok: true };
}

// ─── Action : créneaux occupés ───────────────────────────────────────────────

/**
 * Liste les heures (HH:mm) déjà prises par un barbier à une date donnée.
 *
 * - Public-safe : utilise admin client + .eq('tenant_id') manuel.
 * - Date au format YYYY-MM-DD interprétée dans le TZ du tenant.
 * - Retourne uniquement les statuts qui bloquent un créneau (upcoming,
 *   in_chair, done) — les `cancelled` et `no_show` libèrent le créneau.
 * - Pas de rate-limit (lecture publique courante, info non-sensible).
 */
export async function getTakenSlots(
  tenantIdInput: string,
  barberId: string,
  date: string,
): Promise<TakenSlotsResult> {
  // Single-tenant : tenant = constante SALON.tenantUuid (plus de header x-tenant-id).
  const tenantId = SALON.tenantUuid;

  if (!/^[0-9a-f-]{36}$/i.test(barberId)) {
    return { ok: false, errorKey: 'invalidBarber' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, errorKey: 'invalidDate' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Récupère le TZ pour borner la journée.
  const tenantRow = await admin.from('tenants').select('timezone').eq('id', tenantId).maybeSingle();
  const tz = (tenantRow.data as { timezone?: string } | null)?.timezone ?? 'UTC';

  // Borne la journée locale [00:00, 24:00] → en UTC pour le SELECT.
  // Approximation : on prend une fenêtre [date-1d, date+1d] et on filtre
  // ensuite avec Intl. Plus simple et robuste qu'un calcul d'offset.
  const dayStart = new Date(`${date}T00:00:00Z`);
  const wideStart = new Date(dayStart.getTime() - 24 * 3600 * 1000);
  const wideEnd = new Date(dayStart.getTime() + 48 * 3600 * 1000);

  const { data, error } = await admin
    .from('bookings')
    .select('starts_at, ends_at, status')
    
    .eq('tenant_id', tenantId)
    .eq('barber_id', barberId)
    .in('status', ['upcoming', 'in_chair', 'done'])
    .gte('starts_at', wideStart.toISOString())
    .lt('starts_at', wideEnd.toISOString());

  if (error) {
    return { ok: false, errorKey: 'dbError' };
  }

  // Marque TOUS les créneaux 30 min couverts par chaque RDV existant (pas
  // seulement le starts_at). Sans ça, un RDV à 10h00 d'une heure ne bloquait
  // que 10h00 et le slot 10h30 apparaissait libre → conflit au submit via
  // la contrainte `bookings_no_overlap` côté DB → frustration client.
  // Audit T2.1.
  const SLOT_MINUTES = 30;
  const takenTimes = new Set<string>();
  for (const row of data ?? []) {
    const r = row as { starts_at: string; ends_at: string | null };
    const startsMs = new Date(r.starts_at).getTime();
    const endsMs = r.ends_at ? new Date(r.ends_at).getTime() : startsMs + SLOT_MINUTES * 60_000;
    for (let t = startsMs; t < endsMs; t += SLOT_MINUTES * 60_000) {
      const slotDate = new Date(t).toISOString();
      const { date: localDate, time: localTime } = formatLocalDateTime(slotDate, tz);
      if (localDate === date) {
        takenTimes.add(localTime);
      }
    }
  }

  return { ok: true, takenTimes: Array.from(takenTimes) };
}
