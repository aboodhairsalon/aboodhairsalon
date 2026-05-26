-- =============================================================================
-- 0005_bookings_sales.sql — Le cœur métier : clients, bookings, sales, sale_items.
--
-- Anti-doublure : exclusion constraint sur (barber_id, [starts_at, ends_at[)
-- empêche structurellement les double-bookings. Cf. /docs/CLAUDE.md §RISQUES.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- clients — fiche tenant-scoped (un profile peut avoir plusieurs clients,
-- un par tenant). Supporte aussi les walk-ins (profile_id null).
-- -----------------------------------------------------------------------------
create table public.clients (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  profile_id        uuid references public.profiles(id) on delete set null,
  display_name      text not null,
  phone             text,
  email             citext,
  notes             text,                                  -- privé direction/barbier
  tags              text[] not null default '{}',          -- segmentation marketing
  total_spent_cents bigint not null default 0,
  visits_count      integer not null default 0,
  loyalty_points    integer not null default 0,
  reliability_score smallint not null default 100,         -- 0-100, baisse à chaque no-show
  banned            boolean not null default false,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, profile_id)                            -- 1 fiche par profile par tenant
);

create index clients_tenant_idx      on public.clients (tenant_id);
create index clients_profile_idx     on public.clients (profile_id);
create index clients_email_idx       on public.clients (tenant_id, email) where email is not null;
create index clients_phone_idx       on public.clients (tenant_id, phone) where phone is not null;
create index clients_last_seen_idx   on public.clients (tenant_id, last_seen_at desc);

create trigger clients_updated_at before update on public.clients for each row execute function public.set_updated_at();
create trigger clients_audit      after  insert or update or delete on public.clients for each row execute function public.audit_changes();

alter table public.clients enable row level security;

create policy clients_isolation on public.clients
  for all
  using (tenant_id = public.current_tenant_id() or public.is_super_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_super_admin());

-- Un profile owner peut lire sa propre fiche client (pour "Mes RDV").
create policy clients_own_profile_read on public.clients
  for select
  using (profile_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- bookings — RDV, structurellement protégés contre les doublures
-- -----------------------------------------------------------------------------
create type booking_status as enum ('upcoming', 'in_chair', 'done', 'cancelled', 'no_show');
create type booking_source as enum ('client_app', 'cashier', 'walk_in', 'manager', 'waitlist', 'widget');

create table public.bookings (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  location_id         uuid references public.locations(id) on delete set null,
  service_id          uuid not null references public.services(id),
  barber_id           uuid not null references public.barbers(id),
  client_id           uuid references public.clients(id) on delete set null,
  client_display_name text not null,                       -- snapshot (walk-in ne nécessite pas client_id)
  client_phone        text,
  client_email        citext,
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  status              booking_status not null default 'upcoming',
  source              booking_source not null default 'client_app',
  amount_cents        integer not null check (amount_cents >= 0),    -- snapshot du prix au moment du RDV
  deposit_cents       integer not null default 0 check (deposit_cents >= 0),
  paid                boolean not null default false,
  payment_intent_id   text,                                 -- Stripe PI pour acompte
  cancellation_reason text,
  notes               text,
  reminder_sent_at    timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint bookings_chronology check (ends_at > starts_at)
);

create index bookings_tenant_starts_idx  on public.bookings (tenant_id, starts_at);
create index bookings_barber_starts_idx  on public.bookings (barber_id, starts_at);
create index bookings_client_idx         on public.bookings (client_id);
create index bookings_status_idx         on public.bookings (tenant_id, status) where status in ('upcoming','in_chair');
create index bookings_unpaid_idx         on public.bookings (tenant_id) where paid = false and status in ('done','in_chair');

-- LA contrainte critique : empêche structurellement les double-bookings d'un même barbier.
-- Les RDV cancelled/no_show ne comptent pas (un slot annulé doit pouvoir être réutilisé).
alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    barber_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status not in ('cancelled', 'no_show'));

create trigger bookings_updated_at before update on public.bookings for each row execute function public.set_updated_at();
create trigger bookings_audit      after  insert or update or delete on public.bookings for each row execute function public.audit_changes();

alter table public.bookings enable row level security;

create policy bookings_isolation on public.bookings
  for all
  using (tenant_id = public.current_tenant_id() or public.is_super_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_super_admin());

-- Un client peut lire ses propres bookings (via profile_id sur la fiche clients liée).
create policy bookings_own_read on public.bookings
  for select
  using (
    exists (
      select 1 from public.clients c
      where c.id = bookings.client_id
        and c.profile_id = (select auth.uid())
    )
  );

-- -----------------------------------------------------------------------------
-- sales — encaissements (POS rapide ou paiement post-RDV)
-- -----------------------------------------------------------------------------
create type sale_method as enum ('card', 'cash', 'mobile', 'gift_card', 'split', 'comp');
create type sale_status as enum ('pending', 'completed', 'refunded', 'voided');

create table public.sales (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  location_id         uuid references public.locations(id) on delete set null,
  barber_id           uuid references public.barbers(id) on delete set null,   -- vendeur affecté
  cashier_id          uuid references auth.users(id) on delete set null,        -- caisse user
  client_id           uuid references public.clients(id) on delete set null,
  booking_id          uuid references public.bookings(id) on delete set null,
  offline_client_id   uuid unique,                                              -- idempotency key pour POS offline
  status              sale_status not null default 'completed',
  method              sale_method not null,
  subtotal_cents      integer not null check (subtotal_cents >= 0),
  discount_cents      integer not null default 0 check (discount_cents >= 0),
  tax_cents           integer not null default 0 check (tax_cents >= 0),
  tip_cents           integer not null default 0 check (tip_cents >= 0),
  total_cents         integer not null check (total_cents >= 0),
  payment_intent_id   text unique,
  receipt_email_sent  boolean not null default false,
  notes               text,
  created_at          timestamptz not null default now(),
  completed_at        timestamptz,
  updated_at          timestamptz not null default now()
);

create index sales_tenant_created_idx on public.sales (tenant_id, created_at desc);
create index sales_barber_idx          on public.sales (barber_id);
create index sales_client_idx          on public.sales (client_id);
create index sales_booking_idx         on public.sales (booking_id) where booking_id is not null;

create trigger sales_updated_at before update on public.sales for each row execute function public.set_updated_at();
create trigger sales_audit      after  insert or update or delete on public.sales for each row execute function public.audit_changes();

alter table public.sales enable row level security;

create policy sales_isolation on public.sales
  for all
  using (tenant_id = public.current_tenant_id() or public.is_super_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_super_admin());

-- Un client peut voir ses propres tickets (pour reçus).
create policy sales_own_read on public.sales
  for select
  using (
    exists (
      select 1 from public.clients c
      where c.id = sales.client_id
        and c.profile_id = (select auth.uid())
    )
  );

-- -----------------------------------------------------------------------------
-- sale_items — lignes de chaque vente (service + produit + remise ligne)
-- -----------------------------------------------------------------------------
create type sale_item_kind as enum ('service', 'product', 'discount', 'gift_card_redeem');

create table public.sale_items (
  id              uuid primary key default gen_random_uuid(),
  sale_id         uuid not null references public.sales(id) on delete cascade,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  kind            sale_item_kind not null,
  service_id      uuid references public.services(id) on delete set null,
  product_id      uuid references public.products(id) on delete set null,
  name            text not null,                                  -- snapshot
  qty             integer not null default 1 check (qty > 0),
  unit_price_cents integer not null,                              -- signé : remise = négatif
  total_cents     integer not null,
  created_at      timestamptz not null default now()
);

create index sale_items_sale_idx    on public.sale_items (sale_id);
create index sale_items_product_idx on public.sale_items (product_id);
create index sale_items_service_idx on public.sale_items (service_id);
create index sale_items_tenant_idx  on public.sale_items (tenant_id);

alter table public.sale_items enable row level security;

create policy sale_items_isolation on public.sale_items
  for all
  using (tenant_id = public.current_tenant_id() or public.is_super_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_super_admin());

-- -----------------------------------------------------------------------------
-- Trigger : à la complétion d'une vente, mettre à jour les métriques client.
-- -----------------------------------------------------------------------------
create or replace function public.update_client_metrics_on_sale()
returns trigger
language plpgsql
as $$
begin
  if new.client_id is not null and new.status = 'completed'
     and (tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.status != 'completed'))
  then
    update public.clients
       set total_spent_cents = total_spent_cents + new.total_cents,
           visits_count      = visits_count + 1,
           last_seen_at      = greatest(last_seen_at, coalesce(new.completed_at, new.created_at)),
           updated_at        = now()
     where id = new.client_id;
  end if;
  return new;
end;
$$;

create trigger sales_update_client_metrics
  after insert or update on public.sales
  for each row execute function public.update_client_metrics_on_sale();

-- -----------------------------------------------------------------------------
-- Trigger : à l'INSERT d'un sale_item kind='product', écrire un product_movement
-- (sortie de stock). Le trigger 0004:apply_product_movement met à jour le stock.
-- -----------------------------------------------------------------------------
create or replace function public.record_product_sale_movement()
returns trigger
language plpgsql
as $$
begin
  if new.kind = 'product' and new.product_id is not null then
    insert into public.product_movements (tenant_id, product_id, kind, qty_delta, reference_id, reason)
    values (new.tenant_id, new.product_id, 'sale', -new.qty, new.sale_id, 'Vente caisse');
  end if;
  return new;
end;
$$;

create trigger sale_items_record_movement
  after insert on public.sale_items
  for each row execute function public.record_product_sale_movement();
