-- =============================================================================
-- 0019_staff_photo.sql — photo de profil des membres du staff
-- =============================================================================
--
-- Ajoute `photo_url` à staff : photo de profil (data URL) affichée à la place
-- de l'avatar à initiales — équipe Direction, connexion caisse, réservation.
--
-- Colonne nullable → aucun staff existant n'est cassé.
-- =============================================================================

alter table public.staff
  add column if not exists photo_url text;

comment on column public.staff.photo_url is 'Photo de profil du membre (data URL) — remplace l''avatar à initiales si renseignée';
