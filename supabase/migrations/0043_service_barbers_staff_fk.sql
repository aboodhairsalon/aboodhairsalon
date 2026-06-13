-- =============================================================================
-- 0043_service_barbers_staff_fk.sql — Rewire service_barbers.barber_id → staff
--
-- La table `barbers` (0003) est dépréciée au profit de `staff` (0009). Les FK
-- bookings.barber_id et sales.barber_id ont été repointées vers `staff` par
-- 0012, mais `service_barbers.barber_id` (0004) était resté sur `barbers`
-- (table aujourd'hui vide). Comme on active enfin la fonctionnalité
-- « quels coiffeurs réalisent quelle prestation », on repointe cette FK vers
-- `staff` pour pouvoir y insérer des staff.id.
--
-- service_barbers est vide (0 ligne) → aucune migration de données.
-- Sémantique inchangée : AUCUNE ligne pour un service = offert par TOUS les
-- coiffeurs (cf. commentaire 0004).
-- =============================================================================

alter table public.service_barbers
  drop constraint if exists service_barbers_barber_id_fkey;

alter table public.service_barbers
  add constraint service_barbers_barber_id_fkey
  foreign key (barber_id) references public.staff(id) on delete cascade;
