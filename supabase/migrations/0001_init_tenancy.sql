-- =============================================================================
-- 0001_init_tenancy.sql — Foundation : extensions, helpers, audit_log,
-- tenants, tenant_branding, tenant_settings, super_admins.
--
-- Source de vérité : /docs/CLAUDE.md §MULTI-TENANCY.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
create extension if not exists "pgcrypto";  -- gen_random_uuid()
create extension if not exists "citext";    -- case-insensitive text (emails)
create extension if not exists "btree_gist"; -- exclusion constraints for booking overlap (used in 0005)

-- -----------------------------------------------------------------------------
-- Helper functions
-- -----------------------------------------------------------------------------

-- Extract tenant_id from the JWT (set by Supabase Auth Hook at sign-in).
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id', '')::uuid
$$;

-- Is the current user a super-admin ? (bypasses RLS on every table)
create or replace function public.is_super_admin()
returns boolean
language sql
stable
as $$
  select coalesce(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'is_super_admin')::boolean,
    false
  )
$$;

-- Standard updated_at touch trigger.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- audit_log — defined here (vs in 0006) because triggers below write to it.
-- =============================================================================
create table public.audit_log (
  id           bigserial primary key,
  tenant_id    uuid,                -- nullable for super-admin / cross-tenant actions
  actor_id     uuid,                -- auth.uid() at the time of the change
  table_name   text not null,
  row_id       text not null,       -- text to accept uuid / bigint / composite keys
  operation    text not null check (operation in ('INSERT','UPDATE','DELETE')),
  diff         jsonb,               -- {before, after} for UPDATE ; row for INSERT/DELETE
  at           timestamptz not null default now()
);

create index audit_log_tenant_idx on public.audit_log (tenant_id, at desc);
create index audit_log_table_idx  on public.audit_log (table_name, at desc);

alter table public.audit_log enable row level security;

create policy audit_log_tenant_select on public.audit_log
  for select
  using (
    tenant_id = public.current_tenant_id()
    or public.is_super_admin()
  );

-- No INSERT/UPDATE/DELETE policies — only triggers + service_role may write to audit_log.

-- Generic audit trigger function — to be attached selectively to sensitive tables.
create or replace function public.audit_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_actor_id  uuid;
begin
  v_actor_id := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;

  if (tg_op = 'DELETE') then
    v_tenant_id := coalesce((to_jsonb(old) ->> 'tenant_id')::uuid, null);
    insert into public.audit_log (tenant_id, actor_id, table_name, row_id, operation, diff)
    values (v_tenant_id, v_actor_id, tg_table_name, (to_jsonb(old) ->> 'id'), 'DELETE', to_jsonb(old));
    return old;
  elsif (tg_op = 'UPDATE') then
    v_tenant_id := coalesce((to_jsonb(new) ->> 'tenant_id')::uuid, null);
    insert into public.audit_log (tenant_id, actor_id, table_name, row_id, operation, diff)
    values (
      v_tenant_id, v_actor_id, tg_table_name, (to_jsonb(new) ->> 'id'), 'UPDATE',
      jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new))
    );
    return new;
  else
    v_tenant_id := coalesce((to_jsonb(new) ->> 'tenant_id')::uuid, null);
    insert into public.audit_log (tenant_id, actor_id, table_name, row_id, operation, diff)
    values (v_tenant_id, v_actor_id, tg_table_name, (to_jsonb(new) ->> 'id'), 'INSERT', to_jsonb(new));
    return new;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- tenants — the heart of multi-tenancy
-- -----------------------------------------------------------------------------
create type tenant_plan as enum ('starter', 'pro', 'business');
create type tenant_status as enum ('trial', 'active', 'past_due', 'canceled', 'suspended');

create table public.tenants (
  id                       uuid primary key default gen_random_uuid(),
  slug                     citext not null unique,
  name                     text not null,
  plan                     tenant_plan not null default 'starter',
  status                   tenant_status not null default 'trial',
  trial_ends_at            timestamptz,
  currency                 char(3) not null default 'EUR',
  timezone                 text not null default 'Europe/Paris',
  locale                   text not null default 'fr-FR',
  stripe_customer_id       text unique,
  stripe_subscription_id   text unique,
  stripe_connect_account_id text unique,
  stripe_connect_status    text,  -- 'pending' | 'enabled' | 'disabled' | 'rejected'
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint slug_format check (slug ~ '^[a-z0-9](-?[a-z0-9])*$' and length(slug) between 2 and 48)
);

create trigger tenants_updated_at  before update on public.tenants  for each row execute function public.set_updated_at();
create trigger tenants_audit       after  insert or update or delete on public.tenants for each row execute function public.audit_changes();

alter table public.tenants enable row level security;

-- A tenant can only read itself. Super-admin sees all.
create policy tenants_select on public.tenants
  for select
  using (id = public.current_tenant_id() or public.is_super_admin());

-- Only super-admin can INSERT/UPDATE/DELETE on tenants (signup via Edge Function w/ service_role).
create policy tenants_super_admin_write on public.tenants
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- tenant_branding — white-label customization
-- -----------------------------------------------------------------------------
create table public.tenant_branding (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null unique references public.tenants(id) on delete cascade,
  logo_url                    text,
  favicon_url                 text,
  brand_primary               text not null default '#D08C4F',  -- hex
  brand_glow                  text not null default '#E8A867',
  brand_deep                  text not null default '#9B5F26',
  custom_domain               citext unique,                    -- e.g. rdv.maison-lefevre.fr
  custom_domain_verified_at   timestamptz,
  footer_signature_enabled    boolean not null default true,    -- "Propulsé par System A" — false only on Business plan
  font_display                text,                              -- Business-only override
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index tenant_branding_tenant_idx on public.tenant_branding (tenant_id);
create unique index tenant_branding_custom_domain_idx on public.tenant_branding (custom_domain) where custom_domain is not null;

create trigger tenant_branding_updated_at before update on public.tenant_branding for each row execute function public.set_updated_at();
create trigger tenant_branding_audit      after  insert or update or delete on public.tenant_branding for each row execute function public.audit_changes();

alter table public.tenant_branding enable row level security;

create policy tenant_branding_isolation on public.tenant_branding
  for all
  using (tenant_id = public.current_tenant_id() or public.is_super_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_super_admin());

-- Anyone can read branding by custom_domain or by slug — needed for middleware tenant resolution
-- (anonymous request before login). Restricted to non-sensitive columns via SECURITY DEFINER fn (added jalon 1.5).

-- -----------------------------------------------------------------------------
-- tenant_settings — operational config per salon
-- -----------------------------------------------------------------------------
create table public.tenant_settings (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null unique references public.tenants(id) on delete cascade,
  tax_rate_bp              integer not null default 2000,  -- 20.00% TVA FR (basis points : 2000 = 20.00%)
  legal_name               text,
  legal_address            text,
  legal_siret              text,
  legal_tva_number         text,
  deposit_policy           jsonb not null default '{"enabled":false,"amount_cents":0,"percent":0}'::jsonb,
  cancellation_policy      jsonb not null default '{"min_hours":24,"fee_cents":0}'::jsonb,
  business_hours           jsonb not null default '[]'::jsonb,  -- [{dow:0-6, open:"09:00", close:"19:00"}]
  holidays                 jsonb not null default '[]'::jsonb,  -- [{date:"YYYY-MM-DD", label:string}]
  sms_enabled              boolean not null default false,
  loyalty_enabled          boolean not null default false,
  loyalty_ratio            integer not null default 100,         -- N cents → 1 point
  loyalty_redeem_threshold integer not null default 10,          -- 10 points = X € off (configured per tenant)
  reminder_sms_hours       integer not null default 24,
  reminder_email_hours     integer not null default 24,
  cleanup_minutes          integer not null default 5,            -- buffer entre RDV
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index tenant_settings_tenant_idx on public.tenant_settings (tenant_id);

create trigger tenant_settings_updated_at before update on public.tenant_settings for each row execute function public.set_updated_at();
create trigger tenant_settings_audit      after  insert or update or delete on public.tenant_settings for each row execute function public.audit_changes();

alter table public.tenant_settings enable row level security;

create policy tenant_settings_isolation on public.tenant_settings
  for all
  using (tenant_id = public.current_tenant_id() or public.is_super_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_super_admin());

-- -----------------------------------------------------------------------------
-- super_admins — internal team, bypass RLS on every table
-- -----------------------------------------------------------------------------
create table public.super_admins (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  email       citext not null unique,
  display_name text,
  created_at  timestamptz not null default now()
);

alter table public.super_admins enable row level security;

-- Only existing super-admins can read or write super_admins.
create policy super_admins_self_only on public.super_admins
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- Public lookup function for tenant branding — used by middleware (anon)
-- Returns only safe-to-expose columns. SECURITY DEFINER bypasses RLS.
-- -----------------------------------------------------------------------------
create or replace function public.lookup_tenant_branding(p_slug citext default null, p_domain citext default null)
returns table (
  tenant_id        uuid,
  slug             citext,
  name             text,
  logo_url         text,
  brand_primary    text,
  brand_glow       text,
  brand_deep       text,
  custom_domain    citext,
  footer_signature_enabled boolean
)
language sql
security definer
set search_path = public
as $$
  select t.id, t.slug, t.name, b.logo_url, b.brand_primary, b.brand_glow, b.brand_deep, b.custom_domain, b.footer_signature_enabled
  from public.tenants t
  join public.tenant_branding b on b.tenant_id = t.id
  where t.status in ('trial','active','past_due')
    and (
      (p_slug is not null and t.slug = p_slug)
      or (p_domain is not null and b.custom_domain = p_domain and b.custom_domain_verified_at is not null)
    )
  limit 1;
$$;

revoke all on function public.lookup_tenant_branding(citext, citext) from public;
grant execute on function public.lookup_tenant_branding(citext, citext) to anon, authenticated;
