'use server';
/**
 * Server actions — LECTURE du solde cashback à la Caisse.
 *
 * Ce module calcule et lit le solde disponible d'un client pour l'afficher en
 * caisse AVANT l'encaissement (`getCashbackBalance`). Le DÉBIT réel a été
 * déplacé CÔTÉ VENTE : il a lieu dans `debitClientCashback`
 * (`manager/booking-actions.ts`), atomique avec la création de la vente. Ainsi
 * une vente annulée ou échouée ne débite RIEN → plus de cashback perdu sur
 * abandon de l'encaissement.
 *
 * Solde = cashback gagné (somme `subtotal − refunded` des ventes `completed` du
 * client × taux du tenant) − cashback déjà utilisé
 * (`client_profiles.cashback_redeemed_cents`). Source de vérité : la table `sales`.
 *
 * `redeemCashbackForSale` plus bas est conservée mais @deprecated (plus appelée).
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient } from '@/db';
import { SALON } from '@/config/salon';
import { getCurrentUser } from '../_data/auth-server';

export type CashbackErrorCode =
  | 'authRequired'
  | 'tenantNotAuthorized'
  | 'invalidData'
  | 'profileNotFound'
  | 'insufficientCashback'
  | 'concurrentUpdate'
  | 'dbError';

export type CashbackErrorValues = Record<string, string | number>;

export type RedeemCashbackResult =
  | {
      ok: true;
      /** Nouveau cashback déjà utilisé après le débit (= ancien + amountCents). */
      newRedeemedCents: number;
      /** Solde disponible restant après le débit. */
      remainingAvailableCents: number;
    }
  | { ok: false; errorKey: CashbackErrorCode; errorValues?: CashbackErrorValues };

const RedeemSchema = z.object({
  tenantId: z.string().uuid(),
  phone: z.string().trim().min(1).max(40),
  amountCents: z.number().int().min(1).max(10_000_000),
});

export type RedeemCashbackInput = z.input<typeof RedeemSchema>;

/**
 * Calcule le cashback gagné brut (avant déduction du redeemed) pour un
 * client donné. Source de vérité unique : montant cumulé dépensé × taux
 * cashback du tenant. Sert au check « insufficientCashback ».
 */
async function computeEarnedCashbackCents(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  tenantId: string,
  phone: string,
): Promise<number> {
  // Source de vérité unique : toutes les sales `completed` du client.
  //
  //   - Chaque sale comptabilise sa contribution = `subtotal_cents − refunded_cents`
  //     · subtotal = montant BRUT (items + extras + supplément), avant cashback
  //     · refunded_cents (cf. migration 0032) déduit les refunds partiels/totaux
  //   - On NE COMPTE PAS séparément bookings.amount_cents : payBooking crée
  //     toujours une sale liée, donc déjà incluse. L'ancienne double source
  //     (bookings + sales filtre booking_id=null) ratait les extras facturés
  //     sur les RDV (audit 2026-05-24 T1.8 / D-P0-2).
  //   - Une sale entièrement remboursée a `refunded_cents = total_cents` →
  //     contribution = 0. Une sale partiellement remboursée contribue son
  //     restant brut au calcul du cashback (le client a tout de même bénéficié
  //     de la prestation à hauteur du net).
  const [salesRes, settingsRes] = await Promise.all([
    admin
      .from('sales')
      .select('subtotal_cents, refunded_cents')
      .eq('tenant_id', SALON.tenantUuid)
      .eq('client_phone', phone)
      .eq('status', 'completed'),
    admin
      .from('tenant_settings')
      .select('cashback_rate_bp')
      
      .maybeSingle(),
  ]);

  const totalSpentCents = (
    (salesRes.data as { subtotal_cents: number; refunded_cents: number | null }[] | null) ?? []
  ).reduce(
    (acc: number, r: { subtotal_cents: number; refunded_cents: number | null }) =>
      acc + Math.max(0, (r.subtotal_cents ?? 0) - (r.refunded_cents ?? 0)),
    0,
  );

  const rateBp =
    (settingsRes.data as { cashback_rate_bp?: number } | null)?.cashback_rate_bp ?? 250;
  return Math.round((totalSpentCents * rateBp) / 10000);
}

/**
 * @deprecated Plus appelée. Le débit du cashback a été déplacé CÔTÉ VENTE
 * (`debitClientCashback` dans `manager/booking-actions.ts`), atomique avec la
 * vente → une vente annulée/échouée ne débite rien. Conservée pour un éventuel
 * ajustement manuel futur côté Direction ; NE PAS rebrancher au clic
 * « Appliquer » en caisse (c'était la cause du cashback perdu sur abandon).
 *
 * Débite le cashback du client d'un montant donné. Retourne le nouveau solde.
 */
export async function redeemCashbackForSale(
  input: RedeemCashbackInput,
): Promise<RedeemCashbackResult> {
  // 1. Validation Zod
  const parsed = RedeemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errorKey: 'invalidData' };
  const { tenantId, phone, amountCents } = parsed.data;

  // 2. Auth : user connecté + appartient au tenant ciblé
  const user = await getCurrentUser();
  if (!user) return { ok: false, errorKey: 'authRequired' };
  // Single-tenant : tout staff authentifié (manager/cashier) est autorisé. Le
  // claim app_metadata.tenant_id n'existe pas sur les comptes caissier — s'y
  // fier bloquait la redemption cashback en caisse.
  const role = user.app_metadata?.['role'] as string | undefined;
  if (role && role !== 'manager' && role !== 'cashier') {
    return { ok: false, errorKey: 'tenantNotAuthorized' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const normalizedPhone = phone.trim();

  // 3. Charge le profil pour récupérer redeemed actuel
  const profileRes = await admin
    .from('client_profiles')
    .select('cashback_redeemed_cents')
    
    .eq('phone', normalizedPhone)
    .maybeSingle();

  if (profileRes.error) {
    return {
      ok: false,
      errorKey: 'dbError',
      errorValues: { message: (profileRes.error as { message?: string }).message ?? '' },
    };
  }
  if (!profileRes.data) {
    return { ok: false, errorKey: 'profileNotFound' };
  }
  const currentRedeemed =
    (profileRes.data as { cashback_redeemed_cents?: number }).cashback_redeemed_cents ?? 0;

  // 4. Vérifie le solde disponible (defense-in-depth — l'UI aurait déjà
  //    refusé si insuffisant mais on revalide).
  const earnedCents = await computeEarnedCashbackCents(admin, tenantId, normalizedPhone);
  const availableCents = Math.max(0, earnedCents - currentRedeemed);
  if (amountCents > availableCents) {
    return {
      ok: false,
      errorKey: 'insufficientCashback',
      errorValues: { available: availableCents, requested: amountCents },
    };
  }

  // 5. UPDATE atomique avec garde TOCTOU : on n'incrémente que si la valeur
  //    actuelle en DB est encore celle qu'on a lue. Si un autre process a
  //    incrémenté entre-temps, le rowcount est 0 → on retourne concurrentUpdate.
  const newRedeemed = currentRedeemed + amountCents;
  const updateRes = await admin
    .from('client_profiles')
    .update({ cashback_redeemed_cents: newRedeemed })
    
    .eq('phone', normalizedPhone)
    .eq('cashback_redeemed_cents', currentRedeemed) // TOCTOU guard
    .select('cashback_redeemed_cents');

  if (updateRes.error) {
    return {
      ok: false,
      errorKey: 'dbError',
      errorValues: { message: (updateRes.error as { message?: string }).message ?? '' },
    };
  }
  if (!updateRes.data || updateRes.data.length === 0) {
    return { ok: false, errorKey: 'concurrentUpdate' };
  }

  revalidatePath('/cashier');
  revalidatePath('/client');

  return {
    ok: true,
    newRedeemedCents: newRedeemed,
    remainingAvailableCents: availableCents - amountCents,
  };
}

/**
 * Lit le solde cashback disponible d'un client pour l'afficher côté Caisse
 * AVANT d'appliquer la redemption. Utilisé pour pré-remplir le bouton
 * « Appliquer cashback » avec un montant suggéré.
 */
export type GetCashbackBalanceResult =
  | {
      ok: true;
      earnedCents: number;
      redeemedCents: number;
      availableCents: number;
    }
  | { ok: false; errorKey: CashbackErrorCode; errorValues?: CashbackErrorValues };

export async function getCashbackBalance(
  tenantId: string,
  phone: string,
): Promise<GetCashbackBalanceResult> {
  if (!tenantId || !phone?.trim()) {
    return { ok: false, errorKey: 'invalidData' };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, errorKey: 'authRequired' };
  // Single-tenant : tout staff authentifié (manager/cashier) est autorisé —
  // même garde que redeemCashbackForSale. L'ancien check sur le claim
  // app_metadata.tenant_id bloquait l'AFFICHAGE du solde en caisse
  // (bouton « Appliquer cashback » invisible) alors que la redemption
  // elle-même avait déjà été corrigée. Audit.
  const role = user.app_metadata?.['role'] as string | undefined;
  if (role && role !== 'manager' && role !== 'cashier') {
    return { ok: false, errorKey: 'tenantNotAuthorized' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const normalizedPhone = phone.trim();

  const profileRes = await admin
    .from('client_profiles')
    .select('cashback_redeemed_cents')

    .eq('phone', normalizedPhone)
    .maybeSingle();

  if (profileRes.error) {
    return {
      ok: false,
      errorKey: 'dbError',
      errorValues: { message: (profileRes.error as { message?: string }).message ?? '' },
    };
  }
  if (!profileRes.data) {
    // Pas de profil = pas de cashback. On retourne 0 plutôt qu'une erreur
    // pour ne pas bloquer l'UI (le bouton sera juste désactivé).
    return { ok: true, earnedCents: 0, redeemedCents: 0, availableCents: 0 };
  }
  const redeemedCents =
    (profileRes.data as { cashback_redeemed_cents?: number }).cashback_redeemed_cents ?? 0;

  const earnedCents = await computeEarnedCashbackCents(admin, tenantId, normalizedPhone);
  const availableCents = Math.max(0, earnedCents - redeemedCents);

  return { ok: true, earnedCents, redeemedCents, availableCents };
}
