-- =============================================================================
-- 0038_tenant_email_from.sql — email sender personnalisé par tenant
-- =============================================================================
--
-- Pourquoi : actuellement TOUS les emails partent de `noreply@system-aone.com`
-- avec le nom du salon comme display name (`Aboodhairsalon <noreply@system-aone.com>`).
-- Le client voit donc :
--   From: Aboodhairsalon <noreply@system-aone.com>
--
-- Problème :
--   1. Apparence : un client qui lit attentivement voit `system-aone.com` →
--      friction de confiance (« c'est qui System A ? je connais que mon salon »).
--   2. Réponse : si le client clique « Reply », ça part vers notre boîte
--      générique (qu'on monitore pas). Le salon ne reçoit jamais le retour.
--   3. SEO/Délivrabilité : DKIM signé par system-aone.com, pas par le salon.
--      Mauvais pour la réputation domaine quand on scale.
--
-- Solution : permettre à chaque tenant de configurer son `email_from_address`
-- propre (ex. `noreply@aboodhairsalon.com`). Le sender devient alors :
--   From: Aboodhairsalon <noreply@aboodhairsalon.com>
--
-- PRÉ-REQUIS DNS (côté tenant) :
-- Pour que Resend accepte d'envoyer depuis `aboodhairsalon.com`, le domaine
-- doit être vérifié dans le dashboard Resend du compte System A :
--   1. Resend dashboard → Domains → Add Domain → aboodhairsalon.com
--   2. Copier les 3 records DNS (DKIM + SPF + DMARC) → poser dans IONOS
--   3. Cliquer Verify dans Resend (24h max pour propagation DNS)
--   4. Mettre à jour tenant_settings.email_from_address
--
-- FALLBACK : si NULL → email_from = process.env.RESEND_FROM_EMAIL (fallback
-- noreply@system-aone.com) — comportement actuel préservé.
-- =============================================================================

ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS email_from_address text NULL
    CHECK (
      email_from_address IS NULL
      OR email_from_address ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    );

COMMENT ON COLUMN public.tenant_settings.email_from_address IS
  'Adresse expéditeur pour les emails transactionnels (ex. noreply@aboodhairsalon.com). NULL = fallback sur RESEND_FROM_EMAIL (noreply@system-aone.com). PRÉ-REQUIS : domaine vérifié dans Resend dashboard (DKIM + SPF + DMARC dans DNS). Sans vérif Resend rejette l''envoi.';

-- Pre-populate pour Aboodhairsalon — leur DNS sera à valider côté Resend.
-- Si Resend rejette (domain not verified), les emails échoueront silencieusement
-- (loggés via reportError). Le RDV/refund DB reste valide.
UPDATE public.tenant_settings
  SET email_from_address = 'noreply@aboodhairsalon.com'
  WHERE tenant_id = 'fa508622-b027-4907-9508-afd2e9f83eeb';
