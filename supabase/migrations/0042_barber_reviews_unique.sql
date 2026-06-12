-- 0042_barber_reviews_unique.sql
-- Empêche les avis EN DOUBLE sur une même visite (vente ou RDV) et fiabilise
-- la garde `alreadyReviewed` côté submitReview (qui dépend du code PG 23505).
--
-- Avant : `barber_reviews` n'avait qu'une PK (id). Le garde 23505 ne se
-- déclenchait jamais → l'exclusion d'un avis déjà laissé reposait UNIQUEMENT
-- sur getReviewableVisits côté lecture, fragile aux races (le client pouvait
-- se voir redemander de noter après un refresh mal timé).
--
-- Index partiels : un avis est unique par (tenant, vente) OU par (tenant, RDV).
-- ⚠️ Déjà appliqué en prod le 2026-06-12 via la Management API. Fichier pour
-- la traçabilité / reproductibilité.

create unique index if not exists barber_reviews_uniq_sale
  on public.barber_reviews (tenant_id, sale_id)
  where sale_id is not null;

create unique index if not exists barber_reviews_uniq_booking
  on public.barber_reviews (tenant_id, booking_id)
  where booking_id is not null;
