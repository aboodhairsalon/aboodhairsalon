-- Migration 0030 : multi-domaines par tenant avec rôle implicite
--
-- Problème résolu : `tenant_branding.custom_domain` est 1-to-1. Pour
-- Aboodhairsalon (lancement marketing T-48h) on veut 3 subdomains, chacun
-- routé vers un espace différent dès la racine :
--
--   book.aboodhairsalon.com    → /client    (espace réservation public)
--   cashier.aboodhairsalon.com → /cashier   (espace caisse staff)
--   manager.aboodhairsalon.com → /manager   (espace direction)
--
-- Cette table associe N (hostname, role_path) à 1 tenant. Le middleware
-- l'utilise pour le rewrite interne du root `/` selon le subdomain.
--
-- L'ancien `tenant_branding.custom_domain` reste pour compat. La row est
-- aussi dupliquée ici par migration pour unifier la résolution.

CREATE TABLE IF NOT EXISTS public.tenant_role_domains (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  /** Hostname exact (FQDN). Case-insensitive grâce à citext. Unique global. */
  hostname     citext NOT NULL UNIQUE,
  /** Chemin de rewrite quand l'URL est juste `/` sur ce hostname.
   *  Limité aux 3 espaces de l'app pour éviter les paths arbitraires. */
  role_path    text NOT NULL DEFAULT '/client'
    CHECK (role_path IN ('/client', '/cashier', '/manager')),
  /** Timestamp de vérification (preuve de contrôle du domaine — DNS publié).
   *  Le resolver ignore les rows non vérifiées (sécurité : empêche un
   *  attaquant de squatter un domaine en attendant que la victime achète). */
  verified_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_role_domains_tenant_id_idx
  ON public.tenant_role_domains(tenant_id);

-- Index pour le hot-path RPC (lookup par hostname filtré sur verified).
CREATE INDEX IF NOT EXISTS tenant_role_domains_hostname_verified_idx
  ON public.tenant_role_domains(hostname)
  WHERE verified_at IS NOT NULL;

-- RLS : lecture publique (anon) car le resolver tourne sans session.
-- L'écriture est réservée au service_role (server actions admin).
ALTER TABLE public.tenant_role_domains ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_role_domains_public_read
  ON public.tenant_role_domains
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Migrate l'existant : chaque tenant_branding.custom_domain vérifié devient
-- une row aliasée avec role_path = '/client' (comportement legacy).
INSERT INTO public.tenant_role_domains (tenant_id, hostname, role_path, verified_at)
SELECT tenant_id, custom_domain::citext, '/client', custom_domain_verified_at
FROM public.tenant_branding
WHERE custom_domain IS NOT NULL AND custom_domain_verified_at IS NOT NULL
ON CONFLICT (hostname) DO NOTHING;

-- Comment pour documentation in-DB.
COMMENT ON TABLE public.tenant_role_domains IS
  'Multi-domain support per tenant. Each row maps a hostname to a tenant + role_path. Used by middleware to route subdomains (book/cashier/manager) to the right space at root /. Resolver only matches verified rows.';

-- Étend le RPC `lookup_tenant_branding` pour aussi matcher via cette table.
-- Le retour inclut désormais role_path (null si matched par slug ou custom_domain).
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
  /** Chemin par défaut quand le visiteur arrive sur `/` du hostname matché.
   *  Vient de `tenant_role_domains.role_path` si lookup par p_domain,
   *  sinon NULL (lookup par p_slug). Le middleware retombe sur '/client'
   *  pour les anciens paths qui ne fournissent pas role_path. */
  role_path                  text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Branche 1 : lookup par slug (mode path-based historique app.system-aone.com/{slug}).
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

  -- Branche 2 : lookup par hostname via la nouvelle table multi-domain.
  -- Précédence sur l'ancien `tenant_branding.custom_domain` car la nouvelle
  -- table porte le role_path explicite.
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

  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.lookup_tenant_branding(citext, citext) FROM public;
GRANT EXECUTE ON FUNCTION public.lookup_tenant_branding(citext, citext)
  TO anon, authenticated;

COMMENT ON FUNCTION public.lookup_tenant_branding(citext, citext) IS
  'Resolver-facing tenant lookup. Branch 1: by slug (path-based mode). Branch 2: by hostname via tenant_role_domains (custom domains, multi-subdomain support). Returns role_path on branch 2 for the middleware to rewrite root `/` to the right space.';
