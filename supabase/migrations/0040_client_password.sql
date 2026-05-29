-- 0040_client_password.sql
-- Authentification client par mot de passe (espace /client).
--
-- Ajoute un hash bcrypt OPTIONNEL sur client_profiles :
--   - NULL  → aucun mot de passe défini (client historique créé via booking,
--             ou jamais connecté à son espace) → l'UI propose « définir un
--             mot de passe » via un lien signé envoyé par email.
--   - non-NULL → bcrypt hash (jamais exposé côté client : sélectionné
--             uniquement par les Server Actions d'auth, jamais renvoyé à l'UI).
--
-- La connexion (email OU téléphone + mot de passe) délivre un token de session
-- signé (cf. _lib/client-token.ts) posé en cookie httpOnly ; toutes les
-- lectures de données client dérivent ensuite le téléphone de ce cookie vérifié
-- au lieu de faire confiance à un numéro fourni par le navigateur.
ALTER TABLE public.client_profiles
  ADD COLUMN IF NOT EXISTS password_hash text;

COMMENT ON COLUMN public.client_profiles.password_hash IS
  'bcrypt hash du mot de passe client (NULL = non défini). Jamais exposé à l''UI.';
