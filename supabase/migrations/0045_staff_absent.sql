-- =============================================================================
-- 0045_staff_absent.sql — Présence/absence d'un coiffeur (staff.is_absent)
--
-- Le salon veut pouvoir marquer un coiffeur ABSENT (maladie, imprévu) depuis
-- la Direction ET la Caisse, pour qu'aucun client ne le réserve tant qu'il
-- n'est pas revenu. Bascule manuelle (pas de dates) : remis à `false` au
-- retour. Distinct de `is_active` (= membre de l'équipe / archivé).
--
-- false (défaut) = présent. true = absent → masqué à la réservation + grisé
-- en caisse.
-- =============================================================================

alter table public.staff
  add column if not exists is_absent boolean not null default false;
