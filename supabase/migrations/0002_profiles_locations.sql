-- =============================================================================
-- 0002_profiles_locations.sql — Global identity + per-tenant locations + links.
--
-- profiles  : 1 row per auth.users (global, owned by the user)
-- locations : per-tenant establishments (multi-salon supported by Business plan)
-- client_tenant_links : a profile's memberships across tenants
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles — global identity (NO tenant_id : a user is a person, not a tenant resource)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         citext not null unique,
  full_name     text,
  phone         text,
  avatar_url    text,
  locale        text not null default 'fr-FR',
  marketing_opt_in boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger profiles_audit      after  insert or update or delete on public.profiles for each row execute function public.audit_changes();

alter table public.profiles enable row level security;

-- A user can read & update only their own profile.
create policy profiles_own on public.profiles
  for all
  using (id = (select auth.uid()) or public.is_super_admin())
  with check (id = (select auth.uid()) or public.is_super_admin());

-- -----------------------------------------------------------------------------
-- locations — physical establishments. 1 by default ; many for Business plan.
-- -----------------------------------------------------------------------------
create table public.locations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  is_primary  boolean not null default false,
  address     text,
  city        text,
  zip         text,
  country     char(2) not null default 'FR',
  latitude    numeric(9,6),
  longitude   numeric(9,6),
  phone       text,
  email       citext,
  timezone    text,                       -- override tenants.timezone if multi-tz franchise
  business_hours jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index locations_tenant_idx on public.locations (tenant_id);
create unique index locations_tenant_primary_idx on public.locations (tenant_id) where is_primary = true;

create trigger locations_updated_at before update on public.locations for each row execute function public.set_updated_at();
create trigger locations_audit      after  insert or update or delete on public.locations for each row execute function public.audit_changes();

alter table public.locations enable row level security;

create policy locations_isolation on public.locations
  for all
  using (tenant_id = public.current_tenant_id() or public.is_super_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_super_admin());

-- Public read for client-facing booking page (anon needs to display location info).
create policy locations_public_read on public.locations
  for select
  to anon, authenticated
  using (true);  -- safe : locations table holds no sensitive data ; refine if needed

-- -----------------------------------------------------------------------------
-- client_tenant_links — N:M membership profiles ↔ tenants
-- A profile can be a customer of several salons (Antoine déménage à Lyon).
-- -----------------------------------------------------------------------------
create type client_link_status as enum ('active', 'banned', 'opted_out');

create table public.client_tenant_links (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  status        client_link_status not null default 'active',
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (profile_id, tenant_id)
);

create index client_tenant_links_profile_idx on public.client_tenant_links (profile_id);
create index client_tenant_links_tenant_idx  on public.client_tenant_links (tenant_id);

create trigger client_tenant_links_updated_at before update on public.client_tenant_links for each row execute function public.set_updated_at();
create trigger client_tenant_links_audit      after  insert or update or delete on public.client_tenant_links for each row execute function public.audit_changes();

alter table public.client_tenant_links enable row level security;

-- Profile owner can see their own memberships.
create policy client_tenant_links_self on public.client_tenant_links
  for select
  using (profile_id = (select auth.uid()) or public.is_super_admin());

-- Tenant staff can see all links belonging to their tenant.
create policy client_tenant_links_tenant_read on public.client_tenant_links
  for select
  using (tenant_id = public.current_tenant_id() or public.is_super_admin());

-- INSERT happens through Edge Function (signup or first booking) ; UPDATE/DELETE only by tenant staff or self.
create policy client_tenant_links_self_write on public.client_tenant_links
  for all
  using (profile_id = (select auth.uid()) or public.is_super_admin())
  with check (profile_id = (select auth.uid()) or public.is_super_admin());

create policy client_tenant_links_tenant_write on public.client_tenant_links
  for all
  using (tenant_id = public.current_tenant_id() or public.is_super_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_super_admin());
