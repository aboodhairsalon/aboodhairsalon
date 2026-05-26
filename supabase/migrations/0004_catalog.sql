-- =============================================================================
-- 0004_catalog.sql — Services + Products (catalogue) + service_barbers + stock.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- services — prestations vendues par le salon
-- -----------------------------------------------------------------------------
create table public.services (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  name            text not null,
  description     text,
  duration_min    integer not null check (duration_min between 5 and 480),
  price_cents     integer not null check (price_cents >= 0),
  icon            text not null default 'scissors',          -- key for SERVICE_ICON map
  category        text,                                       -- e.g. "Coupe", "Barbe", "Couleur"
  is_active       boolean not null default true,
  requires_deposit boolean not null default false,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index services_tenant_idx  on public.services (tenant_id);
create index services_active_idx  on public.services (tenant_id, is_active) where is_active = true;

create trigger services_updated_at before update on public.services for each row execute function public.set_updated_at();
create trigger services_audit      after  insert or update or delete on public.services for each row execute function public.audit_changes();

alter table public.services enable row level security;

create policy services_isolation on public.services
  for all
  using (tenant_id = public.current_tenant_id() or public.is_super_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_super_admin());

create policy services_public_read on public.services
  for select
  to anon, authenticated
  using (is_active = true);

-- -----------------------------------------------------------------------------
-- service_barbers — M:N : quels barbiers offrent quelles prestations.
-- Si aucune ligne pour un service, on suppose qu'il est offert par TOUS les barbiers.
-- -----------------------------------------------------------------------------
create table public.service_barbers (
  service_id  uuid not null references public.services(id) on delete cascade,
  barber_id   uuid not null references public.barbers(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (service_id, barber_id)
);

create index service_barbers_barber_idx on public.service_barbers (barber_id);
create index service_barbers_tenant_idx on public.service_barbers (tenant_id);

alter table public.service_barbers enable row level security;

create policy service_barbers_isolation on public.service_barbers
  for all
  using (tenant_id = public.current_tenant_id() or public.is_super_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_super_admin());

create policy service_barbers_public_read on public.service_barbers
  for select
  to anon, authenticated
  using (true);

-- -----------------------------------------------------------------------------
-- products — vente / revente (pommade, huile à barbe, etc.)
-- -----------------------------------------------------------------------------
create table public.products (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  sku             text not null,
  name            text not null,
  description     text,
  price_cents     integer not null check (price_cents >= 0),
  cost_cents      integer check (cost_cents >= 0),     -- prix achat, pour marge
  stock           integer not null default 0,
  low_threshold   integer not null default 5,
  is_active       boolean not null default true,
  image_url       text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, sku)
);

create index products_tenant_idx     on public.products (tenant_id);
create index products_low_stock_idx  on public.products (tenant_id) where stock <= low_threshold;

create trigger products_updated_at before update on public.products for each row execute function public.set_updated_at();
create trigger products_audit      after  insert or update or delete on public.products for each row execute function public.audit_changes();

alter table public.products enable row level security;

create policy products_isolation on public.products
  for all
  using (tenant_id = public.current_tenant_id() or public.is_super_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_super_admin());

create policy products_public_read on public.products
  for select
  to anon, authenticated
  using (is_active = true);

-- -----------------------------------------------------------------------------
-- product_movements — append-only ledger des mouvements de stock.
-- Toute variation de stock passe par une ligne ici (vente, restock, ajustement, perte).
-- -----------------------------------------------------------------------------
create type product_movement_kind as enum ('sale', 'restock', 'adjustment', 'loss', 'return');

create table public.product_movements (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  product_id    uuid not null references public.products(id) on delete cascade,
  kind          product_movement_kind not null,
  qty_delta     integer not null,                   -- positif = entrée, négatif = sortie
  reference_id  uuid,                                -- pointe sur sale_id pour kind='sale'
  reason        text,
  actor_id      uuid,                                -- auth.uid() du caissier / direction
  created_at    timestamptz not null default now()
);

create index product_movements_product_idx on public.product_movements (product_id, created_at desc);
create index product_movements_tenant_idx  on public.product_movements (tenant_id, created_at desc);
create index product_movements_ref_idx     on public.product_movements (reference_id) where reference_id is not null;

alter table public.product_movements enable row level security;

create policy product_movements_isolation on public.product_movements
  for all
  using (tenant_id = public.current_tenant_id() or public.is_super_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_super_admin());

-- Trigger : à chaque INSERT de movement, mettre à jour products.stock.
create or replace function public.apply_product_movement()
returns trigger
language plpgsql
as $$
begin
  update public.products
     set stock = stock + new.qty_delta,
         updated_at = now()
   where id = new.product_id;
  return new;
end;
$$;

create trigger product_movements_apply
  after insert on public.product_movements
  for each row execute function public.apply_product_movement();
