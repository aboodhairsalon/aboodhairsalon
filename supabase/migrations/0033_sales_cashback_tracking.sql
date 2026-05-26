-- =============================================================================
-- 0033_sales_cashback_tracking.sql — traçabilité du cashback débité par vente
-- =============================================================================
--
-- Avant cette migration, lorsque la caissière appliquait du cashback à un
-- encaissement, `client_profiles.cashback_redeemed_cents` était incrémenté
-- du montant débité MAIS `sales.total_cents` restait le PRIX BRUT (avant
-- cashback). Conséquences :
--
--  1. Trou de caisse cash systématique : le KPI caisse affichait le brut,
--     la caisse réelle contenait moins → écart inexplicable au DayClose.
--  2. Impossibilité de re-créditer correctement le cashback à un refund :
--     aucune trace de combien avait été débité sur CETTE vente précisément.
--  3. KPI Direction faussé : le CA affiché incluait le cashback consommé
--     (qui n'est pas du cash entrant).
--
-- Cette migration :
--
--  1. Ajoute `sales.cashback_redeemed_cents` (cumulatif n'a pas de sens —
--     c'est le montant débité POUR cette vente, fixé à la création).
--
--  2. Convention d'utilisation à partir de maintenant côté server actions
--     (`createDirectSale`, `payBooking`) :
--        subtotal_cents = items + extras + supplément (BRUT)
--        cashback_redeemed_cents = montant cashback débité
--        total_cents = subtotal_cents − cashback_redeemed_cents (NET cash)
--        tip_cents toujours à part (ne compte ni dans subtotal ni total)
--
--  3. Refund : `refundSale` lit `cashback_redeemed_cents` et recrédite
--     proportionnellement le `client_profiles.cashback_redeemed_cents`
--     selon le ratio `refundAmount / total_cents`.
--
-- Réversible : `ALTER TABLE public.sales DROP COLUMN cashback_redeemed_cents;`
-- =============================================================================

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS cashback_redeemed_cents integer NOT NULL DEFAULT 0
    CHECK (cashback_redeemed_cents >= 0);

COMMENT ON COLUMN public.sales.cashback_redeemed_cents IS
  'Montant de cashback débité au moment de cette vente (en centimes). Déduit de total_cents (qui devient le net cash encaissé). À recréditer proportionnellement au refund_cents lors d''un remboursement.';
