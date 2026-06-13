-- =============================================================================
-- 0044_sale_items_barber.sql — Coiffeur PAR ligne de vente (sale_items.barber_id)
--
-- Jusqu'ici une vente avait UN seul coiffeur (sales.barber_id). Le salon veut
-- choisir le coiffeur PAR prestation (une visite peut mêler plusieurs
-- coiffeurs : coupe par X + manucure par Gamila sur le même ticket).
--
-- On ajoute barber_id sur sale_items (nullable : produits sans coiffeur, et
-- ventes historiques). FK → staff (cohérent avec sales/bookings depuis 0012).
-- sales.barber_id est conservé (= coiffeur de la 1re prestation) pour ne pas
-- casser les stats par coiffeur existantes.
-- =============================================================================

alter table public.sale_items
  add column if not exists barber_id uuid references public.staff(id) on delete set null;

create index if not exists sale_items_barber_idx
  on public.sale_items (barber_id) where barber_id is not null;
