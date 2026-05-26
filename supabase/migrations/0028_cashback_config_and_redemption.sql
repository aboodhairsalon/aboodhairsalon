-- =============================================================================
-- 0028_cashback_config_and_redemption.sql — cashback configurable + redemption
-- =============================================================================
--
-- Deux ajouts liés au programme cashback :
--
-- 1. `tenant_settings.cashback_rate_bp` : taux personnalisable par salon en
--    basis points (250 = 2,5 %). Default 250 pour préserver le comportement
--    actuel des tenants existants. Bornes raisonnables : 0 (désactivé) à 1500
--    (15 %). Au-delà ce serait une promo absurde — la validation Zod côté
--    Server Action borne plus strictement.
--
-- 2. `client_profiles.cashback_redeemed_cents` : compteur du cashback déjà
--    utilisé par le client à la caisse. Le solde disponible affiché côté
--    client = `earned - redeemed`. Pas de stockage du `earned` lui-même car
--    il se recalcule à la volée depuis bookings+sales (source de vérité
--    déjà en place dans getClientProfile).
--
-- Pourquoi BP (basis points) plutôt que float : pas de bug d'arrondi
-- flottant sur les calculs financiers. 250 est exact, 0.025 ne l'est pas
-- toujours. Pattern utilisé partout dans Stripe / les systèmes bancaires.
-- =============================================================================

alter table public.tenant_settings
  add column if not exists cashback_rate_bp integer not null default 250
    check (cashback_rate_bp >= 0 and cashback_rate_bp <= 1500);

comment on column public.tenant_settings.cashback_rate_bp is
  'Taux de cashback en basis points (250 = 2,5 %). Borné DB à [0, 1500] (0-15 %).';

alter table public.client_profiles
  add column if not exists cashback_redeemed_cents bigint not null default 0
    check (cashback_redeemed_cents >= 0);

comment on column public.client_profiles.cashback_redeemed_cents is
  'Cashback déjà utilisé par le client à la caisse. Solde disponible = earned - redeemed.';

-- Index partiel pour le profil-client retrieval avec activité de cashback,
-- utile pour les futurs reports manager (clients qui utilisent activement
-- leur cashback vs ceux qui accumulent).
create index if not exists client_profiles_cashback_redeemed_idx
  on public.client_profiles (tenant_id, cashback_redeemed_cents)
  where cashback_redeemed_cents > 0;
