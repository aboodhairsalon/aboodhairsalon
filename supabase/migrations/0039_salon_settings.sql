-- =============================================================================
-- 0039_salon_settings.sql — Table mono-tenant `salon_settings`
-- =============================================================================
--
-- Aboodhairsalon est un fork SINGLE-TENANT de System A. Il n'y a plus qu'UN
-- établissement → la notion `tenant_id` perd son sens. On crée une table
-- `salon_settings` à LIGNE UNIQUE qui remplace `tenant_settings` :
--
--   - Contrainte CHECK sur `id` (toujours le même UUID sentinel)
--   - RLS basée sur `auth.uid()` + role `manager` (pas sur tenant_id)
--   - Toutes les colonnes éditables venant historiquement de tenant_settings
--     (tax_rate_bp, business_hours, contact_*, etc.) consolidées ici
--
-- Le code Next utilise déjà cette table — voir :
--   - src/app/_data/auth-server.ts  → query `from('salon_settings').select('*').maybeSingle()`
--   - src/app/_lib/favicon.ts       → query `salon_settings.logo_url`
--   - src/app/_lib/email-sender.ts  → query `salon_settings.email_from_address`
--   - src/app/_data/tenant-brand.ts → query `salon_settings.logo_url`
--
-- À noter : on garde aussi (pour l'instant) les anciennes tables `tenants`,
-- `tenant_branding`, `tenant_settings`, etc. — le fork bulk-copy n'a pas
-- consolidé le schéma. La consolidation propre est documentée dans
-- `supabase/migrations/README.md` (décision Option A vs B).
--
-- Cette migration ajoute UNIQUEMENT salon_settings — le reste reste comme
-- avant. Pas de DROP, pas de migration de données vers cette table
-- (le seul tenant que la DB connaisse, c'est Aboodhairsalon).
--
-- DÉPENDANCES : les 38 migrations précédentes doivent être appliquées
-- d'abord (pour avoir auth.uid() + extension pgcrypto + table staff).
-- =============================================================================

-- Sentinel UUID — toutes les lignes salon_settings ont CET id et aucun autre.
-- Garantit la contrainte "1 ligne unique" via CHECK constraint.
do $$ begin
  -- pgcrypto est déjà présente (migration 0001), mais on s'assure.
  perform 1 from pg_extension where extname = 'pgcrypto';
exception when others then
  create extension if not exists "pgcrypto";
end $$;

-- =============================================================================
-- Table : salon_settings (1 ligne unique)
-- =============================================================================
create table if not exists public.salon_settings (
  -- ID fixe — la contrainte CHECK garantit qu'on ne peut insérer qu'une ligne
  -- avec cet UUID. Toute autre tentative d'insert échoue.
  id uuid primary key default '00000000-0000-0000-0000-000000000001'::uuid
    constraint salon_settings_singleton
    check (id = '00000000-0000-0000-0000-000000000001'::uuid),

  -- ── Identité visuelle dynamique (le reste vient de @/config/salon static) ──
  -- Logo uploadé par le gérant via /manager > Paramètres. Si NULL → fallback
  -- /brand/favicon.svg (servi depuis public/). Format accepté : data URL
  -- (bitmap/SVG) ou https URL pointant un bitmap.
  logo_url text,

  -- ── Fiscalité ─────────────────────────────────────────────────────────────
  -- Taux TVA en basis points (1400 = 14%). 0 = pas de TVA affichée sur les
  -- reçus (default — sûr pour les petits salons non-assujettis). Borné [0, 3000].
  -- Aboodhairsalon (Égypte) : default à 1400 (14% VAT standard EG).
  tax_rate_bp integer not null default 1400
    check (tax_rate_bp >= 0 and tax_rate_bp <= 3000),

  -- ── Informations légales (factures, ICS, OG) ──────────────────────────────
  legal_name      text,
  legal_address   text,

  -- ── Politiques (JSON libre — schémas validés côté Server Action) ──────────
  deposit_policy       jsonb,
  cancellation_policy  jsonb,
  -- Horaires structurés. Format documenté dans 0008 (équivalent tenant_settings).
  business_hours       jsonb default '[]'::jsonb,

  -- ── Profil salon (anciens champs 0008 de tenant_settings) ──────────────────
  -- Tagline / sous-titre affiché à côté du nom du salon.
  tagline           text,
  address_street    text,
  address_city      text,
  address_zip       text,
  -- Pour Aboodhairsalon : "Smouha", "San Stefano" — utilisé si le salon a
  -- plusieurs branches. NULL pour un salon mono-adresse.
  branch            text,
  contact_phone     text,
  -- citext = case-insensitive text (pour matcher les emails sans casse).
  contact_email     citext,
  contact_website   text,
  contact_instagram text,
  -- Horaires en texte libre (ex. "Mar–Sam · 10h–20h, fermé dim/lun"). Le
  -- format structuré est dans `business_hours` JSONB ci-dessus.
  hours_text        text,
  -- Lien Google Maps personnalisé. Si NULL, l'UI construit un lien depuis
  -- l'adresse complète.
  maps_url          text,

  -- ── Programme fidélité ────────────────────────────────────────────────────
  -- Taux cashback en basis points (250 = 2.5%). Configurable par le manager.
  cashback_rate_bp integer not null default 250
    check (cashback_rate_bp >= 0 and cashback_rate_bp <= 1000),

  -- ── Email transactionnel ──────────────────────────────────────────────────
  -- Adresse expéditeur pour les emails Resend (ex. noreply@aboodhairsalon.com).
  -- NULL = fallback sur process.env.RESEND_FROM_EMAIL.
  -- Doit matcher un format email simple. Le domaine DOIT être vérifié dans
  -- Resend dashboard (DKIM + SPF + DMARC dans DNS IONOS) sinon Resend rejette.
  email_from_address text
    check (
      email_from_address is null
      or email_from_address ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    ),

  -- ── Timestamps ─────────────────────────────────────────────────────────────
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Trigger pour updater `updated_at` à chaque UPDATE. Utilise la fonction
-- `set_updated_at()` définie en migration 0001.
drop trigger if exists salon_settings_updated_at on public.salon_settings;
create trigger salon_settings_updated_at
  before update on public.salon_settings
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row Level Security
-- =============================================================================
-- En multi-tenant System A, RLS filtrait par `tenant_id = current_tenant_id()`.
-- Ici, single-tenant : on filtre par RÔLE.
--   - SELECT : autorisé pour tous les users authentifiés ET pour anon (le
--     booking public a besoin de lire contact_phone, contact_instagram,
--     hours_text, maps_url, business_hours, tagline, etc.). Les colonnes
--     sensibles (logo_url uploadé, email_from_address) sont OK à exposer
--     publiquement (le logo apparaît sur le site, l'email est juste un
--     display name).
--   - UPDATE : seulement les managers (vérification via JWT claim role).
--   - INSERT/DELETE : interdit côté app (la ligne est seedée par cette
--     migration ; supprimer est sans intérêt).
-- =============================================================================
alter table public.salon_settings enable row level security;

-- SELECT public — la vitrine + le booking client public ont besoin de lire.
create policy salon_settings_read_all
  on public.salon_settings
  for select
  using (true);

-- UPDATE réservé aux managers authentifiés. Le claim `role` est lifté en
-- top-level par le Custom Access Token Hook (migration 0007/0010).
create policy salon_settings_update_manager
  on public.salon_settings
  for update
  using (
    coalesce(
      (current_setting('request.jwt.claims', true)::jsonb ->> 'role')::text,
      ''
    ) = 'manager'
  )
  with check (
    coalesce(
      (current_setting('request.jwt.claims', true)::jsonb ->> 'role')::text,
      ''
    ) = 'manager'
  );

-- =============================================================================
-- Seed de la ligne unique
-- =============================================================================
-- ON CONFLICT DO NOTHING : permet de re-jouer la migration sans casser.
-- Les valeurs viennent du config statique `src/config/salon.ts` côté code,
-- recopiées ici pour cohérence DB.
insert into public.salon_settings (
  id,
  tax_rate_bp,
  business_hours,
  tagline,
  address_street,
  address_city,
  branch,
  contact_phone,
  contact_email,
  contact_instagram,
  cashback_rate_bp,
  email_from_address
) values (
  '00000000-0000-0000-0000-000000000001'::uuid,
  1400, -- 14% VAT Égypte
  '[]'::jsonb,
  'Salon de coiffure homme — Alexandrie',
  '', -- à compléter par le gérant via Manager > Paramètres
  'Alexandrie',
  null,
  '+20 122 329 5647', -- numéro principal Aboodhairsalon
  'contact@aboodhairsalon.com',
  'aboodhairsalon',
  250, -- 2.5% cashback
  'noreply@aboodhairsalon.com'
)
on conflict (id) do nothing;

-- =============================================================================
-- Audit
-- =============================================================================
-- Trigger audit sur les UPDATE (côté legacy on a `audit_log` table créée par 0001).
-- Cette table prend `tenant_id uuid null` (cf. 0001) — on log avec NULL pour
-- salon_settings (single-tenant, donc pas de scoping nécessaire). Le row_id
-- contient l'UUID sentinel pour faciliter le filtrage.
drop trigger if exists salon_settings_audit on public.salon_settings;
create trigger salon_settings_audit
  after insert or update or delete on public.salon_settings
  for each row execute function public.audit_changes();

comment on table public.salon_settings is
  'Configuration éditable du salon (single-tenant Aboodhairsalon). Une seule ligne, ID sentinel = ''00000000-0000-0000-0000-000000000001''. Voir docs/MIGRATION_FROM_SYSTEM_A.md pour la décision Option A vs B sur le schéma.';

comment on column public.salon_settings.tax_rate_bp is
  'Taux TVA en basis points (1400 = 14% — VAT standard Égypte). Borné [0, 3000].';

comment on column public.salon_settings.cashback_rate_bp is
  'Taux cashback fidélité en basis points (250 = 2.5%). Borné [0, 1000].';

comment on column public.salon_settings.email_from_address is
  'Adresse From: des emails transactionnels Resend. NULL → fallback RESEND_FROM_EMAIL. Domaine DOIT être vérifié dans Resend dashboard.';
