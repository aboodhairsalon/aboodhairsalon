-- 0047_receipt_numbers.sql
-- Numéro de ticket lisible et séquentiel par mois : « YYYY-MM-NNN » (ex. 2026-06-001).
--
-- Exigence comptable : numéros UNIQUES, SÉQUENTIELS et STABLES (jamais
-- réattribués). La séquence repart à 001 au début de chaque mois (heure locale
-- du salon). L'attribution est atomique côté serveur → aucune collision, même
-- sous encaissements simultanés ou rejeu de la file hors-ligne.

-- 1. Colonne sur sales — le numéro formaté, figé à la création de la vente.
--    NULL tant que non attribué (vente hors-ligne en attente de synchro).
alter table sales add column if not exists receipt_number text;

-- Unicité par tenant. Index PARTIEL : les ventes sans numéro (NULL) sont
-- ignorées (plusieurs NULL autorisés) → n'empêche pas les ventes hors-ligne.
create unique index if not exists sales_receipt_number_unique
  on sales (tenant_id, receipt_number)
  where receipt_number is not null;

-- 2. Compteur atomique par (tenant, période 'YYYY-MM' en heure locale du salon).
create table if not exists receipt_counters (
  tenant_id uuid not null references tenants(id) on delete cascade,
  period    text not null,            -- 'YYYY-MM' (heure locale du salon)
  last_seq  int  not null default 0,
  primary key (tenant_id, period)
);

-- Seul le service role (admin client, bypass RLS) accède au compteur.
alter table receipt_counters enable row level security;

-- 3. Attribution atomique : incrémente et renvoie le prochain numéro de séquence.
--    Un seul énoncé INSERT … ON CONFLICT DO UPDATE → verrou de ligne implicite,
--    donc deux appels concurrents obtiennent deux numéros distincts (jamais de
--    doublon). Renvoie l'entier de séquence (le formatage YYYY-MM-NNN est fait
--    par l'appelant).
create or replace function assign_receipt_seq(p_tenant_id uuid, p_period text)
returns int
language plpgsql
as $$
declare
  v_seq int;
begin
  insert into receipt_counters (tenant_id, period, last_seq)
  values (p_tenant_id, p_period, 1)
  on conflict (tenant_id, period)
  do update set last_seq = receipt_counters.last_seq + 1
  returning last_seq into v_seq;
  return v_seq;
end;
$$;

-- Réservé au service role (appel serveur via l'admin client). On retire l'accès
-- public/anon/authenticated pour éviter qu'un porteur de clé anon gonfle les
-- compteurs (griefing).
revoke all on function assign_receipt_seq(uuid, text) from public;
grant execute on function assign_receipt_seq(uuid, text) to service_role;

-- 4. Backfill des ventes existantes — numérotées par ordre CHRONOLOGIQUE au sein
--    de chaque mois (heure locale du salon), pour cohérence du journal de caisse.
with numbered as (
  select
    s.id,
    to_char(s.completed_at at time zone coalesce(t.timezone, 'Africa/Cairo'), 'YYYY-MM') as period,
    row_number() over (
      partition by s.tenant_id,
                   to_char(s.completed_at at time zone coalesce(t.timezone, 'Africa/Cairo'), 'YYYY-MM')
      order by s.completed_at, s.id
    ) as seq
  from sales s
  join tenants t on t.id = s.tenant_id
  where s.completed_at is not null and s.receipt_number is null
)
update sales s
set receipt_number = n.period || '-' || lpad(n.seq::text, 3, '0')
from numbered n
where s.id = n.id;

-- 5. Amorcer les compteurs au max attribué par période → la prochaine vente
--    reprend la suite sans collision avec le backfill.
insert into receipt_counters (tenant_id, period, last_seq)
select
  s.tenant_id,
  to_char(s.completed_at at time zone coalesce(t.timezone, 'Africa/Cairo'), 'YYYY-MM') as period,
  count(*) as last_seq
from sales s
join tenants t on t.id = s.tenant_id
where s.completed_at is not null and s.receipt_number is not null
group by s.tenant_id, to_char(s.completed_at at time zone coalesce(t.timezone, 'Africa/Cairo'), 'YYYY-MM')
on conflict (tenant_id, period) do update set last_seq = excluded.last_seq;
