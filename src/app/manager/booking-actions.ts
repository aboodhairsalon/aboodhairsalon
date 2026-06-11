'use server';
/**
 * Server Actions — réservations + encaissements.
 *
 * Utilisées depuis /client (createBooking) et /cashier
 * (updateBookingStatus, payBooking, createDirectSale).
 *
 * Auth : requireTenant() fonctionne pour les comptes Direction ET caissier
 * — tous ont `tenant_id` dans app_metadata (posé par le hook + createCashierAccess).
 */
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/db';
import { requireTenant } from '../_data/auth-server';
import { fallbackTimezoneFromLocale, zonedToUtcIso } from '../_lib/timezone';
import { notifyClientOfCancellation } from './booking-cancel-email';

// FIX critique : ces actions tournaient sur getServerSupabase() (session,
// RLS-enforced). En prod le JWT cashier d'Aboodhairsalon n'a pas (ou plus)
// le claim `tenant_id` dans app_metadata → la policy RLS bloquait l'INSERT
// dans `sales` silencieusement (l'action retournait saleCreateFailed mais
// le toast d'erreur était imperceptible). Résultat observé : 0 vente
// enregistrée dans la DB depuis le déploiement single-tenant.
// Solution : passer en admin client (bypass RLS), comme tous les autres
// writes du manager (cf. commentaire dans manager/actions.ts). La sécurité
// reste assurée par `requireTenant()` qui vérifie en amont que l'appelant
// est authentifié sur ce tenant.

// @supabase/ssr v0.5.x has type-inference gaps when chaining .insert().select()
// — cast to any at call sites to preserve strict typing everywhere else.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

/** Codes d'erreur émis par les actions booking — résolus côté client via
 *  `useTranslations('cashier.errors.*')` pour rester i18n-friendly. */
export type BookingErrorCode =
  | 'unknownError'
  | 'slotTaken'
  | 'bookingNotFound'
  | 'bookingAlreadyPaid'
  | 'bookingUpdateFailed'
  | 'saleCreateFailed'
  | 'saleItemsFailed'
  // Pré-checks cross-tenant côté booking public (cf. booking-public-action.ts)
  | 'serviceMismatch'
  | 'barberMismatch';

export type BookingErrorValues = Record<string, string | number>;

export type MutationResult =
  | { ok: true; id?: string }
  | { ok: false; errorKey: BookingErrorCode; errorValues?: BookingErrorValues };

// =============================================================================
// createBooking — appelé depuis /client au submit du flow de réservation
// =============================================================================

export interface CreateBookingInput {
  clientName: string;
  serviceId: string;
  barberId: string;
  date: string; // 'YYYY-MM-DD'
  time: string; // 'HH:mm'
  durationMin: number;
  amountCents: number;
  /** Numéro de téléphone du client — optionnel, utilisé pour la fidélité. */
  clientPhone?: string;
}

export async function createBooking(input: CreateBookingInput): Promise<MutationResult> {
  // allowCashier: true → la caisse appelle ces actions ; sinon requireTenant
  // ferait redirect('/cashier') qui aborte l'INSERT silencieusement.
  const ctx = await requireTenant({ allowCashier: true });
  const supabase = createAdminClient() as AnySupabase;

  // Composer le créneau dans le TZ du salon (cf. _lib/timezone). `ctx.tenant.timezone`
  // est l'IANA name déjà chargé par requireTenant. Fallback locale si NULL.
  const tz = ctx.tenant.timezone || fallbackTimezoneFromLocale(ctx.tenant.locale);
  const startsAt = zonedToUtcIso(input.date, input.time, tz);
  const endsAt = new Date(new Date(startsAt).getTime() + input.durationMin * 60_000).toISOString();

  const { data, error } = await (supabase as AnySupabase)
    .from('bookings')
    .insert({
      tenant_id: ctx.tenant.id,
      client_display_name: input.clientName,
      client_phone: input.clientPhone?.trim() || null,
      service_id: input.serviceId,
      barber_id: input.barberId,
      starts_at: startsAt,
      ends_at: endsAt,
      amount_cents: input.amountCents,
      status: 'upcoming',
      source: 'client_app',
    })
    .select('id')
    .single();

  if (error) {
    // bookings_no_overlap → conflit de créneau
    if (
      (error as { code?: string }).code === '23P01' ||
      error.message?.includes('bookings_no_overlap')
    ) {
      return { ok: false, errorKey: 'slotTaken' };
    }
    return {
      ok: false,
      errorKey: 'unknownError',
      errorValues: { message: error.message ?? '' },
    };
  }

  revalidatePath('/cashier');
  return { ok: true, id: data?.id };
}

// =============================================================================
// updateBookingStatus — appelé depuis /cashier (démarrer / terminer / annuler)
// =============================================================================

export async function updateBookingStatus(
  id: string,
  status: 'in_chair' | 'done' | 'cancelled' | 'no_show',
): Promise<MutationResult> {
  // allowCashier: true → la caisse appelle ces actions ; sinon requireTenant
  // ferait redirect('/cashier') qui aborte l'INSERT silencieusement.
  const ctx = await requireTenant({ allowCashier: true });
  const supabase = createAdminClient() as AnySupabase;

  // Garde de cohérence : on ne marque no_show / cancelled QUE sur un RDV non
  // encore facturé. Un RDV `done` payé ne peut pas être « no_show » a
  // posteriori (la prestation a eu lieu, l'encaissement est clôturé). Sans
  // cette garde, le manager pourrait corrompre les KPIs (compter en CA puis
  // libérer le slot via no_show). Audit T5.29.
  if (status === 'no_show' || status === 'cancelled') {
    const { data: current } = await (supabase as AnySupabase)
      .from('bookings')
      .select('paid')
      .eq('id', id)
      
      .maybeSingle();
    if ((current as { paid?: boolean } | null)?.paid === true) {
      return { ok: false, errorKey: 'bookingAlreadyPaid' };
    }
  }

  const { error } = await (supabase as AnySupabase)
    .from('bookings')
    .update({ status })
    .eq('id', id)
    ;

  if (error) {
    return {
      ok: false,
      errorKey: 'unknownError',
      errorValues: { message: error.message ?? '' },
    };
  }

  // Notification email au client quand le salon annule (et SEULEMENT
  // 'cancelled' — pas 'no_show' qui signifie « le client n'est pas
  // venu », ni in_chair/done qui n'ont rien à notifier). Fire-and-forget.
  if (status === 'cancelled') {
    void notifyClientOfCancellation({
      tenantId: ctx.tenant.id,
      bookingId: id,
    });
  }

  revalidatePath('/cashier');
  revalidatePath('/manager');
  return { ok: true };
}

// =============================================================================
// payBooking — paiement d'un RDV existant (post-prestation)
// =============================================================================

export interface PayBookingInput {
  bookingId: string;
  method: 'card' | 'cash' | 'mobile';
  serviceName?: string;
  /** Pourboire en centimes — tracé à part du chiffre. */
  tipCents?: number;
  /** Supplément (montant libre) en centimes. */
  extraCents?: number;
  /** Description obligatoire du supplément quand `extraCents > 0`.
   *  Utilisée comme `name` du sale_item généré pour expliquer le surplus
   *  (couleur, soin spécial, etc.) plutôt que le générique « Supplément ». */
  extraDescription?: string;
  /** Cashback débité par le client au moment de l'encaissement (déjà appliqué
   *  côté `client_profiles.cashback_redeemed_cents` par ApplyCashbackButton).
   *  À déduire de `total_cents` (qui devient le NET cash encaissé) et à
   *  stocker dans `sales.cashback_redeemed_cents` pour le re-crédit
   *  proportionnel au refund. */
  cashbackAppliedCents?: number;
  extras?: Array<{
    kind: 'service' | 'product';
    refId: string;
    name: string;
    priceCents: number;
    qty: number;
  }>;
}

export async function payBooking(input: PayBookingInput): Promise<MutationResult> {
  // allowCashier: true → la caisse appelle ces actions ; sinon requireTenant
  // ferait redirect('/cashier') qui aborte l'INSERT silencieusement.
  const ctx = await requireTenant({ allowCashier: true });
  const supabase = createAdminClient() as AnySupabase;

  const db = supabase as AnySupabase;

  // 1. Charger le booking
  const { data: booking, error: fetchErr } = await db
    .from('bookings')
    .select('id, amount_cents, barber_id, service_id, client_display_name')
    .eq('id', input.bookingId)
    
    .single();

  if (fetchErr || !booking) {
    return { ok: false, errorKey: 'bookingNotFound' };
  }

  const bookingRow = booking as {
    id: string;
    amount_cents: number;
    barber_id: string | null;
    service_id: string | null;
    client_display_name: string | null;
  };

  // 2. Calculer le subtotal BRUT (articles + extras + supplément). Le tip
  //    et le cashback sont à part. total_cents = subtotal − cashback (NET cash).
  const extrasTotal = (input.extras ?? []).reduce((s, e) => s + e.priceCents * e.qty, 0);
  const extra = Math.max(0, Math.round(input.extraCents ?? 0));
  const tip = Math.max(0, Math.round(input.tipCents ?? 0));
  const subtotal = bookingRow.amount_cents + extrasTotal + extra;
  // Cashback plafonné au subtotal — défense supplémentaire ; le client UI
  // bornait déjà mais on revérifie côté serveur.
  const cashbackApplied = Math.max(0, Math.min(input.cashbackAppliedCents ?? 0, subtotal));
  const total = subtotal - cashbackApplied;
  // TVA — modèle TTC : les prix affichés (services, produits) sont déjà
  // toutes taxes comprises. On extrait la part de TVA incluse dans le
  // subtotal pour la traçabilité comptable et l'affichage sur reçu.
  // Formule TTC : tax = subtotal × rate / (10000 + rate). Si rate=0, tax=0
  // → aucune ligne TVA sur le reçu (cas par défaut petit salon
  // non-assujetti). Audit T5.25.
  const taxRateBp = Math.max(0, ctx.settings.tax_rate_bp ?? 0);
  const taxCents = taxRateBp > 0 ? Math.round((subtotal * taxRateBp) / (10_000 + taxRateBp)) : 0;

  // 3. Marquer le booking comme payé — garde TOCTOU sur `paid=false` pour
  //    empêcher le double-encaissement quand 2 caissières ouvrent le même
  //    RDV en parallèle. Si déjà payé → 0 row matched → erreur explicite.
  const { data: paidRows, error: updateErr } = await db
    .from('bookings')
    .update({ paid: true })
    .eq('id', input.bookingId)
    
    .eq('paid', false)
    .select('id');

  if (updateErr)
    return {
      ok: false,
      errorKey: 'bookingUpdateFailed',
      errorValues: { message: (updateErr as { message?: string }).message ?? '' },
    };

  if (!paidRows || (paidRows as unknown[]).length === 0) {
    // Booking déjà marqué payé par un autre caissier OU n'existe pas dans
    // le tenant — refuse pour ne pas créer une sale orpheline doublonnée.
    return { ok: false, errorKey: 'bookingNotFound' };
  }

  // 4. Insérer la vente. `subtotal_cents` = BRUT (avant cashback), `total_cents`
  //    = NET cash réellement encaissé (= subtotal − cashback). `tip_cents`
  //    à part, jamais inclus dans subtotal ni total.
  const { data: sale, error: saleErr } = await db
    .from('sales')
    .insert({
      tenant_id: ctx.tenant.id,
      barber_id: bookingRow.barber_id ?? null,
      booking_id: input.bookingId,
      client_name: bookingRow.client_display_name ?? null,
      method: input.method,
      subtotal_cents: subtotal,
      total_cents: total,
      tip_cents: tip,
      tax_cents: taxCents,
      cashback_redeemed_cents: cashbackApplied,
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (saleErr || !sale) {
    return {
      ok: false,
      errorKey: 'saleCreateFailed',
      errorValues: { message: (saleErr as { message?: string } | null)?.message ?? '' },
    };
  }

  const saleRow = sale as { id: string };

  // 5. Insérer les sale_items (prestation + extras + supplément éventuel)
  const itemsToInsert = [
    {
      sale_id: saleRow.id,
      kind: 'service' as const,
      service_id: bookingRow.service_id ?? null,
      product_id: null,
      name: input.serviceName ?? 'Prestation',
      qty: 1,
      unit_price_cents: bookingRow.amount_cents,
      total_cents: bookingRow.amount_cents,
    },
    ...(input.extras ?? []).map((e) => ({
      sale_id: saleRow.id,
      kind: e.kind,
      service_id: e.kind === 'service' ? e.refId : null,
      product_id: e.kind === 'product' ? e.refId : null,
      name: e.name,
      qty: e.qty,
      unit_price_cents: e.priceCents,
      total_cents: e.priceCents * e.qty,
    })),
    ...(extra > 0
      ? [
          {
            sale_id: saleRow.id,
            kind: 'service' as const,
            service_id: null,
            product_id: null,
            // L'UI rend la description obligatoire quand un supplément est saisi ;
            // côté serveur on garde un fallback générique au cas où un appelant
            // bypasse l'UI (script, futur API…).
            name: input.extraDescription?.trim() || 'Supplément',
            qty: 1,
            unit_price_cents: extra,
            total_cents: extra,
          },
        ]
      : []),
  ];

  const { error: itemsErr } = await db.from('sale_items').insert(itemsToInsert);

  if (itemsErr) {
    // Compensation : la vente a été créée mais sans lignes. On la supprime et
    // on remet le RDV en non-payé pour permettre une nouvelle tentative propre
    // (évite la vente orpheline + le RDV bloqué « payé » sans reçu).
    await db.from('sales').delete().eq('id', saleRow.id);
    await db.from('bookings').update({ paid: false }).eq('id', input.bookingId);
    return {
      ok: false,
      errorKey: 'saleItemsFailed',
      errorValues: { message: itemsErr.message ?? '' },
    };
  }

  // Décrément du stock pour les produits vendus (extras kind='product').
  // Best-effort comme côté refund : un mouvement raté n'annule pas la vente
  // (déjà comptabilisée), le stock reste ajustable manuellement.
  const stockMovements = (input.extras ?? [])
    .filter((e) => e.kind === 'product')
    .map((e) => ({
      tenant_id: ctx.tenant.id,
      product_id: e.refId,
      kind: 'sale' as const,
      qty_delta: -Math.abs(e.qty),
      reference_id: saleRow.id,
      reason: 'Vente',
    }));
  if (stockMovements.length > 0) {
    await db.from('product_movements').insert(stockMovements);
  }

  revalidatePath('/cashier');
  revalidatePath('/manager');
  return { ok: true, id: saleRow.id };
}

// =============================================================================
// createDirectSale — vente POS rapide (sans RDV lié)
// =============================================================================

export interface DirectSaleItem {
  kind: 'service' | 'product';
  refId: string;
  name: string;
  priceCents: number;
  qty: number;
}

export interface CreateDirectSaleInput {
  barberId?: string;
  clientPhone?: string;
  /** Nom du client saisi en caisse — optionnel. */
  clientName?: string;
  /** Pourboire en centimes — tracé à part du chiffre. */
  tipCents?: number;
  /** Supplément (montant libre) en centimes — compte dans le chiffre. */
  extraCents?: number;
  /** Description obligatoire du supplément quand `extraCents > 0` (cf. PayBookingInput). */
  extraDescription?: string;
  /** Cf. PayBookingInput.cashbackAppliedCents — déduit de `total_cents`,
   *  stocké dans `sales.cashback_redeemed_cents` pour re-crédit au refund. */
  cashbackAppliedCents?: number;
  method: 'card' | 'cash' | 'mobile';
  items: DirectSaleItem[];
}

export async function createDirectSale(input: CreateDirectSaleInput): Promise<MutationResult> {
  // allowCashier: true → la caisse appelle ces actions ; sinon requireTenant
  // ferait redirect('/cashier') qui aborte l'INSERT silencieusement.
  const ctx = await requireTenant({ allowCashier: true });
  const db = createAdminClient() as AnySupabase;

  // subtotal = BRUT, total = NET cash (subtotal − cashback). Tip à part.
  const itemsTotal = input.items.reduce((s, i) => s + i.priceCents * i.qty, 0);
  const extra = Math.max(0, Math.round(input.extraCents ?? 0));
  const tip = Math.max(0, Math.round(input.tipCents ?? 0));
  const subtotal = itemsTotal + extra;
  const cashbackApplied = Math.max(0, Math.min(input.cashbackAppliedCents ?? 0, subtotal));
  const total = subtotal - cashbackApplied;
  // TVA TTC : extraction depuis subtotal. Cf. payBooking pour la formule.
  // Audit T5.25.
  const taxRateBp = Math.max(0, ctx.settings.tax_rate_bp ?? 0);
  const taxCents = taxRateBp > 0 ? Math.round((subtotal * taxRateBp) / (10_000 + taxRateBp)) : 0;

  const { data: sale, error: saleErr } = await db
    .from('sales')
    .insert({
      tenant_id: ctx.tenant.id,
      barber_id: input.barberId ?? null,
      client_phone: input.clientPhone?.trim() || null,
      client_name: input.clientName?.trim() || null,
      method: input.method,
      subtotal_cents: subtotal,
      total_cents: total,
      tip_cents: tip,
      tax_cents: taxCents,
      cashback_redeemed_cents: cashbackApplied,
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (saleErr || !sale) {
    return {
      ok: false,
      errorKey: 'saleCreateFailed',
      errorValues: { message: (saleErr as { message?: string } | null)?.message ?? '' },
    };
  }

  const saleRow = sale as { id: string };

  // Articles du panier + ligne « Supplément » (montant libre) si présent.
  const itemsToInsert = [
    ...input.items.map((i) => ({
      sale_id: saleRow.id,
      kind: i.kind,
      service_id: i.kind === 'service' ? i.refId : null,
      product_id: i.kind === 'product' ? i.refId : null,
      name: i.name,
      qty: i.qty,
      unit_price_cents: i.priceCents,
      total_cents: i.priceCents * i.qty,
    })),
    ...(extra > 0
      ? [
          {
            sale_id: saleRow.id,
            kind: 'service' as const,
            service_id: null,
            product_id: null,
            name: input.extraDescription?.trim() || 'Supplément',
            qty: 1,
            unit_price_cents: extra,
            total_cents: extra,
          },
        ]
      : []),
  ];

  const { error: itemsErr } = await db.from('sale_items').insert(itemsToInsert);
  if (itemsErr) {
    // Compensation : vente créée sans lignes → on la supprime (évite l'orpheline).
    await db.from('sales').delete().eq('id', saleRow.id);
    return {
      ok: false,
      errorKey: 'saleItemsFailed',
      errorValues: { message: itemsErr.message ?? '' },
    };
  }

  // Décrément du stock pour les produits vendus (best-effort).
  const stockMovements = input.items
    .filter((i) => i.kind === 'product')
    .map((i) => ({
      tenant_id: ctx.tenant.id,
      product_id: i.refId,
      kind: 'sale' as const,
      qty_delta: -Math.abs(i.qty),
      reference_id: saleRow.id,
      reason: 'Vente',
    }));
  if (stockMovements.length > 0) {
    await db.from('product_movements').insert(stockMovements);
  }

  // Enregistrement best-effort du profil client (clé tenant_id + phone).
  // insert-or-ignore : un nouveau client est créé, un profil existant non écrasé.
  const phone = input.clientPhone?.trim();
  const name = input.clientName?.trim();
  if (phone && name) {
    await db
      .from('client_profiles')
      .upsert(
        { tenant_id: ctx.tenant.id, phone, first_name: name },
        { onConflict: 'tenant_id,phone', ignoreDuplicates: true },
      );
  }

  revalidatePath('/cashier');
  revalidatePath('/manager');
  return { ok: true, id: saleRow.id };
}

// =============================================================================
// setBookingExtras — persiste les extras ajoutés en caisse (audit T2.9)
// =============================================================================
//
// Les extras (services ou produits ajoutés à un RDV avant encaissement) sont
// stockés en colonne JSONB `bookings.extras` depuis la migration 0035. Avant,
// ils n'existaient qu'en state React → perdus au refresh ou cross-device.
//
// L'API est intentionnellement « replace all » plutôt que add/remove granulaires :
//  - simplifie le state sync front (un seul appel)
//  - élimine les races (deux remove concurrents sur la même key se résolvent
//    naturellement par le last-write-wins, l'UI reload de toute façon)
//  - évite la cascade : pas de table séparée à maintenir

export interface BookingExtraInput {
  key: string;
  kind: 'service' | 'product';
  refId: string;
  name: string;
  priceCents: number;
  qty: number;
}

export async function setBookingExtras(
  bookingId: string,
  extras: BookingExtraInput[],
): Promise<MutationResult> {
  // requireTenant() exécuté pour ses effets de bord (auth + redirect si non-manager).
  await requireTenant();
  const db = createAdminClient() as AnySupabase;

  // Validation defense-in-depth : un appel malicieux pourrait pousser des
  // extras avec prix négatif ou qty bizarre. On clamp et on tronque les
  // chaînes pour ne pas exploser la colonne JSONB.
  const cleaned = (Array.isArray(extras) ? extras : [])
    .slice(0, 50) // hard cap — un RDV avec 50 extras est déjà absurde
    .map((e) => ({
      key: String(e.key ?? '').slice(0, 80),
      kind: e.kind === 'product' ? 'product' : 'service',
      refId: String(e.refId ?? '').slice(0, 80),
      name: String(e.name ?? '').slice(0, 200),
      priceCents: Math.max(0, Math.min(10_000_000, Math.round(Number(e.priceCents ?? 0)))),
      qty: Math.max(1, Math.min(999, Math.round(Number(e.qty ?? 1)))),
    }))
    .filter((e) => e.name.length > 0);

  const { error } = await db
    .from('bookings')
    .update({ extras: cleaned })
    .eq('id', bookingId)
    ;

  if (error) {
    return {
      ok: false,
      errorKey: 'bookingUpdateFailed',
      errorValues: { message: (error as { message?: string }).message ?? '' },
    };
  }

  revalidatePath('/cashier');
  revalidatePath('/manager');
  return { ok: true };
}
