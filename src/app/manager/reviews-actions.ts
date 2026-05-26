'use server';
/**
 * Server Action — boîte de réception des avis (Tableau de bord du Manager).
 *
 * Retourne TOUS les avis du tenant, tous barbiers confondus, du plus récent au
 * plus ancien — de quoi alimenter l'onglet « Avis ». Le composant `ManagerReviews`
 * résout lui-même barberId → nom/teinte/photo depuis sa liste d'équipe (aucun
 * besoin de le faire côté serveur).
 *
 * Client admin (bypass RLS). On re-vérifie le tenant via requireTenant() pour
 * qu'un tenantId arbitraire ne fasse jamais fuiter les avis d'un autre salon —
 * même garde que getDashboardSeries.
 */
import { createAdminClient } from '@/db';
import { requireTenant } from '../_data/auth-server';
import type { ManagerErrorCode, ManagerErrorValues } from './actions';

export type TenantReview = {
  id: string;
  barberId: string;
  rating: number; // 1–5
  comment: string | null;
  date: string; // 'YYYY-MM-DD'
  clientName: string; // « Karim B. » ou « Client » (jamais de téléphone/email)
};

export type GetTenantReviewsResult =
  | { ok: true; reviews: TenantReview[]; avg: number; count: number }
  | { ok: false; errorKey: ManagerErrorCode; errorValues?: ManagerErrorValues };

/**
 * Charge tous les avis du tenant, prénom du client résolu, triés du plus
 * récent au plus ancien. `avg` est arrondi au dixième.
 *
 * @param tenantId — UUID du tenant (résolu par requireTenant côté composant).
 */
export async function getTenantReviews(tenantId: string): Promise<GetTenantReviewsResult> {
  if (!tenantId) return { ok: false, errorKey: 'tenantMissing' };

  // Re-garde : on rejette tout tenantId qui n'est pas celui de la session.
  const ctx = await requireTenant();
  if (ctx.tenant.id !== tenantId) {
    return { ok: false, errorKey: 'tenantNotAuthorized' };
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from('barber_reviews')
    .select('id, barber_id, rating, comment, created_at, client_phone')
    
    .order('created_at', { ascending: false });

  if (error) {
    return {
      ok: false,
      errorKey: 'loadReviewsFailed',
      errorValues: { message: (error as { message?: string }).message ?? '' },
    };
  }

  const rows = data ?? [];
  if (rows.length === 0) return { ok: true, reviews: [], avg: 0, count: 0 };

  // Résolution groupée des prénoms — client_profiles hors types générés.
  // Même logique que getBarberReviews : prénom + initiale du nom (« Karim B. »).
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

  const reviews: TenantReview[] = rows.map((r) => ({
    id: r.id,
    barberId: r.barber_id,
    rating: r.rating,
    comment: r.comment?.trim() || null,
    date: r.created_at.split('T')[0]!,
    clientName: nameByPhone.get(r.client_phone) ?? 'Client',
  }));

  const count = reviews.length;
  const avg = Math.round((reviews.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10;

  return { ok: true, reviews, avg, count };
}
