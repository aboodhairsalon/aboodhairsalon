-- =============================================================================
-- 0027_tenant_maps_url.sql — lien Google Maps personnalisé du salon
-- =============================================================================
--
-- Ajoute `maps_url` à `tenant_settings` : permet au gérant de coller son lien
-- de partage Google Maps (ex. `https://share.google/...` ou
-- `https://maps.app.goo.gl/...`) — l'épingle exacte de son salon, pas une
-- recherche par adresse.
--
-- Pourquoi : la recherche `maps.google.com/search/{adresse}` ne tombe pas
-- toujours sur le bon emplacement (adresses ambiguës, plusieurs branches).
-- Le lien de partage pointe sur l'épingle Google Business du salon → carte
-- correcte au premier clic, avis, horaires Google sync, etc.
--
-- Si NULL, l'UI client retombe sur la recherche par adresse (compat avec
-- les tenants existants qui n'ont pas encore configuré le lien).
-- =============================================================================

alter table public.tenant_settings
  add column if not exists maps_url text;

comment on column public.tenant_settings.maps_url is 'Lien Google Maps de partage (épingle exacte). Si NULL, l''UI client tombe sur la recherche par adresse.';
