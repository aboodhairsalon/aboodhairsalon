-- 0014_barber_reviews.sql
-- Notes des clients sur les barbiers.
--
-- Un avis est lié soit à un RDV (booking_id) soit à une vente directe (sale_id).
-- Contrainte : un seul avis par visite (index partiel UNIQUE).
-- Le rating est 1–5.

-- ─── 1. Ajouter client_phone dans sales (pour les ventes directes walk-in) ──
ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_phone text;

CREATE INDEX IF NOT EXISTS sales_client_phone_idx
  ON sales (tenant_id, client_phone)
  WHERE client_phone IS NOT NULL;

-- ─── 2. Table barber_reviews ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS barber_reviews (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  barber_id    uuid        NOT NULL,
  client_phone text        NOT NULL,
  booking_id   uuid        REFERENCES bookings(id) ON DELETE SET NULL,
  sale_id      uuid        REFERENCES sales(id) ON DELETE SET NULL,
  rating       smallint    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT barber_reviews_source_check CHECK (
    (booking_id IS NOT NULL) OR (sale_id IS NOT NULL)
  )
);

-- Un seul avis par booking
CREATE UNIQUE INDEX IF NOT EXISTS barber_reviews_booking_unique
  ON barber_reviews (booking_id)
  WHERE booking_id IS NOT NULL;

-- Un seul avis par vente directe
CREATE UNIQUE INDEX IF NOT EXISTS barber_reviews_sale_unique
  ON barber_reviews (sale_id)
  WHERE sale_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS barber_reviews_tenant_barber_idx
  ON barber_reviews (tenant_id, barber_id);

CREATE INDEX IF NOT EXISTS barber_reviews_phone_idx
  ON barber_reviews (tenant_id, client_phone);

-- ─── 3. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE barber_reviews ENABLE ROW LEVEL SECURITY;

-- Lecture/écriture pour users authentifiés du même tenant (Direction + caissier).
-- Les opérations client passent par l'admin client (bypass RLS).
CREATE POLICY barber_reviews_tenant_rw ON barber_reviews
  USING  (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);
