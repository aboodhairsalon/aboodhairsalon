-- =============================================================================
-- 0034_client_profiles_unique_email.sql — contrainte unique sur l'email
-- =============================================================================
--
-- Avant cette migration, deux profils du MÊME tenant pouvaient partager
-- un email (case-insensitive). Conséquences :
--
--  1. `getClientProfileByEmail` ramenait potentiellement plusieurs rows et
--     renvoyait `ambiguousEmail` à l'utilisateur sans moyen de résoudre.
--  2. `upsertClientProfile` sur (tenant_id, phone) pouvait créer un 2e profil
--     avec un email déjà utilisé par un autre numéro → identités floues
--     dans le programme fidélité (deux comptes, même email = deux soldes
--     cashback distincts).
--  3. Le check `checkClientPhoneAvailable` (côté signup) ne pouvait pas
--     déterminer si un email était déjà « pris » d'une façon fiable.
--
-- Cette migration ajoute :
--
--  - Un index unique partiel sur `(tenant_id, lower(email))` quand email
--    n'est pas NULL. NULL est exclu pour préserver les profils legacy
--    créés sans email (avant Loi « inscription obligatoire »).
--
--  - Index nommé `client_profiles_tenant_email_unique` — recherche directe
--    via `getClientProfileByEmail` accélérée (passe d'un seq-scan à un
--    index-scan immédiat).
--
-- Pré-check : aucune occurrence de duplicate vérifiée en prod sur le
-- tenant Aboodhairsalon (24 mai 2026) avant déploiement. La migration
-- échouera explicitement si un autre tenant a un doublon — investigation
-- manuelle requise avant déploiement.
--
-- Audit : T3.5
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS client_profiles_tenant_email_unique
  ON public.client_profiles (tenant_id, lower(email))
  WHERE email IS NOT NULL;
