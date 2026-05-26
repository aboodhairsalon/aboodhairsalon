-- =============================================================================
-- 0007_auth_hook.sql — Custom Access Token Hook (Jalon 1)
-- =============================================================================
--
-- Supabase Auth signe un JWT à chaque sign-in / refresh. Ce hook intercepte
-- l'événement et lift `app_metadata.tenant_id` (+ `is_super_admin`) au niveau
-- top du JWT, là où `current_tenant_id()` et `is_super_admin()` les lisent.
--
-- Doc Supabase : https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook
--
-- Activation requise après cette migration :
--   Dashboard → Authentication → Hooks → Custom Access Token Hook
--   → Enable + sélectionner `public.custom_access_token_hook`
--   OU
--   PATCH /v1/projects/{ref}/config/auth { hook_custom_access_token_uri: 'pg-functions://postgres/public/custom_access_token_hook', hook_custom_access_token_enabled: true }
--
-- Workflow utilisateur :
--   1. User est créé via auth.admin.createUser({ email, app_metadata: { tenant_id, is_super_admin? } })
--   2. User sign-in → Supabase appelle ce hook avec event.claims
--   3. Hook lit claims.app_metadata.tenant_id et injecte claims.tenant_id
--   4. JWT retourné contient tenant_id au top-level
--   5. RLS via current_tenant_id() lit le claim → filtre les rows
-- =============================================================================

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  tenant_uuid uuid;
  is_super boolean;
begin
  claims := event->'claims';

  -- Lift tenant_id depuis app_metadata si présent et valide
  tenant_uuid := nullif(claims->'app_metadata'->>'tenant_id', '')::uuid;
  if tenant_uuid is not null then
    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(tenant_uuid::text));
  end if;

  -- Lift is_super_admin (bypasse RLS sur toutes les tables — usage admin platform uniquement)
  is_super := coalesce((claims->'app_metadata'->>'is_super_admin')::boolean, false);
  if is_super then
    claims := jsonb_set(claims, '{is_super_admin}', to_jsonb(true));
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
exception
  when others then
    -- Sécurité : si le hook fail, on retourne l'event original sans modif.
    -- L'utilisateur sera authentifié mais sans tenant_id → RLS bloquera ses accès,
    -- ce qui est plus sûr qu'un sign-in totalement bloqué.
    return event;
end;
$$;

-- Supabase Auth s'exécute sous le rôle `supabase_auth_admin`. Il faut lui donner
-- explicitement le droit d'appeler la fonction. revoke des autres rôles pour
-- éviter les abus (un anon ne doit pas pouvoir invoquer ce hook directement).
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

comment on function public.custom_access_token_hook(jsonb) is
  'Supabase Auth Custom Access Token Hook — lifts app_metadata.tenant_id and is_super_admin to top-level JWT claims. Activate in Dashboard → Authentication → Hooks. Cf. /docs/CLAUDE.md §MULTI-TENANCY.';
