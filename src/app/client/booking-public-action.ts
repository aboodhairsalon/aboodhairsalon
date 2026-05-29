'use server';
/**
 * Server Action publique pour créer une réservation depuis /client.
 *
 * Contrairement à `createBooking` dans /manager/booking-actions, cette action
 * n'exige pas de session Supabase Auth. En single-tenant, le tenant_id est la
 * constante `SALON.tenantUuid` (plus de header x-tenant-id ni de middleware
 * multi-tenant dans ce fork).
 *
 * Durcissement audit (sécurité publique) :
 *  1. Validation Zod stricte sur tous les inputs (UUID services/barber,
 *     bornes durée/montant, longueur du nom client, format date/heure).
 *  2. Pré-check tenant : on vérifie que `service_id` ET `barber_id` appartiennent
 *     bien à `SALON.tenantUuid` avant l'insert — sinon un client malicieux
 *     pouvait poster un UUID hors-périmètre et créer une réservation avec
 *     des refs croisées (la FK n'est pas composite côté DB).
 *  3. Nettoyage des caractères de contrôle dans `clientName` — pas de XSS
 *     possible (le champ est rendu via React qui échappe), mais on retire les
 *     overrides RTL Unicode pour éviter les noms d'affichage trompeurs.
 *  4. Payload push localisé selon `tenants.locale` (FR/EN/AR) — plus de
 *     « Nouvelle réservation » hardcodé.
 */
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient } from '@/db';
import { SALON } from '@/config/salon';
import type { BookingErrorCode, BookingErrorValues } from '../manager/booking-actions';
import { sendPushToTenant } from '../manager/push-actions';
import { rlBookingIp } from '../_lib/rate-limit';
import { fallbackTimezoneFromLocale, zonedToUtcIso } from '../_lib/timezone';
import { notifyClientOfNewBooking } from './booking-email';

export type PublicBookingErrorCode =
  | BookingErrorCode
  | 'tenantMissing'
  | 'serviceMismatch'
  | 'barberMismatch'
  | 'phoneRequired'
  | 'emailRequired'
  | 'invalidEmail'
  | 'dobRequired'
  | 'dobInvalid'
  | 'dateOutOfRange';

export type MutationResult =
  | { ok: true; id?: string }
  | { ok: false; errorKey: PublicBookingErrorCode; errorValues?: BookingErrorValues };

/** Strip ASCII control chars (U+0000–U+001F) + bidi overrides (U+202A–U+202E)
 *  d'une chaîne user-input. Empêche les noms d'affichage trompeurs dans les
 *  notifications système, les listings et les exports CSV/PDF. */
function sanitizeDisplay(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x1F?-?]/g, '');
}

/** Schéma de validation des inputs publics — bornes serrées pour empêcher
 *  les abus (durations énormes, montants négatifs, etc.).
 *
 *  ⚠️ Téléphone ET email sont OBLIGATOIRES depuis le durcissement « inscription
 *  obligatoire » : on n'accepte plus de RDV anonyme. Cela permet :
 *    - Confirmation par email / WhatsApp
 *    - Rappels J-1 / rappel d'avis post-visite
 *    - Programme fidélité unifié sous une identité stable
 *    - Lutte anti-noshow (on peut contacter le client)
 */
const CreateBookingPublicSchema = z.object({
  clientName: z.string().trim().min(1).max(120).transform(sanitizeDisplay),
  serviceId: z.string().uuid(),
  barberId: z.string().uuid(),
  // Date du RDV — format YYYY-MM-DD + borne ENTRE aujourd'hui et J+90.
  // Sans borne, un bot peut polluer le calendrier 100 ans dans le futur
  // (visible dans le KPI manager + slots fantômes). Limite à 90j = horizon
  // raisonnable de réservation salon, suffisant pour les vacances.
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'invalidData')
    .refine((s) => {
      const d = new Date(s + 'T00:00:00Z');
      if (Number.isNaN(d.getTime())) return false;
      const todayUtc = new Date();
      todayUtc.setUTCHours(0, 0, 0, 0);
      const maxDate = new Date(todayUtc);
      maxDate.setUTCDate(maxDate.getUTCDate() + 90);
      return d >= todayUtc && d <= maxDate;
    }, 'dateOutOfRange'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'invalidData'),
  durationMin: z.number().int().min(5).max(480),
  amountCents: z.number().int().min(0).max(10_000_000),
  // Téléphone OBLIGATOIRE — autorise +/0–9/espaces/parenthèses/tirets uniquement.
  // La regex empêche le contenu trompeur (HTML-like, overrides bidi) qui
  // souillait le matching wa.me / client_profiles côté UI.
  clientPhone: z
    .string()
    .trim()
    .min(6, 'phoneRequired')
    .max(40)
    .regex(/^[+\d\s().-]+$/, 'invalidData'),
  // Email OBLIGATOIRE — validation RFC permissive (z.string().email() refuse
  // les TLD inconnus, on garde une regex plus large + bornage longueur).
  clientEmail: z
    .string()
    .trim()
    .toLowerCase()
    .min(5, 'emailRequired')
    .max(120)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'invalidEmail'),
  // Nom du barbier — optionnel mais utilisé pour personnaliser les emails de
  // confirmation. Si absent, on retombe sur le nom prénom + prénom du profil.
  clientFirstName: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => v || undefined),
  clientLastName: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => v || undefined),
  // Date de naissance OBLIGATOIRE — permet l'envoi automatique d'un cadeau
  // anniversaire (widget Birthdays côté manager + email + WhatsApp). Sans
  // DOB on perd un canal de fidélisation important.
  // Format YYYY-MM-DD (input type=date côté UI).
  clientDateOfBirth: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'dobRequired')
    // Sanity check : pas dans le futur, pas avant 1900 (typo type 0202).
    .refine((s) => {
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return false;
      const now = new Date();
      return d <= now && d.getFullYear() >= 1900;
    }, 'dobInvalid'),
});

export interface CreateBookingInput {
  clientName: string;
  serviceId: string;
  barberId: string;
  date: string; // 'YYYY-MM-DD'
  time: string; // 'HH:mm'
  durationMin: number;
  amountCents: number;
  /** Téléphone du client — OBLIGATOIRE depuis l'inscription forcée. */
  clientPhone: string;
  /** Email du client — OBLIGATOIRE depuis l'inscription forcée. */
  clientEmail: string;
  /** Date de naissance — OBLIGATOIRE (format YYYY-MM-DD). Permet l'envoi
   *  automatique d'un cadeau anniversaire au client. */
  clientDateOfBirth: string;
  /** Prénom — optionnel mais recommandé (rempli depuis le formulaire d'inscription). */
  clientFirstName?: string;
  /** Nom — optionnel mais recommandé. */
  clientLastName?: string;
}

/** Templates de payload push localisés selon la locale du salon (tenants.locale).
 *  Hardcodé serveur-side parce que les Server Actions n'ont pas accès aux
 *  catalogues `next-intl` (qui sont client-side). */
const PUSH_LABELS: Record<'fr' | 'en' | 'ar', { title: string; body: string }> = {
  fr: { title: 'Nouvelle réservation', body: '{name} · {date} {time}' },
  en: { title: 'New booking', body: '{name} · {date} {time}' },
  ar: { title: 'حجز جديد', body: '{name} · {date} {time}' },
};

/** Extrait `fr`/`en`/`ar` depuis le tag `tenants.locale` (ex. 'fr-FR' → 'fr'). */
function pickPushLocale(tenantLocale: string | null | undefined): 'fr' | 'en' | 'ar' {
  if (!tenantLocale) return 'fr';
  const head = tenantLocale.toLowerCase().slice(0, 2);
  return head === 'en' || head === 'ar' ? head : 'fr';
}

export async function createBookingPublic(input: CreateBookingInput): Promise<MutationResult> {
  const headersList = await headers();

  // Single-tenant : il n'y a qu'un seul tenant en base, identifié par la
  // constante statique SALON.tenantUuid. On n'a plus de header `x-tenant-id`
  // (le middleware multi-tenant n'existe plus dans ce fork) — toute la
  // résolution tenant repose désormais sur cette constante.
  const tenantId = SALON.tenantUuid;

  // Rate-limit anti-abuse : 20 réservations/min par IP. Bots qui spammeraient
  // de fausses réservations (CRM polluant, déni de service sur les créneaux)
  // sont bloqués bien avant de saturer la DB. Le tenant légitime reste
  // confortablement sous la limite (un humain réserve ~1/30s max).
  const ip =
    headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headersList.get('x-real-ip') ??
    'unknown';
  if (!(await rlBookingIp(ip))) {
    return { ok: false, errorKey: 'unknownError', errorValues: { message: '' } };
  }

  // 1. Validation Zod — bornes strictes + sanitization.
  const parsed = CreateBookingPublicSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    const msg = first?.message;
    // Mapping des erreurs métier vers les codes i18n côté client. On ne fuit
    // jamais de message Zod brut à l'utilisateur — toujours un code traduisible.
    const errorKey: PublicBookingErrorCode =
      msg === 'phoneRequired'
        ? 'phoneRequired'
        : msg === 'emailRequired'
          ? 'emailRequired'
          : msg === 'invalidEmail'
            ? 'invalidEmail'
            : msg === 'dobRequired'
              ? 'dobRequired'
              : msg === 'dobInvalid'
                ? 'dobInvalid'
                : msg === 'dateOutOfRange'
                  ? 'dateOutOfRange'
                  : 'unknownError';
    return {
      ok: false,
      errorKey,
      errorValues: errorKey === 'unknownError' ? { message: msg ?? 'invalidData' } : undefined,
    };
  }
  const data = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // 2. Pré-check tenant — service_id ET barber_id DOIVENT appartenir au tenant.
  //    La FK des bookings ne contraint pas la cohérence tenant ; sans ce
  //    check, un attaquant peut poster un UUID d'un autre salon.
  //    On select aussi `name` pour pouvoir composer l'email de confirmation
  //    sans re-query (notifyClientOfNewBooking).
  const [svcRes, barberRes] = await Promise.all([
    admin
      .from('services')
      .select('id, tenant_id, name, price_cents')
      .eq('id', data.serviceId)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    admin
      .from('staff')
      .select('id, tenant_id, name')
      .eq('id', data.barberId)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ]);

  if (svcRes.error || !svcRes.data) {
    return { ok: false, errorKey: 'serviceMismatch' };
  }
  if (barberRes.error || !barberRes.data) {
    return { ok: false, errorKey: 'barberMismatch' };
  }
  const serviceName = (svcRes.data as { name?: string }).name ?? '';
  const barberName = (barberRes.data as { name?: string }).name ?? '';

  // Sécurité : le montant est RECALCULÉ depuis le prix serveur du service. On
  // ne fait jamais confiance au `amountCents` envoyé par le client (sinon un
  // client malicieux pourrait poster 0 et polluer le CA / la fidélité).
  // Fallback sur l'input uniquement si price_cents est NULL en base.
  const servicePriceCents = (svcRes.data as { price_cents?: number | null }).price_cents;
  const verifiedAmountCents =
    typeof servicePriceCents === 'number' && servicePriceCents >= 0
      ? servicePriceCents
      : data.amountCents;

  // 3. Compose le créneau dans le TZ du tenant. `tenants.timezone` (IANA,
  //    ex. "Africa/Cairo") détermine comment interpréter la saisie locale.
  //    Sans ce refacto, "14h le 23 mai" était stocké comme 14h UTC = 16h
  //    Le Caire pour Aboodhairsalon (+ contrainte d'overlap dégradée).
  //    Fallback `tenants.locale` si timezone NULL (compat anciens tenants).
  const tenantRowForTz = await admin
    .from('tenants')
    .select('timezone, locale')
    .eq('id', tenantId)
    .maybeSingle();
  const tz =
    (tenantRowForTz.data as { timezone?: string; locale?: string } | null)?.timezone ||
    fallbackTimezoneFromLocale((tenantRowForTz.data as { locale?: string } | null)?.locale);
  const startsAt = zonedToUtcIso(data.date, data.time, tz);
  const endsAt = new Date(new Date(startsAt).getTime() + data.durationMin * 60_000).toISOString();

  // Garde anti-passé : refuse les RDV dont starts_at est dans le passé
  // (au moins 5 min de marge pour absorber le retard horloge serveur/client).
  // Sans ça, un client malicieux via DevTools pourrait poster une date au
  // passé pour brouiller les KPIs ou occuper des slots déjà passés (audit T2.2).
  if (new Date(startsAt).getTime() < Date.now() - 5 * 60_000) {
    return { ok: false, errorKey: 'dateOutOfRange' };
  }

  // Upsert du profil client AVANT la création du RDV — le téléphone + email
  // sont garantis présents (Zod required). UPSERT idempotent sur la clé
  // composite (tenant_id, phone) : si le client revient avec un nouveau email,
  // on met à jour ; sinon no-op. On n'écrase pas first_name/last_name déjà
  // saisis pour éviter de réinitialiser un profil enrichi en Caisse.
  // Pattern « COALESCE-like » : on n'écrit first/last_name que si fournis.
  const profileUpsert: Record<string, string | null> = {
    tenant_id: tenantId,
    phone: data.clientPhone,
    email: data.clientEmail,
    date_of_birth: data.clientDateOfBirth,
    updated_at: new Date().toISOString(),
  };
  if (data.clientFirstName) profileUpsert['first_name'] = data.clientFirstName;
  if (data.clientLastName) profileUpsert['last_name'] = data.clientLastName;
  const { error: profileErr } = await admin
    .from('client_profiles')
    .upsert(profileUpsert, { onConflict: 'tenant_id,phone' });
  if (profileErr) {
    return {
      ok: false,
      errorKey: 'unknownError',
      errorValues: { message: (profileErr as { message?: string }).message ?? '' },
    };
  }

  const { data: insRow, error } = await admin
    .from('bookings')
    .insert({
      tenant_id: tenantId,
      client_display_name: data.clientName,
      client_phone: data.clientPhone,
      service_id: data.serviceId,
      barber_id: data.barberId,
      starts_at: startsAt,
      ends_at: endsAt,
      amount_cents: verifiedAmountCents,
      status: 'upcoming',
      source: 'client_app',
    })
    .select('id')
    .single();

  if (error) {
    // bookings_no_overlap → conflit de créneau
    if (
      (error as { code?: string }).code === '23P01' ||
      (error as { message?: string }).message?.includes('bookings_no_overlap')
    ) {
      return { ok: false, errorKey: 'slotTaken' };
    }
    return {
      ok: false,
      errorKey: 'unknownError',
      errorValues: { message: (error as { message?: string }).message ?? '' },
    };
  }

  revalidatePath('/cashier');

  const newBookingId = (insRow as { id: string } | null)?.id ?? '';

  // 3.5. Email de confirmation au client — best-effort, ne bloque pas la
  //      réponse. Sans email enregistré (client_profiles.email NULL) ou
  //      sans RESEND_API_KEY, l'envoi est silencieusement skip.
  if (newBookingId) {
    void notifyClientOfNewBooking({
      tenantId,
      bookingId: newBookingId,
      clientPhone: data.clientPhone,
      serviceName,
      barberName,
      startsAtIso: startsAt,
      durationMin: data.durationMin,
    });
  }

  // 4. Notif push localisée — `tenants.locale` détermine la langue.
  //    Best-effort : si VAPID absent, échec silencieux.
  void (async () => {
    try {
      const tenantRow = await admin
        .from('tenants')
        .select('locale')
        .eq('id', tenantId)
        .maybeSingle();
      const locale = pickPushLocale((tenantRow.data as { locale?: string } | null)?.locale);
      const labels = PUSH_LABELS[locale];
      // Body sanitized (clientName a passé sanitizeDisplay) + tronqué à 80
      // caractères pour éviter qu'un nom long ne pollue la notification.
      const body = labels.body
        .replace('{name}', data.clientName.slice(0, 80))
        .replace('{date}', data.date)
        .replace('{time}', data.time);
      await sendPushToTenant(
        tenantId,
        { title: labels.title, body, url: '/manager?tab=reserv', tag: 'new-booking' },
        { role: 'manager' },
      );
      // Notifie AUSSI la caisse — c'est le poste en salle qui doit réagir le
      // plus vite à une nouvelle réservation. Appel séparé : l'URL de clic
      // diffère (caissier → /cashier, pas /manager qui le redirigerait).
      await sendPushToTenant(
        tenantId,
        { title: labels.title, body, url: '/cashier', tag: 'new-booking' },
        { role: 'cashier' },
      );
    } catch {
      // best-effort
    }
  })();

  return { ok: true, id: newBookingId };
}
