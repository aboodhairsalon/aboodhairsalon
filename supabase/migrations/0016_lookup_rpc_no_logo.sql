-- Migration 0016 : retirer logo_url de lookup_tenant_branding
--
-- Raison : la RPC est appelée par le middleware Edge à chaque requête.
-- logo_url stocke un data URI base64 (~400 KB), ce qui :
--   1. Allonge la réponse de la RPC de ~400 KB → latence middleware ~5 s
--   2. Provoque un crash lors du setHeader (limite Node.js ~8 KB par header)
--
-- Le logo est chargé séparément côté frontend (auth-server.ts, client/data.ts)
-- via des requêtes DB authentifiées. Il n'a pas sa place dans ce lookup public.

-- DROP requis car on change le type de retour (suppression logo_url).
-- Les grants sont reposés juste après.
drop function if exists public.lookup_tenant_branding(citext, citext);

create function public.lookup_tenant_branding(
  p_slug   citext default null,
  p_domain citext default null
)
returns table (
  tenant_id                uuid,
  slug                     citext,
  name                     text,
  brand_primary            text,
  brand_glow               text,
  brand_deep               text,
  custom_domain            citext,
  footer_signature_enabled boolean
)
language sql
security definer
set search_path = public
as $$
  select
    t.id,
    t.slug,
    t.name,
    b.brand_primary,
    b.brand_glow,
    b.brand_deep,
    b.custom_domain,
    b.footer_signature_enabled
  from public.tenants t
  join public.tenant_branding b on b.tenant_id = t.id
  where t.status in ('trial', 'active', 'past_due')
    and (
      (p_slug   is not null and t.slug          = p_slug)
      or (p_domain is not null and b.custom_domain = p_domain
          and b.custom_domain_verified_at is not null)
    )
  limit 1;
$$;

revoke all on function public.lookup_tenant_branding(citext, citext) from public;
grant execute on function public.lookup_tenant_branding(citext, citext) to anon, authenticated;
