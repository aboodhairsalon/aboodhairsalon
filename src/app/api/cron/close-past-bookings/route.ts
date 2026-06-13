/**
 * Cron job quotidien — clôture des RDV dont l'heure est passée mais qui sont
 * restés au statut « vivant » (`upcoming` / `in_chair`).
 *
 * Problème : rien ne fait transitionner un RDV après son heure. Un RDV honoré
 * et encaissé via `payBooking` passe bien à `done`, mais un RDV qu'on a oublié
 * de marquer (ou un client qui n'est pas venu) reste `upcoming` indéfiniment —
 * il s'affichait « À venir » dans l'espace client (corrigé aussi côté affichage)
 * et faussait les stats Direction (taux de présence).
 *
 * Règle métier appliquée (documentée pour pouvoir l'ajuster) :
 *   - RDV passé QUI A une vente non-remboursée liée  → `done`   (honoré, mais
 *     le statut n'avait pas suivi — on rattrape).
 *   - RDV passé SANS vente liée                       → `no_show` (le client
 *     n'a pas complété de visite tracée). Le gérant peut corriger à la main
 *     (contrôle done/no_show déjà présent dans l'espace Direction) si besoin.
 *
 * Grace de 2 h : on ne touche jamais un RDV de moins de 2 h pour ne pas
 * clôturer un client encore dans le fauteuil. Combiné à un run à ~03 h Le Caire
 * (salon fermé depuis 22 h), seuls les RDV réellement terminés sont traités.
 *
 * Sécurité : header `Authorization: Bearer ${CRON_SECRET}` (idem
 * booking-reminders). Sans le header → 401. Sans secret configuré → 503.
 */
import { headers } from 'next/headers';
import { createAdminClient } from '@/db';
import { SALON } from '@/config/salon';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Fenêtre de grâce : on ignore les RDV de moins de 2 h pour ne pas clôturer
 *  un client encore en prestation. */
const GRACE_MS = 2 * 60 * 60 * 1000;

export async function GET(): Promise<Response> {
  const h = await headers();
  const auth = h.get('authorization');
  const cronSecret = process.env['CRON_SECRET'];
  if (!cronSecret) {
    return new Response('Cron secret not configured', { status: 503 });
  }
  if (auth !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const cutoffIso = new Date(Date.now() - GRACE_MS).toISOString();

  // 1. RDV « vivants » dont l'heure est passée (au-delà de la grâce).
  const { data: stale, error: staleErr } = await admin
    .from('bookings')
    .select('id')
    .eq('tenant_id', SALON.tenantUuid)
    .in('status', ['upcoming', 'in_chair'])
    .lt('starts_at', cutoffIso);

  if (staleErr) {
    return Response.json(
      { ok: false, error: (staleErr as { message?: string }).message ?? 'query failed' },
      { status: 500 },
    );
  }

  const staleIds: string[] = (stale ?? []).map((r: { id: string }) => r.id);
  if (staleIds.length === 0) {
    return Response.json({ ok: true, scanned: 0, done: 0, noShow: 0 });
  }

  // 2. Parmi eux, lesquels portent une vente non-remboursée → honorés → `done`.
  const { data: sales, error: salesErr } = await admin
    .from('sales')
    .select('booking_id')
    .in('booking_id', staleIds)
    .neq('status', 'refunded');

  if (salesErr) {
    return Response.json(
      { ok: false, error: (salesErr as { message?: string }).message ?? 'sales query failed' },
      { status: 500 },
    );
  }

  const honoredIds = new Set(
    (sales ?? [])
      .map((r: { booking_id: string | null }) => r.booking_id)
      .filter((id: string | null): id is string => !!id),
  );
  const doneIds = staleIds.filter((id) => honoredIds.has(id));
  const noShowIds = staleIds.filter((id) => !honoredIds.has(id));

  // 3. Applique les transitions. On sépare les deux UPDATE car les statuts
  //    diffèrent ; `.in('id', [...])` borne strictement les lignes touchées.
  if (doneIds.length > 0) {
    const { error } = await admin.from('bookings').update({ status: 'done' }).in('id', doneIds);
    if (error) {
      return Response.json(
        { ok: false, error: (error as { message?: string }).message ?? 'done update failed' },
        { status: 500 },
      );
    }
  }
  if (noShowIds.length > 0) {
    const { error } = await admin
      .from('bookings')
      .update({ status: 'no_show' })
      .in('id', noShowIds);
    if (error) {
      return Response.json(
        { ok: false, error: (error as { message?: string }).message ?? 'no_show update failed' },
        { status: 500 },
      );
    }
  }

  return Response.json({
    ok: true,
    scanned: staleIds.length,
    done: doneIds.length,
    noShow: noShowIds.length,
  });
}
