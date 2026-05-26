-- 0013_client_profiles.sql
-- Profils clients + points de fidélité.
--
-- 1. Ajoute client_phone dans bookings pour relier RDV ↔ profil.
-- 2. Crée client_profiles (id par tenant + téléphone).
-- 3. RLS tenant-isolé + trigger updated_at.

-- ─── 1. Colonne client_phone dans bookings ──────────────────────────────────
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS client_phone text;

CREATE INDEX IF NOT EXISTS bookings_client_phone_idx
  ON bookings (tenant_id, client_phone)
  WHERE client_phone IS NOT NULL;

-- ─── 2. Table client_profiles ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_profiles (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone         text        NOT NULL,
  first_name    text,
  last_name     text,
  date_of_birth date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone)
);

CREATE INDEX IF NOT EXISTS client_profiles_tenant_idx
  ON client_profiles (tenant_id);

-- ─── 3. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE client_profiles ENABLE ROW LEVEL SECURITY;

-- Accessible par tout utilisateur authentifié du même tenant (Direction + caissier).
-- Les opérations client (non authentifiées) passent par l'admin client (bypass RLS).
CREATE POLICY client_profiles_tenant_rw ON client_profiles
  USING  (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- ─── 4. Trigger updated_at ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_client_profiles_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_profiles_set_updated_at ON client_profiles;
CREATE TRIGGER client_profiles_set_updated_at
  BEFORE UPDATE ON client_profiles
  FOR EACH ROW EXECUTE FUNCTION trg_client_profiles_updated_at();
