-- =============================================================================
-- 0035_bookings_extras_jsonb.sql — extras d'un RDV stockés en JSONB
-- =============================================================================
--
-- Avant cette migration, les « extras » ajoutés à un RDV en caisse (via le
-- modal AddExtras dans Rendez-vous) étaient stockés UNIQUEMENT en mémoire
-- React (state local de CashierApp). Conséquences :
--
--  1. Refresh navigateur OU changement de device = extras perdus → la
--     caissière les avait ajoutés mais l'encaissement ne les facture pas.
--  2. Deux caissières en parallèle ne voient pas leurs ajouts respectifs
--     (un seul des deux carnets sera persisté à l'encaissement).
--  3. Pas d'audit possible des extras pré-paiement (ils n'existaient
--     en DB qu'au moment de la facturation, mêlés aux sale_items).
--
-- Cette migration ajoute une colonne JSONB `extras` sur `bookings`, avec
-- la même structure que celle utilisée côté front (`BookingExtra[]`) :
--
--   [
--     {
--       "key": "service-uuid-timestamp",
--       "kind": "service" | "product",
--       "refId": "uuid",
--       "name": "Beard trim",
--       "priceCents": 5000,
--       "qty": 1
--     },
--     ...
--   ]
--
-- Pourquoi JSONB plutôt qu'une table `booking_extras` séparée :
--  - Lecture/écriture atomique avec le booking (pas de cascade ou orphans).
--  - Simplicité d'API : un seul UPDATE pour replace la liste complète.
--  - Pas de jointure dans les listings (la perf scan reste linéaire sur
--    bookings de toute façon).
--  - Les contraintes sur la forme sont validées côté Server Action (Zod),
--    le DB n'en a pas besoin pour ce cas d'usage.
--
-- Audit : T2.9
-- =============================================================================

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS extras jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.bookings.extras IS
  'Liste JSONB des extras ajoutés au RDV avant encaissement. Chaque item : {key, kind: ''service''|''product'', refId, name, priceCents, qty}. Persisté pour survivre aux refresh/changements de device. Vidé non automatiquement à l''encaissement (audit trail).';
