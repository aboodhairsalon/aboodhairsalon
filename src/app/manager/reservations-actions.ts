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
import { requireTenant } from '../_data/auth-server';
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

  const ctx = await requireTenant();
  if (ctx.tenant.id !== tenantId) {
    return { ok: false, errorKey: 'tenantNotAuthorized' };
  }

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
  const starts = new Date(row.starts_at as string);
  return {
    id: row.id as string,
    clientName: (row.client_display_name as string) ?? '',
    serviceId: (row.service_id as string) ?? '',
    barberId: (row.barber_id as string) ?? '',
    date: (row.starts_at as string).split('T')[0]!,
    time: `${String(starts.getUTCHours()).padStart(2, '0')}:${String(starts.getUTCMinutes()).padStart(2, '0')}`,
    status:
      row.status === 'in_chair' ? 'in-chair' : (row.status as 'upcoming' | 'done' | 'cancelled'),
    paid: (row.paid as boolean) ?? false,
    amountCents: (row.amount_cents as number) ?? 0,
    extras: [],
  };
}
