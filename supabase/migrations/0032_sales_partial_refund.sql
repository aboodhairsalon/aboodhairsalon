-- =============================================================================
-- 0032_sales_partial_refund.sql — remboursement partiel des ventes
-- =============================================================================
--
-- Avant cette migration, `refundSale` était binaire : `completed` → `refunded`,
-- toujours pour le total intégral. La caissière ne pouvait pas rembourser
-- seulement une partie (ex. client mécontent d'un seul des deux services
-- facturés). Cette migration ajoute :
--
--  1. `sales.refunded_cents` (cumulé) — 0 = jamais remboursé, < total_cents
--     = partiel (status reste `completed`), = total_cents = remboursement
--     intégral (status passe à `refunded`). Plusieurs partiels s'empilent
--     jusqu'à atteindre le total.
--
--  2. Backfill : les ventes déjà `refunded` reçoivent `refunded_cents =
--     total_cents` pour cohérence rétroactive.
--
--  3. Refactor du trigger `update_client_metrics_on_sale` — passe d'une
--     logique binaire (crédit total / débit total) à une logique
--     « différentielle » basée sur un crédit désiré reconstruit depuis l'état
--     courant : `desired = total_cents - refunded_cents` quand `completed`,
--     `0` sinon. Le trigger applique le DELTA entre l'ancien et le nouveau
--     crédit désiré → fonctionne pour INSERT, refund partiel (sans changer
--     le statut), refund total (status → refunded) et void.
--
--     `visits_count` garde la logique simple : +1 à la complétion initiale,
--     −1 à la transition completed → refunded/voided. Un remboursement
--     partiel ne décompte PAS la visite (le client est bien venu).
--
--  4. Index `sales_partial_refunded_idx` pour repérer rapidement les
--     ventes partiellement remboursées dans les KPIs Direction.
-- =============================================================================

alter table public.sales
  add column if not exists refunded_cents integer not null default 0
    check (refunded_cents >= 0);

comment on column public.sales.refunded_cents is
  'Montant cumulé remboursé en centimes. 0 = non remboursé. < total_cents = remboursement partiel (status reste completed). = total_cents = remboursement complet (status passe à refunded).';

-- Garde structurelle : on ne peut pas rembourser plus que le total facturé.
alter table public.sales
  drop constraint if exists sales_refunded_cents_max;
alter table public.sales
  add constraint sales_refunded_cents_max check (refunded_cents <= total_cents);

-- Backfill : les ventes déjà refunded sont 100 % remboursées par définition.
update public.sales
   set refunded_cents = total_cents
 where status = 'refunded'
   and refunded_cents = 0;

-- Index sparse pour le tableau de bord Direction (ventes partiellement
-- remboursées du jour/mois — minoritaires mais utiles à inspecter).
create index if not exists sales_partial_refunded_idx
  on public.sales (tenant_id, refunded_at desc)
  where refunded_cents > 0 and status = 'completed';

-- -----------------------------------------------------------------------------
-- Trigger refactorisé — modèle « crédit désiré ».
--
-- Pour chaque vente, on calcule la contribution actuellement attendue au
-- total_spent_cents du client :
--    desired = total_cents - refunded_cents si status = 'completed'
--    desired = 0                              sinon (refunded/voided/pending)
--
-- Le DELTA entre l'ancien `desired` et le nouveau est appliqué au client.
-- Idempotent : si rien ne change côté contribution (ex. update d'un champ
-- non lié), delta = 0 → pas d'écriture sur clients.
-- -----------------------------------------------------------------------------
create or replace function public.update_client_metrics_on_sale()
returns trigger
language plpgsql
as $$
declare
  desired_credit  integer;
  previous_credit integer;
  delta           integer;
  visits_delta    integer;
begin
  if new.client_id is null then
    return new;
  end if;

  -- Contribution attendue de la vente, après la mise à jour.
  desired_credit := case
    when new.status = 'completed' then new.total_cents - coalesce(new.refunded_cents, 0)
    else 0
  end;

  -- Contribution déjà comptabilisée AVANT cette mise à jour.
  --   - INSERT : rien n'a été crédité → 0
  --   - UPDATE depuis 'completed' : on avait crédité (total - refunded_cents)
  --   - UPDATE depuis 'pending' (encaissement post-réservation) : 0
  --   - UPDATE depuis 'refunded'/'voided' : déjà débité → 0 (le crédit
  --     précédent a été annulé). On ne re-crédite donc pas en reprenant à 0.
  previous_credit := case
    when tg_op = 'INSERT' then 0
    when old.status = 'completed' then old.total_cents - coalesce(old.refunded_cents, 0)
    else 0
  end;

  delta := desired_credit - previous_credit;

  -- Visites : créditer +1 à la complétion initiale (INSERT ou pending →
  -- completed), décréditer −1 à la transition completed → refunded/voided.
  -- Un refund partiel ne touche pas aux visites — le client est bien venu.
  visits_delta := 0;
  if (tg_op = 'INSERT' and new.status = 'completed')
     or (tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'completed')
  then
    visits_delta := 1;
  elsif tg_op = 'UPDATE'
        and old.status = 'completed' and new.status in ('refunded', 'voided')
  then
    visits_delta := -1;
  end if;

  if delta <> 0 or visits_delta <> 0 then
    update public.clients
       set total_spent_cents = greatest(0, total_spent_cents + delta),
           visits_count      = greatest(0, visits_count + visits_delta),
           last_seen_at      = case
                                 when delta > 0
                                   then greatest(last_seen_at, coalesce(new.completed_at, new.created_at))
                                 else last_seen_at
                               end,
           updated_at        = now()
     where id = new.client_id;
  end if;

  return new;
end;
$$;
