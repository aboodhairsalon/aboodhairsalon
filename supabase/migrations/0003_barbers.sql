-- =============================================================================
-- 0003_barbers.sql — Staff : barbers, weekly schedules, time-off.
--
-- service_barbers (M:N entre services et barbiers) est dans 0004 pour respecter
-- l'ordre des dépendances (services créés en 0004).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- barbers
-- -----------------------------------------------------------------------------
create type barber_role as enum ('apprentice', 'barber', 'senior', 'master');

create table public.barbers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  location_id  uuid references public.locations(id) on delete set null,
  profile_id   uuid references public.profiles(id) on delete set null,
  display_name text not null,
  initials     text not null,             -- "A" pour Antoine, "K" pour Karim — affichage avatar
  tone         text not null default '#D08C4F',  -- couleur barbier dans les vues planning
  role         barber_role not null default 'barber',
  bio          text,
  photo_url    text,
  commission_bp integer not null default 0,  -- basis points : 4000 = 40% commission sur prestations
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint barbers_initials_length check (length(initials) between 1 and 3)
);

create index barbers_tenant_idx   on public.barbers (tenant_id);
create index barbers_location_idx on public.barbers (location_id);
create index barbers_active_idx   on public.barbers (tenant_id, is_active) where is_active = true;

create trigger barbers_updated_at before update on public.barbers for each row execute function public.set_updated_at();
create trigger barbers_audit      after  insert or update or delete on public.barbers for each row execute function public.audit_changes();

alter table public.barbers enable row level security;

create policy barbers_isolation on public.barbers
  for all
  using (tenant_id = public.current_tenant_id() or public.is_super_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_super_admin());

-- Public read for booking flow (client needs to choose a barbier before login).
create policy barbers_public_read on public.barbers
  for select
  to anon, authenticated
  using (is_active = true);

-- -----------------------------------------------------------------------------
-- barber_schedules — recurring weekly schedule per barber.
-- Multiple rows per (barber, day_of_week) supported (e.g. 09:00-12:00 + 14:00-19:00).
-- -----------------------------------------------------------------------------
create table public.barber_schedules (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  barber_id    uuid not null references public.barbers(id) on delete cascade,
  day_of_week  integer not null check (day_of_week between 0 and 6),  -- 0=Sun, 6=Sat
  start_time   time not null,
  end_time     time not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint schedule_chronology check (end_time > start_time)
);

create index barber_schedules_barber_idx on public.barber_schedules (barber_id, day_of_week);
create index barber_schedules_tenant_idx on public.barber_schedules (tenant_id);

create trigger barber_schedules_updated_at before update on public.barber_schedules for each row execute function public.set_updated_at();

alter table public.barber_schedules enable row level security;

create policy barber_schedules_isolation on public.barber_schedules
  for all
  using (tenant_id = public.current_tenant_id() or public.is_super_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_super_admin());

create policy barber_schedules_public_read on public.barber_schedules
  for select
  to anon, authenticated
  using (true);

-- -----------------------------------------------------------------------------
-- barber_time_off — specific date ranges (congés, formation, maladie).
-- Used by the slot-computation algorithm to mark unavailability.
-- -----------------------------------------------------------------------------
create type time_off_kind as enum ('vacation', 'sick', 'training', 'unpaid', 'other');

create table public.barber_time_off (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  barber_id    uuid not null references public.barbers(id) on delete cascade,
  kind         time_off_kind not null default 'vacation',
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  reason       text,
  approved     boolean not null default true,  -- approuvé par direction
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint time_off_chronology check (ends_at > starts_at),
  -- exclusion : un barbier ne peut pas avoir 2 congés qui se chevauchent (réservé btree_gist activé en 0001)
  exclude using gist (
    barber_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
);

create index barber_time_off_barber_idx on public.barber_time_off (barber_id, starts_at, ends_at);
create index barber_time_off_tenant_idx on public.barber_time_off (tenant_id);

create trigger barber_time_off_updated_at before update on public.barber_time_off for each row execute function public.set_updated_at();
create trigger barber_time_off_audit      after  insert or update or delete on public.barber_time_off for each row execute function public.audit_changes();

alter table public.barber_time_off enable row level security;

create policy barber_time_off_isolation on public.barber_time_off
  for all
  using (tenant_id = public.current_tenant_id() or public.is_super_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_super_admin());
