-- =============================================================================
-- 0020_sales_client_name.sql — nom du client sur une vente
-- =============================================================================
--
-- Ajoute `client_name` à sales : nom du client rattaché à une vente directe
-- (ou recopié depuis le RDV à l'encaissement). Visible « sur le ticket » —
-- récap caisse et historique des encaissements.
--
-- Colonne nullable → aucune vente existante n'est cassée.
-- =============================================================================

alter table public.sales
  add column if not exists client_name text;

comment on column public.sales.client_name is 'Nom du client rattaché à la vente (snapshot) — saisi en caisse ou recopié du RDV';
