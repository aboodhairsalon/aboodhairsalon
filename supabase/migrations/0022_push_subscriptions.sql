-- =============================================================================
-- 0022_push_subscriptions.sql — abonnements Web Push (PWA)
-- =============================================================================
--
-- Stocke les souscriptions Web Push du navigateur : chaque appareil/navigateur
-- d'un user (gérant ou caissier) s'inscrit une fois, on enregistre l'objet
-- subscription (endpoint + keys p256dh/auth) et on l'utilise pour pousser des
-- notifications côté serveur via le SDK `web-push`.
--
-- Clé d'identité : `endpoint` — unique par souscription, fourni par le push
-- service (FCM, Mozilla, Apple). On utilise UNIQUE sur endpoint pour idempotence
-- (le même navigateur qui ré-active reset son row sans dupliquer).
--
-- RLS : un user voit/édite uniquement ses propres souscriptions. La Direction
-- d'un tenant voit toutes les souscriptions du tenant (utile pour afficher
-- "3 appareils notifiés" dans Paramètres).
-- =============================================================================

create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  /** Rôle du user au moment de la souscription — duplique app_metadata.role
   *  pour permettre des envois ciblés (notifier les caissiers vs Direction). */
  role        text not null check (role in ('manager', 'cashier', 'unknown')),
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  /** User-agent au moment de l'abonnement — sert à afficher "iPhone Safari"
   *  ou "Chrome desktop" côté Paramètres. */
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz
);

create index push_subscriptions_tenant_idx on public.push_subscriptions (tenant_id);
create index push_subscriptions_user_idx   on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Un user lit/écrit uniquement ses souscriptions.
create policy push_subscriptions_self on public.push_subscriptions
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- La Direction du tenant voit les souscriptions des autres members
-- (utile pour le panneau "X appareils notifiés"). Ne peut pas modifier.
create policy push_subscriptions_tenant_read on public.push_subscriptions
  for select
  using (tenant_id = public.current_tenant_id());

comment on table public.push_subscriptions is 'Web Push subscriptions (PWA) — un row par device/navigateur abonné';
comment on column public.push_subscriptions.role is 'Rôle au moment de l''abonnement — pour cibler les envois (manager / cashier)';
