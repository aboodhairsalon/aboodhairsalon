-- 0041_restrict_anon_pii.sql
-- Audit sécurité : le rôle `anon` (clé publique, présente dans le bundle
-- navigateur) pouvait lire TOUTES les colonnes de `staff` et `products` via
-- PostgREST — dont des données sensibles :
--   staff   : email, phone, commission_bp, user_id
--   products: cost_cents (marge)
-- L'app ne lit JAMAIS ces tables via anon (tous les reads passent par le
-- service-role / createAdminClient), donc restreindre anon ne casse rien.
--
-- On retire le GRANT SELECT table-level d'anon et on re-grant uniquement les
-- colonnes publiquement nécessaires (noms/photos des barbiers pour le booking,
-- catalogue produits sans le coût).
--
-- ⚠️ Déjà appliqué en prod le 2026-06-12 via la Management API. Ce fichier
-- existe pour la traçabilité / reproductibilité (nouvel environnement).

-- ── staff ────────────────────────────────────────────────────────────────────
revoke select on public.staff from anon;
grant select (
  id, tenant_id, name, initials, tone, photo_url, roles,
  barber_grade, category, shift, sort_order, is_active, created_at, updated_at
) on public.staff to anon;

-- ── products ─────────────────────────────────────────────────────────────────
revoke select on public.products from anon;
grant select (
  id, tenant_id, sku, name, description, price_cents, stock,
  low_threshold, is_active, image_url, created_at, updated_at
) on public.products to anon;
