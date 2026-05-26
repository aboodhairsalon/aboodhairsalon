-- =============================================================================
-- 0018_tenant_branch.sql — branche / quartier du salon
-- =============================================================================
--
-- Ajoute `branch` à tenant_settings : nom de la branche ou du quartier du
-- salon (ex. « San Stefano »), affiché à côté de la ville sur l'espace
-- réservation et l'onglet « Le Salon ».
--
-- Colonne nullable → aucun tenant existant n'est cassé.
-- =============================================================================

alter table public.tenant_settings
  add column if not exists branch text;

comment on column public.tenant_settings.branch is 'Nom de la branche / quartier du salon (ex. "San Stefano"), affiché à côté de la ville';
