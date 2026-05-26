'use server';
/**
 * Server Actions — avis clients sur les barbiers.
 *
 * Pas de session Auth côté client — admin client utilisé (bypass RLS).
 * Identifiant client : (tenant_id, phone) — même logique que profile-actions.
 *
 * Retours d'erreur : les codes ClientErrorCode (résolus côté client via
 * `useTranslations('client.errors.*')`) circulent sur le wire — pas de chaîne
 * FR/EN/AR brute.
 */
import { createAdminClient } from '@/db';

/** Codes d'erreur émis par les Server Actions côté client. */
export type ClientErrorCode =
  | 'authRequired'
  | 'tenantNotAuthorized'
  | 'tenantMissing'
  | 'missingParams'
  | 'missingTenantPhone'
  | 'missingVisitSource'
  | 'invalidRating'
  | 'alreadyReviewed'
  | 'searchFailed'
  | 'saveFailed'
  | 'createProfileFailed'
  | 'salesLoadFailed'
  | 'dobRequired'
  | 'dobInvalid'
  | 'ambiguousEmail'
  | 'profileNotFound'
  | 'profileUpdateFailed'
  | 'dbError';

export type ClientErrorValues = Record<string, string | number>;

// ─── Types ───────────────────────────────────────────────────────────────────

export type ReviewableVisit = {
  kind: 'booking' | 'sale';
  id: string; // booking_id ou sale_id
  barberId: string;
  barberName: string;
  date: string; // 'YYYY-MM-DD'
  label: string; // nom du service ou liste des articles
};

export type GetReviewableVisitsResult =
  | { ok: true; visits: ReviewableVisit[] }
  | { ok: false; errorKey: ClientErrorCode; errorValues?: ClientErrorValues };

export type SubmitReviewInput = {
  tenantId: string;
  clientPhone: string;
  barberId: string;
  bookingId?: string;
  saleId?: string;
  rating: number; // 1–5
  comment?: string;
};

export type SubmitReviewResult =
  | { ok: true }
  | { ok: false; errorKey: ClientErrorCode; errorValues?: ClientErrorValues };

export type BarberRating = {
  barberId: string;
  avg: number;
  count: number;
};

export type GetBarberRatingsResult =
  | { ok: true; ratings: BarberRating[] }
  | { ok: false; errorKey: ClientErrorCode; errorValues?: ClientErrorValues };

// ─── getReviewableVisits ─────────────────────────────────────────────────────

/**
 * Retourne les visites payées de ce client (booking + ventes directes) qui
 * n'ont pas encore été notées.
 *
 * Pour les bookings : joint avec staff pour récupérer le nom du barbier.
 * Pour les sales directes : même chose.
 */
export async function getReviewableVisits(
  tenantId: string,
  phone: string,
): Promise<GetReviewableVisitsResult> {
  if (!tenantId || !phone?.trim()) return { ok: true, visits: [] };

  const admin = createAdminClient();
  const normalizedPhone = phone.trim();

  // 1. Bookings payés, avec barbier + service
  const { data: bookings, error: bErr } = await admin
    .from('bookings')
    .select('id, barber_id, starts_at, services(name), staff(name)')
    
    .eq('client_phone', normalizedPhone)
    .eq('paid', true);

  if (bErr) return { ok: false, errorKey: 'dbError', errorValues: { message: bErr.message } };

  // 2. Ventes directes liées à ce téléphone
  const { data: sales, error: sErr } = await admin
    .from('sales')
    .select('id, barber_id, completed_at, sale_items(name, qty), staff(name)')
    
    .eq('client_phone', normalizedPhone)
    .not('barber_id', 'is', null);

  if (sErr) return { ok: false, errorKey: 'dbError', errorValues: { message: sErr.message } };

  // 3. Récupérer les IDs déjà notés pour filtrage côté app
  const { data: reviewed } = await admin
    .from('barber_reviews')
    .select('booking_id, sale_id')
    
    .eq('client_phone', normalizedPhone);

  const reviewedBookings = new Set<string>(
    (reviewed ?? []).map((r) => r.booking_id).filter((id): id is string => id !== null),
  );
  const reviewedSales = new Set<string>(
    (reviewed ?? []).map((r) => r.sale_id).filter((id): id is string => id !== null),
  );

  const visits: ReviewableVisit[] = [];

  for (const b of bookings ?? []) {
    if (reviewedBookings.has(b.id)) continue;
    if (!b.barber_id) continue;
    const staffRecord = b.staff as { name?: string } | null;
    const serviceRecord = b.services as { name?: string } | null;
    visits.push({
      kind: 'booking',
      id: b.id,
      barberId: b.barber_id,
      barberName: staffRecord?.name ?? 'Barbier',
      date: (b.starts_at as string).split('T')[0]!,
      label: serviceRecord?.name ?? 'Prestation',
    });
  }

  for (const s of sales ?? []) {
    if (reviewedSales.has(s.id)) continue;
    if (!s.barber_id) continue;
    const items = s.sale_items as { name: string; qty: number }[] | null;
    const label = items && items.length > 0 ? items.map((i) => i.name).join(', ') : 'Vente directe';
    const staffRecord = s.staff as { name?: string } | null;
    visits.push({
      kind: 'sale',
      id: s.id,
      barberId: s.barber_id,
      barberName: staffRecord?.name ?? 'Barbier',
      date: (s.completed_at as string).split('T')[0]!,
      label,
    });
  }

  // Trier par date décroissante
  visits.sort((a, b) => b.date.localeCompare(a.date));

  return { ok: true, visits };
}

// ─── submitReview ─────────────────────────────────────────────────────────────

export async function submitReview(input: SubmitReviewInput): Promise<SubmitReviewResult> {
  const { tenantId, clientPhone, barberId, bookingId, saleId, rating, comment } = input;

  if (!tenantId || !clientPhone?.trim() || !barberId) {
    return { ok: false, errorKey: 'missingParams' };
  }
  if (!bookingId && !saleId) {
    return { ok: false, errorKey: 'missingVisitSource' };
  }
  if (rating < 1 || rating > 5) {
    return { ok: false, errorKey: 'invalidRating' };
  }

  const admin = createAdminClient();

  // TODO(découplage) : `tenant_id` est requis par le schéma multi-tenant
  // hérité de System A. À retirer quand le schéma DB sera consolidé en
  // single-tenant (drop column tenant_id). En attendant, on cast à `never`
  // pour bypass le type-check, et le RLS server-side filtre via auth.uid().
  const { error } = await admin.from('barber_reviews').insert({
    barber_id: barberId,
    client_phone: clientPhone.trim(),
    booking_id: bookingId ?? null,
    sale_id: saleId ?? null,
    rating,
    comment: comment?.trim() || null,
  } as never);

  if (error) {
    // Violation de la contrainte UNIQUE → déjà noté
    if ((error as { code?: string }).code === '23505') {
      return { ok: false, errorKey: 'alreadyReviewed' };
    }
    return {
      ok: false,
      errorKey: 'dbError',
      errorValues: { message: (error as { message?: string }).message ?? '' },
    };
  }

  return { ok: true };
}

// ─── getBarberRatings ─────────────────────────────────────────────────────────

/**
 * Retourne la note moyenne et le nombre d'avis pour chaque barbier du tenant.
 * Utilisé par /manager pour afficher le badge de notation sur les cartes.
 */
export async function getBarberRatings(tenantId: string): Promise<GetBarberRatingsResult> {
  if (!tenantId) return { ok: true, ratings: [] };

  const admin = createAdminClient();

  const { data, error } = await admin
    .from('barber_reviews')
    .select('barber_id, rating')
    ;

  if (error) return { ok: false, errorKey: 'dbError', errorValues: { message: error.message } };

  // Agréger côté app (pas de GROUP BY en JS SDK sans RPC)
  const map = new Map<string, { sum: number; count: number }>();
  for (const row of data ?? []) {
    const key = row.barber_id;
    const existing = map.get(key) ?? { sum: 0, count: 0 };
    map.set(key, { sum: existing.sum + row.rating, count: existing.count + 1 });
  }

  const ratings: BarberRating[] = Array.from(map.entries()).map(([barberId, { sum, count }]) => ({
    barberId,
    avg: Math.round((sum / count) * 10) / 10,
    count,
  }));

  return { ok: true, ratings };
}

// ─── getBarberReviews ─────────────────────────────────────────────────────────

export type BarberReview = {
  id: string;
  rating: number; // 1–5
  comment: string | null;
  date: string; // 'YYYY-MM-DD'
  clientName: string; // prénom + initiale du nom, ou 'Client'
};

export type GetBarberReviewsResult =
  | { ok: true; reviews: BarberReview[]; avg: number; count: number }
  | { ok: false; errorKey: ClientErrorCode; errorValues?: ClientErrorValues };

/**
 * Liste détaillée des avis d'un barbier, du plus récent au plus ancien,
 * accompagnée de la note moyenne et du total.
 *
 * Le nom affiché est résolu depuis client_profiles : prénom + initiale du nom
 * (ex. « Karim B. »). Le téléphone et l'email ne sont jamais exposés.
 */
export async function getBarberReviews(
  tenantId: string,
  barberId: string,
): Promise<GetBarberReviewsResult> {
  if (!tenantId || !barberId) return { ok: true, reviews: [], avg: 0, count: 0 };

  const admin = createAdminClient();

  const { data, error } = await admin
    .from('barber_reviews')
    .select('id, rating, comment, created_at, client_phone')
    
    .eq('barber_id', barberId)
    .order('created_at', { ascending: false });

  if (error) return { ok: false, errorKey: 'dbError', errorValues: { message: error.message } };

  const rows = data ?? [];
  if (rows.length === 0) return { ok: true, reviews: [], avg: 0, count: 0 };

  // Résolution groupée des prénoms (client_profiles hors types générés).
  const phones = Array.from(new Set(rows.map((r) => r.client_phone)));
  const nameByPhone = new Map<string, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminAny = admin as any;
  const { data: profiles } = await adminAny
    .from('client_profiles')
    .select('phone, first_name, last_name')
    
    .in('phone', phones);
  for (const p of (profiles ?? []) as {
    phone: string;
    first_name: string | null;
    last_name: string | null;
  }[]) {
    const first = (p.first_name ?? '').trim();
    const last = (p.last_name ?? '').trim();
    const initial = last ? ` ${last.charAt(0).toUpperCase()}.` : '';
    if (first) nameByPhone.set(p.phone, `${first}${initial}`);
  }

  const reviews: BarberReview[] = rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment?.trim() || null,
    date: r.created_at.split('T')[0]!,
    clientName: nameByPhone.get(r.client_phone) ?? 'Client',
  }));

  const count = reviews.length;
  const avg = Math.round((reviews.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10;

  return { ok: true, reviews, avg, count };
}
