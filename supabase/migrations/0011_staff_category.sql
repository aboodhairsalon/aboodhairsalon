-- Migration 0011 : Ajouter la colonne `category` à la table `staff`.
-- Permet aux tenants de regrouper leurs barbiers / caissiers en sections
-- personnalisées dans l'onglet Équipe de /manager.
-- Colonne nullable (text) — null = "Sans section".
-- APPLIQUÉE AU PROJET LIVE le 2026-05-21 ; ce fichier est ré-ajouté après
-- le revert du commit bf7754f (rollback code uniquement, la colonne était restée).
alter table public.staff add column if not exists category text;
comment on column public.staff.category is
  'Section personnalisée définie par la Direction (null = sans section).';
