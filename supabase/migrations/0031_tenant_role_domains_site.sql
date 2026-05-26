-- Migration 0031 : ajouter '/site' aux role_path autorisés
--
-- Pourquoi : on veut router l'apex aboodhairsalon.com (et www.X.com)
-- vers une nouvelle page MARKETING du salon, pas vers l'espace réservation.
-- L'espace réservation reste sur book.X.com (déjà routé via 0030).
--
-- Avant : CHECK (role_path IN ('/client', '/cashier', '/manager'))
-- Après : CHECK (role_path IN ('/client', '/cashier', '/manager', '/site'))

ALTER TABLE public.tenant_role_domains
  DROP CONSTRAINT IF EXISTS tenant_role_domains_role_path_check;

ALTER TABLE public.tenant_role_domains
  ADD CONSTRAINT tenant_role_domains_role_path_check
  CHECK (role_path IN ('/client', '/cashier', '/manager', '/site'));
