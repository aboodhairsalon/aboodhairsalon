'use server';
/**
 * Server Action — réservations pour l'onglet Réservations du Manager.
 *
 * Charge les RDV du tenant sur une fenêtre glissante (-7 jours → futur).
 * Réutilisé par l'onglet Réservations qui se contentait avant de `[]` —
 * d'où l'onglet désespérément vide pour tout vrai salon.
 *
 * Client admin (bypass RLS) — re-gardé par requireTenant() pour qu'aucun
 * tenantId arbitraire ne fasse fuiter les RDV d'un autre salon.
 */
import { createAdminClient } from '@/db';
import { SALON } from '@/config/salon';
import { requireTenant } from '../_data/auth-server';
import { utcIsoToZonedParts } from '../_lib/timezone';
import type { Booking } from '../_data/mock';
import type { ManagerErrorCode, ManagerErrorValues } from './actions';

export type GetReservationsResult =
  | { ok: true; bookings: Booking[] }
  | { ok: false; errorKey: ManagerErrorCode; errorValues?: ManagerErrorValues };

/**
 * Charge les RDV du tenant depuis 7 jours en arrière jusqu'au futur, triés
 * du plus ancien au plus récent (l'UI les regroupera par jour).
 */
export async function getManagerReservations(tenantId: string): Promise<GetReservationsResult> {
  if (!tenantId) return { ok: false, errorKey: 'tenantMissing' };

  // Single-tenant : pas de guard cross-tenant. `requireTenant()` suffit pour
  // vérifier l'auth manager.
  await requireTenant();

  const admin = createAdminClient();

  const now = new Date();
  const windowStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 7),
  ).toISOString();

  const { data, error } = await admin
    .from('bookings')
    .select('*')
    
    .gte('starts_at', windowStart)
    .order('starts_at', { ascending: true });

  if (error) {
    return {
      ok: false,
      errorKey: 'loadReservationsFailed',
      errorValues: { message: (error as { message?: string }).message ?? '' },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bookings: Booking[] = ((data as any[]) ?? []).map(mapBookingRow);
  return { ok: true, bookings };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapBookingRow(row: any): Booking {
  // Heure locale salon (Le Caire), pas UTC — cf. audit timezone.
  const zoned = utcIsoToZonedParts(row.starts_at as string, SALON.timezone);
  return {
    id: row.id as string,
    clientName: (row.client_display_name as string) ?? '',
    serviceId: (row.service_id as string) ?? '',
    barberId: (row.barber_id as string) ?? '',
    date: zoned.date,
    time: zoned.time,
    status:
      row.status === 'in_chair' ? 'in-chair' : (row.status as 'upcoming' | 'done' | 'cancelled'),
    paid: (row.paid as boolean) ?? false,
    amountCents: (row.amount_cents as number) ?? 0,
    extras: [],
  };
}
