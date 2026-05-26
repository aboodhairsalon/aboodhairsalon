-- =============================================================================
-- 0012_booking_staff_fk.sql — Rewire bookings + sales barber_id FK → staff (D-023)
--
-- La table `barbers` (migration 0003) est dépréciée au profit de `staff` (0009).
-- On rewire les FK pour que les nouvelles réservations/ventes référencent `staff`.
-- Les colonnes deviennent nullable (walk-in sans barbier assigné).
-- =============================================================================

-- bookings.barber_id → staff(id)
alter table public.bookings drop constraint bookings_barber_id_fkey;
alter table public.bookings alter column barber_id drop not null;
alter table public.bookings add constraint bookings_staff_fkey
  foreign key (barber_id) references public.staff(id) on delete set null;

-- sales.barber_id → staff(id)
alter table public.sales drop constraint sales_barber_id_fkey;
alter table public.sales add constraint sales_staff_fkey
  foreign key (barber_id) references public.staff(id) on delete set null;
