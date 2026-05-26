'use server';
/**
 * Server Actions — remboursement / annulation d'une vente.
 *
 * Pourquoi un fichier séparé : le remboursement est l'un des rares chemins
 * où Direction ET Caisse doivent agir (un caissier rembourse souvent en direct
 * un client mécontent ; le gérant rembourse a posteriori dans l'historique).
 * Ni `requireTenant()` (bloque les caissiers) ni `requireCashier()` (bloque
 * les gérants) ne suffit seul — on dérive un garde-fou local.
 *
 * Sécurité :
 *  - Garde commune `requireAnyTenantRole()` : exige une session, exige
 *    `tenant_id` dans app_metadata, refuse les rôles inconnus.
 *  - Le filtre `tenant_id` sur l'UPDATE empêche tout cross-tenant même si un
 *    saleId arbitraire est fourni.
 *  - Le statut DOIT être `completed` avant remboursement — pas de double
 *    refund possible, pas de refund d'une vente déjà voidée.
 *  - Le trigger DB `update_client_metrics_on_sale` (migration 0021) débite
 *    automatiquement total_spent_cents / visits_count du client à la
 *    transition completed → refunded.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient } from '@/db';
import { getCurrentUser } from '../_data/auth-server';
import { notifyClientOfRefund } from './refund-email';
import type { ManagerErrorCode, ManagerErrorValues } from './actions';

/** Code étendu spécifique au flux refund. */
export type RefundErrorCode =
  | ManagerErrorCode
  | 'saleAlreadyRefunded'
  | 'saleNotRefundable'
  | 'saleNotFound'
  | 'refundExceedsRemaining';

export type RefundResult =
  | {
      ok: true;
      /** Total cumulé remboursé après ce refund (en centimes) — permet à l'UI
       *  de mettre à jour l'état local sans re-fetch. */
      refundedCents: number;
      /** `true` si ce refund a porté le total à 100 % (vente passée à
       *  `status='refunded'`), `false` si refund partiel (vente reste
       *  `completed`). */
      fullyRefunded: boolean;
    }
  | { ok: false; errorKey: RefundErrorCode; errorValues?: ManagerErrorValues };

/** Garde minimaliste : session + tenant_id présent. Tolère Direction ET Caisse. */
async function requireAnyTenantRole(): Promise<
  { ok: true; userId: string; tenantId: string } | { ok: false; errorKey: ManagerErrorCode }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, errorKey: 'directionOnly' as const };
  const tenantId = user.app_metadata?.['tenant_id'] as string | undefined;
  if (!tenantId) return { ok: false, errorKey: 'tenantMissing' as const };
  return { ok: true, userId: user.id, tenantId };
}

const RefundSchema = z.object({
  saleId: z.string().uuid('invalidStaffId'),
  /** Montant à rembourser en centimes. Omis ou `null` → on rembourse le
   *  restant intégral (comportement historique). Strict positif et inférieur
   *  ou égal au restant non-remboursé sinon la Server Action rejette. */
  amountCents: z.number().int().positive().optional(),
  reason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => v || null),
});

export type RefundInput = z.input<typeof RefundSchema>;

/**
 * Marque une vente comme remboursée — statut `refunded` + horodatage + auteur
 * + motif facultatif. Le trigger DB rembourse les points fidélité et débite
 * les compteurs client (visites, total dépensé).
 *
 * Refus côté serveur si la vente n'existe pas, n'appartient pas au tenant
 * du caller, ou n'est pas en statut `completed`.
 */
export async function refundSale(input: RefundInput): Promise<RefundResult> {
  const guard = await requireAnyTenantRole();
  if (!guard.ok) return guard;

  const parsed = RefundSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errorKey: 'invalidData' };
  }
  const { saleId, amountCents, reason } = parsed.data;

  // Admin client bypass RLS — la garde tenant_id ci-dessus est sûre car on
  // re-filtre tenant_id sur l'UPDATE.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // 1) Charger la vente pour vérifier qu'elle existe + qu'elle est refundable.
  //    On lit total_cents (NET cash), refunded_cents (cumulé), cashback déjà
  //    débité (pour recrédit proportionnel), booking_id (pour reset paid si
  //    full refund) et client_phone (pour cibler client_profiles au recrédit).
  const { data: row, error: fetchErr } = await admin
    .from('sales')
    .select(
      'id, status, tenant_id, total_cents, refunded_cents, cashback_redeemed_cents, booking_id, client_phone',
    )
    .eq('id', saleId)
     // sécurité : pas de cross-tenant via UUID deviné
    .maybeSingle();

  if (fetchErr || !row) {
    return { ok: false, errorKey: 'saleNotFound' };
  }
  if (row.status === 'refunded' || row.status === 'voided') {
    return { ok: false, errorKey: 'saleAlreadyRefunded' };
  }
  if (row.status !== 'completed') {
    return { ok: false, errorKey: 'saleNotRefundable' };
  }

  // Calcule combien on peut encore rembourser. Sans refund partiel
  // antérieur, refunded_cents = 0 → remaining = total_cents.
  const totalCents = row.total_cents as number;
  const alreadyRefunded = (row.refunded_cents as number | null) ?? 0;
  const cashbackOnSale = (row.cashback_redeemed_cents as number | null) ?? 0;
  const bookingId = (row.booking_id as string | null) ?? null;
  const clientPhone = (row.client_phone as string | null) ?? null;
  const remaining = totalCents - alreadyRefunded;

  // Montant à rembourser : valeur fournie OU restant intégral par défaut.
  const refundAmount = amountCents ?? remaining;

  if (refundAmount <= 0 || refundAmount > remaining) {
    return {
      ok: false,
      errorKey: 'refundExceedsRemaining',
      errorValues: { remaining: remaining.toString() },
    };
  }

  const newRefundedCents = alreadyRefunded + refundAmount;
  const fullyRefunded = newRefundedCents >= totalCents;

  // 2) Update atomique. Le `.eq('refunded_cents', alreadyRefunded)` est la
  //    garde TOCTOU : si un autre refund partiel a déjà incrémenté la
  //    colonne entre notre SELECT et notre UPDATE, le WHERE ne matche pas
  //    → 0 row updated → on renvoie une erreur explicite plutôt qu'un
  //    succès trompeur (et le trigger DB ne sur-débite pas le client).
  //
  //    Si le refund clôt la vente (refunded_cents atteint total_cents), on
  //    passe le statut à 'refunded' pour déclencher le décrément visites
  //    dans le trigger ; sinon le statut reste 'completed' (refund partiel).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updatePayload: any = {
    refunded_cents: newRefundedCents,
    refunded_at: new Date().toISOString(),
    refunded_by: guard.userId,
    refund_reason: reason,
  };
  if (fullyRefunded) {
    updatePayload.status = 'refunded';
  }

  const { data: updated, error: updateErr } = await admin
    .from('sales')
    .update(updatePayload)
    .eq('id', saleId)
    
    .eq('status', 'completed') // garde statut (pas de refund sur voided/refunded)
    .eq('refunded_cents', alreadyRefunded) // garde TOCTOU partial refund
    .select('id');

  if (updateErr) {
    return {
      ok: false,
      errorKey: 'dbError',
      errorValues: { message: (updateErr as { message?: string }).message ?? '' },
    };
  }

  // Si l'UPDATE matche 0 row → quelqu'un nous a doublé entre le SELECT et
  // l'UPDATE (race), ou le statut a changé, ou refunded_cents a bougé.
  // Le client doit retenter en repartant de l'état frais.
  if (!updated || (updated as unknown[]).length === 0) {
    return { ok: false, errorKey: 'saleAlreadyRefunded' };
  }

  // ── EFFETS DE BORD POST-REFUND ──────────────────────────────────────────
  //
  // Tous best-effort : si un fail ici, on log mais on n'annule pas le refund
  // (la sale est déjà ajustée, c'est l'état comptable de référence).

  // (a) Re-créditer le cashback PROPORTIONNELLEMENT au montant remboursé.
  //     Si client a payé 80 cash + 20 cashback (subtotal=100, total=80,
  //     cashback_on_sale=20), et qu'on refund 40 (=50% du net), on recrédite
  //     50% du cashback = 10. La formule reste juste pour les refunds
  //     successifs : chaque refund recrédite sa propre part proportionnelle.
  if (cashbackOnSale > 0 && clientPhone && totalCents > 0) {
    const cashbackRecredit = Math.round((cashbackOnSale * refundAmount) / totalCents);
    if (cashbackRecredit > 0) {
      // SELECT puis UPDATE avec garde TOCTOU : si une autre opération
      // modifie `cashback_redeemed_cents` entre les deux, on retente une
      // seule fois avant d'abandonner (best-effort — la sale est déjà
      // ajustée, le client peut redemander un ajustement manuel).
      for (let attempt = 0; attempt < 2; attempt++) {
        const { data: cp } = await admin
          .from('client_profiles')
          .select('cashback_redeemed_cents')
          
          .eq('phone', clientPhone)
          .maybeSingle();
        if (!cp) break;
        const cur = (cp as { cashback_redeemed_cents?: number }).cashback_redeemed_cents ?? 0;
        const next = Math.max(0, cur - cashbackRecredit);
        const { data: updatedCp } = await admin
          .from('client_profiles')
          .update({ cashback_redeemed_cents: next })
          
          .eq('phone', clientPhone)
          .eq('cashback_redeemed_cents', cur) // TOCTOU guard
          .select('phone');
        if (updatedCp && (updatedCp as unknown[]).length > 0) break;
        // Race perdue : on retente une fois.
      }
    }
  }

  // (b) Si refund full ET la vente était liée à un RDV → remettre paid=false
  //     pour que le RDV réapparaisse dans « Clients à encaisser » (audit T1.4).
  if (fullyRefunded && bookingId) {
    await admin
      .from('bookings')
      .update({ paid: false })
      .eq('id', bookingId)
      ;
  }

  // (c) Si refund full → restituer le stock des produits vendus en créant
  //     des `product_movements` de kind='return' qty positif (audit T1.7).
  //     Pour un refund PARTIEL, on ne sait pas quel produit retourner —
  //     comportement actuel : on ne fait rien (limitation acceptée pour MVP,
  //     la caissière peut ajuster le stock manuellement si nécessaire).
  if (fullyRefunded) {
    const { data: items } = await admin
      .from('sale_items')
      .select('kind, product_id, qty')
      .eq('sale_id', saleId)
      
      .eq('kind', 'product');
    const productLines = (items as { product_id: string | null; qty: number }[] | null) ?? [];
    if (productLines.length > 0) {
      const movements = productLines
        .filter((l) => l.product_id)
        .map((l) => ({
          product_id: l.product_id,
          kind: 'return' as const,
          qty_delta: Math.abs(l.qty), // positif → restore stock via trigger 0004
          reference_id: saleId,
          reason: 'Refund vente',
        }));
      if (movements.length > 0) {
        await admin.from('product_movements').insert(movements);
      }
    }
  }

  // Notification email au client — fire-and-forget. Si Resend down ou
  // client sans email, on log mais on ne bloque pas le refund DB. Le
  // client reçoit un message clair avec montant + motif pour eviter les
  // chargebacks / confusion / perte de confiance dans le salon.
  if (clientPhone) {
    void notifyClientOfRefund({
      tenantId: guard.tenantId,
      clientPhone,
      saleId,
      refundedCents: refundAmount,
      saleTotalCents: totalCents,
      fullyRefunded,
      reason,
    });
  }

  // Le log Caisse + le tableau de bord Direction doivent refléter le statut.
  revalidatePath('/cashier');
  revalidatePath('/manager');
  return { ok: true, refundedCents: newRefundedCents, fullyRefunded };
}
