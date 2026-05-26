-- 0015_client_profiles_email.sql
-- Ajoute le champ email aux profils clients.
-- Permet à la Direction de voir et contacter ses clients par email.

ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS email text;
