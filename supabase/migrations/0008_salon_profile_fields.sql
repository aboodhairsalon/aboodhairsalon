-- =============================================================================
-- 0008_salon_profile_fields.sql — étendre tenant_settings pour le profil salon
-- =============================================================================
--
-- Le tab "Paramètres" de /manager affiche un profil salon riche
-- (tagline, contact, adresse complète, instagram). Le schéma actuel
-- ne couvrait que name (sur tenants), legal_name + legal_address (sur
-- tenant_settings). On ajoute le reste pour que tout puisse persister
-- en DB.
--
-- Toutes les colonnes nullable → la migration ne casse aucun tenant
-- existant. Defaults vides.
-- =============================================================================

alter table public.tenant_settings
  add column if not exists tagline           text,
  add column if not exists address_street    text,
  add column if not exists address_city      text,
  add column if not exists address_zip       text,
  add column if not exists contact_phone     text,
  add column if not exists contact_email     citext,
  add column if not exists contact_website   text,
  add column if not exists contact_instagram text,
  add column if not exists hours_text        text;

comment on column public.tenant_settings.tagline           is 'Sous-titre affiché à côté du nom du salon (ex. "Barbier — depuis 1947")';
comment on column public.tenant_settings.address_street    is 'Adresse rue + n° (47 rue Oberkampf)';
comment on column public.tenant_settings.address_city      is 'Ville';
comment on column public.tenant_settings.address_zip       is 'Code postal';
comment on column public.tenant_settings.contact_phone     is 'Téléphone principal du salon';
comment on column public.tenant_settings.contact_email     is 'Email public (différent de l''email de gérant Auth)';
comment on column public.tenant_settings.contact_website   is 'URL du site web (avec ou sans https://)';
comment on column public.tenant_settings.contact_instagram is 'Handle Instagram (@maison.lefevre) — sans @ idéalement';
comment on column public.tenant_settings.hours_text        is 'Horaires en texte libre (ex. "Mar–Sam · 10h–20h, fermé dim/lun"). Format structuré dans business_hours JSONB.';
