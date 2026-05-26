-- =============================================================================
-- 0025_sales_trigger_no_double_credit.sql — empêche le double-crédit
-- =============================================================================
--
-- Bug remonté par l'audit-2 sur la migration 0023 :
--
--   Cycle `completed → voided → completed` :
--     - Bloc 1 (crédit) déclenche au 1er completed (INSERT ou
--       old.status != completed). ✓
--     - Bloc 2 (débit) déclenche au passage completed → voided. ✓ Crédits
--       remboursés.
--     - Bloc 1 RE-DÉCLENCHE au passage voided → completed (parce que
--       old.status = 'voided' ≠ 'completed'). ✗ DOUBLE CRÉDIT.
--
-- Fix : on suit explicitement le "déjà crédité" via les transitions. Une
-- vente nouvellement complétée ne crédite QUE depuis un état "non encore
-- comptabilisé" (NULL via INSERT, 'pending' via un cycle), pas depuis
-- 'voided' ou 'refunded' qui ont déjà bénéficié d'un crédit + débit.
--
-- Si un admin veut réactiver une vente voidée, le bon chemin est de créer
-- une nouvelle vente — pas de réactiver l'ancienne. La transition reste
-- techniquement permise par l'enum sale_status, mais elle ne re-crédite
-- plus le client.
-- =============================================================================

create or replace function public.update_client_metrics_on_sale()
returns trigger
language plpgsql
as $$
begin
  -- 1. Vente nouvellement complétée → créditer
  --    Conditions strictes : INSERT direct en 'completed' OU transition
  --    UPDATE depuis 'pending' (cas d'un encaissement après pré-autorisation).
  --    On exclut explicitement les transitions depuis 'refunded' et 'voided'
  --    pour éviter un double-crédit sur les cycles d'annulation/réactivation.
  if new.client_id is not null and new.status = 'completed'
     and (
       tg_op = 'INSERT'
       or (tg_op = 'UPDATE' and old.status = 'pending')
     )
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
  --    qu'UNE seule fois quel que soit le statut final.
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
