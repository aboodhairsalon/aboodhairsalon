-- =============================================================================
-- 0006_extras.sql — Extras : gift_cards, loyalty_balances, reviews,
-- usage_metrics, stripe_events.
--
-- audit_log + audit_changes() sont déjà dans 0001 (besoin pour triggers précédents).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- gift_cards — cartes cadeaux digitales (jalon 7)
-- -----------------------------------------------------------------------------
create type gift_card_status as enum ('active', 'redeemed', 'expired', 'voided');

create table public.gift_cards (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  code                  text not null,                       -- QR-scannable code
  initial_value_cents   integer not null check (initial_value_cents > 0),
  remaining_value_cents integer not null check (remaining_value_cents >= 0),
  status                gift_card_status not null default 'active',
  purchaser_client_id   uuid references public.clients(id) on delete set null,
  beneficiary_email     citext,
  beneficiary_name      text,
  message               text,
  expires_at            timestamptz,
  purchased_via_sale_id uuid references public.sales(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (tenant_id, code)
);

create index gift_cards_tenant_idx     on public.gift_cards (tenant_id);
create index gift_cards_code_idx       on public.gift_cards (tenant_id, code);
create index gift_cards_active_idx     on public.gift_cards (tenant_id) where status = 'active';

create trigger gift_cards_updated_at before update on public.gift_cards for each row execute function public.set_updated_at();
create trigger gift_cards_audit      after  insert or update or delete on public.gift_cards for each row execute function public.audit_changes();

alter table public.gift_cards enable row level security;

create policy gift_cards_isolation on public.gift_cards
  for all
  using (tenant_id = public.current_tenant_id() or public.is_super_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_super_admin());

-- -----------------------------------------------------------------------------
-- loyalty_balances — historique points fidélité par client (append-only)
-- -----------------------------------------------------------------------------
create type loyalty_event_kind as enum ('earned', 'redeemed', 'adjusted', 'expired');

create table public.loyalty_balances (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  kind        loyalty_event_kind not null,
  delta       integer not null,                              -- positif = earned, négatif = redeemed
  reference_id uuid,                                          -- sale_id, booking_id, ...
  reason      text,
  created_at  timestamptz not null default now()
);

create index loyalty_balances_client_idx on public.loyalty_balances (client_id, created_at desc);
create index loyalty_balances_tenant_idx on public.loyalty_balances (tenant_id, created_at desc);

alter table public.loyalty_balances enable row level security;

create policy loyalty_balances_isolation on public.loyalty_balances
  for all
  using (tenant_id = public.current_tenant_id() or public.is_super_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_super_admin());

-- Trigger : à chaque insert d'event, synchroniser clients.loyalty_points.
create or replace function public.apply_loyalty_delta()
returns trigger
language plpgsql
as $$
begin
  update public.clients
     set loyalty_points = greatest(0, loyalty_points + new.delta),
         updated_at = now()
   where id = new.client_id;
  return new;
end;
$$;

create trigger loyalty_balances_apply
  after insert on public.loyalty_balances
  for each row execute function public.apply_loyalty_delta();

-- -----------------------------------------------------------------------------
-- reviews — avis clients post-RDV
-- -----------------------------------------------------------------------------
create table public.reviews (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  booking_id    uuid not null unique references public.bookings(id) on delete cascade,
  client_id     uuid references public.clients(id) on delete set null,
  barber_id     uuid references public.barbers(id) on delete set null,
  rating        smallint not null check (rating between 1 and 5),
  comment       text,
  is_public     boolean not null default false,
  responded_at  timestamptz,
  response      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index reviews_tenant_idx  on public.reviews (tenant_id, created_at desc);
create index reviews_barber_idx  on public.reviews (barber_id) where barber_id is not null;
create index reviews_rating_idx  on public.reviews (tenant_id, rating);

create trigger reviews_updated_at before update on public.reviews for each row execute function public.set_updated_at();
create trigger reviews_audit      after  insert or update or delete on public.reviews for each row execute function public.audit_changes();

alter table public.reviews enable row level security;

create policy reviews_isolation on public.reviews
  for all
  using (tenant_id = public.current_tenant_id() or public.is_super_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_super_admin());

create policy reviews_public_read on public.reviews
  for select
  to anon, authenticated
  using (is_public = true);

-- -----------------------------------------------------------------------------
-- usage_metrics — capture des métriques d'usage pour facturation + admin platform
-- -----------------------------------------------------------------------------
create table public.usage_metrics (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  metric_date date not null,
  bookings_count    integer not null default 0,
  sales_count       integer not null default 0,
  revenue_cents     bigint  not null default 0,
  active_barbers    integer not null default 0,
  sms_sent          integer not null default 0,
  emails_sent       integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, metric_date)
);

create index usage_metrics_tenant_date_idx on public.usage_metrics (tenant_id, metric_date desc);

create trigger usage_metrics_updated_at before update on public.usage_metrics for each row execute function public.set_updated_at();

alter table public.usage_metrics enable row level security;

create policy usage_metrics_isolation on public.usage_metrics
  for all
  using (tenant_id = public.current_tenant_id() or public.is_super_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_super_admin());

-- -----------------------------------------------------------------------------
-- stripe_events — idempotency table pour webhooks Stripe
-- =============================================================================
create table public.stripe_events (
  event_id    text primary key,                              -- evt_xxx, vient du payload Stripe
  tenant_id   uuid references public.tenants(id) on delete set null,
  type        text not null,                                  -- e.g. 'invoice.paid', 'account.updated'
  api_version text,
  livemode    boolean not null default false,
  payload     jsonb not null,
  processed_at timestamptz,
  error       text,
  received_at timestamptz not null default now()
);

create index stripe_events_type_idx     on public.stripe_events (type, received_at desc);
create index stripe_events_tenant_idx   on public.stripe_events (tenant_id) where tenant_id is not null;
create index stripe_events_pending_idx  on public.stripe_events (received_at) where processed_at is null;

alter table public.stripe_events enable row level security;

-- Webhooks insèrent via service_role (Edge Function) → bypass RLS.
-- Lecture autorisée à super-admin uniquement (debug).
create policy stripe_events_super_admin on public.stripe_events
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());
