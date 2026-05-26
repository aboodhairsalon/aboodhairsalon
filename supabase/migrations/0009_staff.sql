-- =============================================================================
-- 0009_staff.sql — table `staff` unifiée (D-021)
-- =============================================================================
--
-- Modèle : une personne du salon = 1 ligne `staff` avec ses rôles
-- (`roles staff_role[]`). Polyvalence native — un barbier peut aussi
-- tenir la caisse. Cf. D-021 dans /docs/DECISIONS.md.
--
-- La table `barbers` (migration 0003) reste en place pour ne pas casser
-- les FK existantes (barber_schedules, barber_time_off, service_barbers,
-- bookings.barber_id) — elle est DÉPRÉCIÉE au profit de `staff`. Le pont
-- staff ↔ bookings sera fait au Jalon 5 (refonte du modèle réservation).
-- Cf. D-023.
-- =============================================================================

create type staff_role as enum ('barber', 'cashier');
create type barber_grade as enum ('Apprenti', 'Barbier', 'Senior', 'Maître barbier');

create table public.staff (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null,
  initials      text not null,
  tone          text not null default '#D08C4F',     -- couleur d'identification (avatar)
  is_active     boolean not null default true,
  phone         text,
  email         text,
  roles         staff_role[] not null default '{barber}'::staff_role[],
  barber_grade  barber_grade,                          -- pertinent si 'barber' ∈ roles
  shift         text,                                  -- plage horaire si 'cashier' ∈ roles
  commission_bp integer not null default 4000,         -- basis points : 4000 = 40 %
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Invariant D-021 : au moins un rôle. Une personne sans rôle doit être supprimée.
  constraint staff_roles_not_empty check (array_length(roles, 1) >= 1),
  constraint staff_initials_length check (length(initials) between 1 and 3)
);

create index staff_tenant_idx        on public.staff (tenant_id);
create index staff_tenant_active_idx on public.staff (tenant_id, is_active);
-- Index GIN pour filtrer rapidement par rôle (where 'cashier' = any(roles)).
create index staff_roles_idx         on public.staff using gin (roles);

create trigger staff_updated_at before update on public.staff
  for each row execute function public.set_updated_at();
create trigger staff_audit after insert or update or delete on public.staff
  for each row execute function public.audit_changes();

alter table public.staff enable row level security;

-- Isolation tenant stricte : un user ne voit/édite que le staff de son salon.
create policy staff_isolation on public.staff
  for all
  using (tenant_id = public.current_tenant_id() or public.is_super_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_super_admin());

-- Lecture publique (anon) : le booking flow client a besoin de lister les
-- barbiers actifs sans être authentifié. On expose donc un SELECT public,
-- comme pour `barbers`/`services` (cf. 0003/0004).
create policy staff_public_read on public.staff
  for select
  to anon, authenticated
  using (true);

comment on table public.staff is
  'Personnel du salon — modèle unifié D-021. roles staff_role[] : un humain peut être barbier ET caissier. Remplace barbers (déprécié).';
