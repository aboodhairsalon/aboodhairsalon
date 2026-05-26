-- =============================================================================
-- 0036_tenant_settings_tax_default_zero.sql — Default TVA = 0
-- =============================================================================
--
-- Avant 0036 :
--   tenant_settings.tax_rate_bp default 2000  (20 %)
--
-- Ce default historique vient de la migration 0001 quand le projet ciblait la
-- France/UE (20 % VAT). Avec l'expansion en Égypte / Maroc / Tunisie où la
-- plupart des salons sont des petites entreprises non-assujetties, le
-- default de 20 % était dangereux : si un manager utilisait le champ TVA
-- pour la première fois sans le configurer à 0, il aurait reporté 20 %
-- de TVA sur ses tickets — déclaration impossible à corriger sans
-- intervention manuelle.
--
-- Le default 0 est plus sûr universellement :
--   - Petit salon non-assujetti (default majoritaire) → aucun affichage TVA.
--   - Salon assujetti → le manager renseigne explicitement le taux dans
--     Settings → Programme cashback → champ « Taux TVA (%) ».
--
-- Audit T5.25.
-- =============================================================================

ALTER TABLE public.tenant_settings
  ALTER COLUMN tax_rate_bp SET DEFAULT 0;

COMMENT ON COLUMN public.tenant_settings.tax_rate_bp IS
  'Taux TVA en basis points (2000 = 20%). 0 = pas de TVA affichée sur les reçus (default — sûr pour les petits salons non-assujettis). Le manager peut le configurer via Settings → champ « Taux TVA (%) ». Borné [0, 3000] = 0-30 %. Audit T5.25.';
