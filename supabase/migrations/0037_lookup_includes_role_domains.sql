-- =============================================================================
-- 0037_lookup_includes_role_domains.sql — RPC retourne aussi role_domains
-- =============================================================================
--
-- Pourquoi : middleware doit savoir QUEL hostname utiliser pour chaque rôle
-- quand il fait la redirection canonique. Cas concret :
--   Tenant Aboodhairsalon avec 5 role_domains :
--     book.aboodhairsalon.com    → /client
--     cashier.aboodhairsalon.com → /cashier
--     manager.aboodhairsalon.com → /manager
--     aboodhairsalon.com          → /site
--     www.aboodhairsalon.com     → /site
--
-- Quand un visiteur arrive sur `app.system-aone.com/aboodhairsalon/cashier`,
-- on veut redirect vers `cashier.aboodhairsalon.com/`. Le mapping role→host
-- n'est pas devinable à partir de `tenant_branding.custom_domain` qui ne
-- porte qu'UN seul hostname.
--
-- Solution : ajouter `role_domains` JSONB au retour du RPC, format :
--   [
--     {"hostname": "book.aboodhairsalon.com", "role_path": "/client"},
--     {"hostname": "cashier.aboodhairsalon.com", "role_path": "/cashier"},
--     {"hostname": "manager.aboodhairsalon.com", "role_path": "/manager"},
--     {"hostname": "aboodhairsalon.com", "role_path": "/site"},
--     {"hostname": "www.aboodhairsalon.com", "role_path": "/site"}
--   ]
--
-- Le middleware itère sur ce tableau pour trouver le hostname correspondant
-- au role_path demandé. Aucun roundtrip supplémentaire.
--
-- NB : seules les rows `verified_at IS NOT NULL` sont incluses (sécurité +
-- cohérence avec branch 2 du RPC existant).
-- =============================================================================

DROP FUNCTION IF EXISTS public.lookup_tenant_branding(citext, citext);

CREATE FUNCTION public.lookup_tenant_branding(
  p_slug   citext DEFAULT NULL,
  p_domain citext DEFAULT NULL
)
RETURNS TABLE (
  tenant_id                  uuid,
  slug                       citext,
  name                       text,
  brand_primary              text,
  brand_glow                 text,
  brand_deep                 text,
  custom_domain              citext,
  footer_signature_enabled   boolean,
  role_path                  text,
  /** Tous les hostname vérifiés du tenant + leur role_path. Format JSON :
   *  [{"hostname": "book.x.com", "role_path": "/client"}, ...]
   *  Vide si le tenant n'a aucun custom domain configuré. */
  role_domains               jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    -- Branche 1 : lookup par slug (mode path-based historique).
    SELECT
      t.id           AS tenant_id,
      t.slug,
      t.name,
      b.brand_primary,
      b.brand_glow,
      b.brand_deep,
      b.custom_domain,
      b.footer_signature_enabled,
      NULL::text     AS role_path
    FROM public.tenants t
    JOIN public.tenant_branding b ON b.tenant_id = t.id
    WHERE t.status IN ('trial', 'active', 'past_due')
      AND p_slug IS NOT NULL
      AND t.slug = p_slug

    UNION ALL

    -- Branche 2 : lookup par hostname via tenant_role_domains.
    SELECT
      t.id                AS tenant_id,
      t.slug,
      t.name,
      b.brand_primary,
      b.brand_glow,
      b.brand_deep,
      b.custom_domain,
      b.footer_signature_enabled,
      a.role_path
    FROM public.tenant_role_domains a
    JOIN public.tenants t          ON t.id = a.tenant_id
    JOIN public.tenant_branding b  ON b.tenant_id = t.id
    WHERE t.status IN ('trial', 'active', 'past_due')
      AND p_domain IS NOT NULL
      AND a.hostname = p_domain
      AND a.verified_at IS NOT NULL

    LIMIT 1
  )
  SELECT
    base.tenant_id,
    base.slug,
    base.name,
    base.brand_primary,
    base.brand_glow,
    base.brand_deep,
    base.custom_domain,
    base.footer_signature_enabled,
    base.role_path,
    COALESCE(
      (
        SELECT jsonb_agg(jsonb_build_object('hostname', rd.hostname::text, 'role_path', rd.role_path))
        FROM public.tenant_role_domains rd
        WHERE rd.tenant_id = base.tenant_id
          AND rd.verified_at IS NOT NULL
      ),
      '[]'::jsonb
    ) AS role_domains
  FROM base;
$$;

REVOKE ALL ON FUNCTION public.lookup_tenant_branding(citext, citext) FROM public;
GRANT EXECUTE ON FUNCTION public.lookup_tenant_branding(citext, citext)
  TO anon, authenticated;

COMMENT ON FUNCTION public.lookup_tenant_branding(citext, citext) IS
  'Resolver-facing tenant lookup. Branch 1: by slug (path-based). Branch 2: by hostname via tenant_role_domains. Always returns role_domains jsonb array of all verified host→role mappings for the tenant — middleware uses this for canonical redirects.';
