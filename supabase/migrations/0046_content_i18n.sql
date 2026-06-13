-- =============================================================================
-- 0046_content_i18n.sql — Contenu multilingue (noms FR/EN/AR)
--
-- Les libellés de contenu (noms de prestations, produits, sections) étaient
-- stockés en UN seul texte → ils ne suivaient pas la langue choisie (un client
-- AR voyait le nom FR, etc.). On stocke désormais chaque nom en 3 langues
-- (jsonb { fr, en, ar }) et on résout selon la locale au chargement.
--
--   services.name_i18n        { fr, en, ar }  (nom)
--   services.description_i18n { fr, en, ar }  (description)
--   products.name_i18n        { fr, en, ar }
--   tenants.category_i18n     { "<clé catégorie>": { fr, en, ar }, ... }
--
-- Les colonnes `name` / `description` / `category` restent comme repli (langue
-- d'origine + clé de regroupement des sections côté Direction). La résolution
-- (pickLocale) tombe sur `name` si la langue choisie n'a pas de traduction.
-- =============================================================================

alter table public.services
  add column if not exists name_i18n jsonb,
  add column if not exists description_i18n jsonb;

alter table public.products
  add column if not exists name_i18n jsonb;

alter table public.tenants
  add column if not exists category_i18n jsonb;
