-- =============================================================================
-- 0021_sales_refunds.sql — annulation / remboursement d'une vente
-- =============================================================================
--
-- Le type `sale_status` (cf. 0005) accepte déjà `refunded` et `voided`, mais
-- aucun chemin applicatif ne pose ce statut et aucune colonne ne trace le qui /
-- quand / pourquoi. Cette migration :
--
--  1. Ajoute `refunded_at`, `refunded_by`, `refund_reason` à `sales` — qui a
--     remboursé, à quelle date, et le motif (facultatif côté UX mais utile
--     pour les audits comptables).
--
--  2. Étend le trigger `update_client_metrics_on_sale` pour qu'un passage de
--     `completed` → `refunded` rembourse aussi les métriques client (visites
--     décrémentées, total_spent_cents réduit). Sans ça les points fidélité
--     restent crédités sur une vente annulée — bug comptable bloquant.
--
--  3. Ajoute un index `sales_refunded_idx` (sparse) pour les KPIs "ventes
--     remboursées du mois" / clôture de journée — c'est rare, mais quand
--     ça arrive on veut lister vite.
--
-- Réversible : drop des 3 colonnes, drop de l'index, restauration de la
-- fonction trigger 0005 (cf. /supabase/migrations/0005_bookings_sales.sql §234).
-- =============================================================================

alter table public.sales
  add column if not exists refunded_at   timestamptz,
  add column if not exists refunded_by   uuid references auth.users(id) on delete set null,
  add column if not exists refund_reason text;

comment on column public.sales.refunded_at   is 'Horodatage du remboursement (UTC) — null tant que la vente est completed';
comment on column public.sales.refunded_by   is 'Compte ayant déclenché le remboursement (Direction ou Caissier)';
comment on column public.sales.refund_reason is 'Motif libre saisi en caisse — facultatif mais conservé pour audit';

create index if not exists sales_refunded_idx
  on public.sales (tenant_id, refunded_at desc)
  where status = 'refunded';

-- -----------------------------------------------------------------------------
-- Trigger étendu : rembourse les métriques client à la transition
-- completed → refunded. Le trigger original n'écrivait QUE sur completed,
-- jamais sur transition inverse — d'où la fuite de points fidélité.
-- -----------------------------------------------------------------------------
create or replace function public.update_client_metrics_on_sale()
returns trigger
language plpgsql
as $$
begin
  -- 1. Vente nouvellement complétée → créditer
  if new.client_id is not null and new.status = 'completed'
     and (tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.status != 'completed'))
  then
    update public.clients
       set total_spent_cents = total_spent_cents + new.total_cents,
           visits_count      = visits_count + 1,
           last_seen_at      = greatest(last_seen_at, coalesce(new.completed_at, new.created_at)),
           updated_at        = now()
     where id = new.client_id;
  end if;

  -- 2. Vente complétée puis remboursée → débiter (réversible)
  --    On contraint sur le passage completed→refunded uniquement pour ne pas
  --    débiter deux fois si quelqu'un update une vente déjà refunded.
  if tg_op = 'UPDATE'
     and old.status = 'completed' and new.status = 'refunded'
     and new.client_id is not null
  then
    update public.clients
       set total_spent_cents = greatest(0, total_spent_cents - old.total_cents),
           visits_count      = greatest(0, visits_count - 1),
           updated_at        = now()
     where id = new.client_id;
  end if;

  return new;
end;
$$;
