-- =============================================================================
-- 0023_sales_voided_trigger.sql — étend le trigger refund aux ventes voidées
-- =============================================================================
--
-- Le trigger `update_client_metrics_on_sale` (cf. 0005 + 0021) ne décrémente
-- les compteurs client qu'à la transition `completed → refunded`. Mais
-- `sale_status` accepte aussi `voided` — qui peut être posé par d'autres
-- chemins (script de réconciliation, opération manuelle DB). Sans ce patch,
-- une vente passée en `voided` continuait à créditer total_spent_cents et
-- visits_count → trou comptable.
--
-- On garde la fonction propre : completed → (refunded OR voided) décrémente
-- les métriques une seule fois (le filtre sur `old.status = completed`
-- empêche tout re-débit lors d'une transition voided → refunded ou refunded
-- → voided, où `old.status` ne serait pas `completed`).
-- =============================================================================

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

  -- 2. Vente complétée puis remboursée OU voidée → débiter (réversible).
  --    Le filtre sur `old.status = 'completed'` garantit qu'on ne débite
  --    qu'UNE seule fois quel que soit le statut final (refunded ou voided),
  --    et qu'aucun débit ne se produit sur une transition refunded → voided.
  if tg_op = 'UPDATE'
     and old.status = 'completed' and new.status in ('refunded', 'voided')
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
