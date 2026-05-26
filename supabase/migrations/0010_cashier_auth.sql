-- =============================================================================
-- 0010_cashier_auth.sql — Accès caissier (Jalon 5, bloc 1)
-- =============================================================================
--
-- La Direction crée un accès de connexion (email + mot de passe) pour un
-- membre du staff ayant le rôle « cashier ». Le caissier se connecte sur
-- /cashier ; aucune auto-inscription.
--
-- Cette migration pose le socle :
--   1. `staff.user_id` — lien vers le compte Supabase Auth du caissier.
--   2. Hook JWT étendu — lift `role` (→ claim `user_role`) et `staff_id`,
--      en plus de `tenant_id` / `is_super_admin`.
--
-- Le compte caissier est créé via `auth.admin.createUser` avec :
--   app_metadata = { tenant_id, role: 'cashier', staff_id }
-- Le hook ci-dessous remonte ces valeurs au top-level du JWT → la garde de
-- route (`/cashier` vs `/manager`) et les futures policies RLS par rôle
-- peuvent les lire.
--
-- NB : le claim top-level est nommé `user_role` et NON `role` — `role` est
-- un claim réservé (PostgREST l'utilise pour le rôle Postgres). L'écraser
-- casserait l'authentification.
-- =============================================================================

-- ── 1) Lien staff ↔ compte d'authentification ───────────────────────────────
alter table public.staff
  add column if not exists user_id uuid references auth.users(id) on delete set null;

-- Un compte auth est lié à au plus une fiche staff (index partiel : plusieurs
-- staff peuvent avoir user_id NULL = pas d'accès login).
create unique index if not exists staff_user_id_key on public.staff (user_id)
  where user_id is not null;

comment on column public.staff.user_id is
  'Compte Supabase Auth lié — caissier avec accès caisse configuré. NULL = aucun accès login.';

-- ── 2) Hook JWT — ajoute user_role + staff_id ───────────────────────────────
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  tenant_uuid uuid;
  is_super boolean;
  user_role text;
  staff_uuid uuid;
begin
  claims := event->'claims';

  -- tenant_id (cf. 0007)
  tenant_uuid := nullif(claims->'app_metadata'->>'tenant_id', '')::uuid;
  if tenant_uuid is not null then
    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(tenant_uuid::text));
  end if;

  -- is_super_admin (cf. 0007)
  is_super := coalesce((claims->'app_metadata'->>'is_super_admin')::boolean, false);
  if is_super then
    claims := jsonb_set(claims, '{is_super_admin}', to_jsonb(true));
  end if;

  -- role applicatif (manager | cashier) → claim `user_role` (pas `role`, réservé)
  user_role := nullif(claims->'app_metadata'->>'role', '');
  if user_role is not null then
    claims := jsonb_set(claims, '{user_role}', to_jsonb(user_role));
  end if;

  -- staff_id — relie le caissier connecté à sa fiche staff
  staff_uuid := nullif(claims->'app_metadata'->>'staff_id', '')::uuid;
  if staff_uuid is not null then
    claims := jsonb_set(claims, '{staff_id}', to_jsonb(staff_uuid::text));
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
exception
  when others then
    -- Sécurité : en cas d'échec, retourne l'event original. L'utilisateur est
    -- authentifié mais sans claims → RLS bloque ses accès (fail-safe).
    return event;
end;
$$;

-- Permissions inchangées (cf. 0007) — Supabase Auth tourne sous supabase_auth_admin.
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

comment on function public.custom_access_token_hook(jsonb) is
  'Custom Access Token Hook — lift tenant_id, is_super_admin, user_role, staff_id au top-level du JWT. Cf. 0007 + 0010.';
