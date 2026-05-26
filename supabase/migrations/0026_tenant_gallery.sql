-- =============================================================================
-- 0026_tenant_gallery.sql — galerie photos du salon (vitrine côté client)
-- =============================================================================
--
-- Ajoute une galerie de photos affichée sur la page d'accueil de l'espace
-- /client : permet au salon de montrer son intérieur, l'équipe, des coupes
-- réalisées, etc. Géré depuis /manager?tab=settings.
--
-- Convention de stockage : `photo_url` est un data URL base64 (PNG/JPEG) —
-- même approche que `tenant_branding.logo_url` et `staff.photo_url`. Côté
-- manager on resize en canvas avant d'envoyer pour borner ~300 KB / photo.
-- Pas de bucket Supabase Storage : la taille reste raisonnable (5-10 photos
-- = ~3 MB max) et on évite la complexité d'un bucket public + RLS de fichier.
--
-- `sort_order` : ordre d'affichage défini par le gérant (drag&drop). On
-- utilise un float pour éviter de devoir réordonner toute la table à chaque
-- déplacement — il suffit d'insérer entre deux valeurs existantes.
--
-- RLS :
--  - SELECT public (anon) : la galerie est publique, visible depuis /client
--    sans authentification (comme `tenants.name` ou `tenant_branding.logo_url`)
--  - INSERT/UPDATE/DELETE : Direction du tenant uniquement
-- =============================================================================

create table public.tenant_gallery (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  /** Data URL base64 de l'image (PNG/JPEG). Resize côté client avant upload
   *  pour borner ~300 KB → max 5 MB pour le champ. */
  photo_url   text not null,
  /** Légende optionnelle affichée sous la photo (ex. « Notre salon
   *  San Stefano »). Limitée à 120 caractères côté action. */
  caption     text,
  /** Ordre d'affichage — float pour permettre l'insertion entre deux
   *  valeurs sans renumérotation. Plus petit = affiché en premier. */
  sort_order  double precision not null default 0,
  created_at  timestamptz not null default now()
);

create index tenant_gallery_tenant_idx on public.tenant_gallery (tenant_id, sort_order);

alter table public.tenant_gallery enable row level security;

-- Lecture publique (anon) — la galerie est exposée sur l'espace /client
-- accessible sans authentification.
create policy tenant_gallery_public_read on public.tenant_gallery
  for select
  using (true);

-- Écriture réservée à la Direction du tenant (members via current_tenant_id()).
-- Le service role (admin client) bypasse RLS, donc les Server Actions
-- manager passent quand même.
create policy tenant_gallery_tenant_write on public.tenant_gallery
  for all
  using (tenant_id = public.current_tenant_id() or public.is_super_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_super_admin());

comment on table public.tenant_gallery is 'Galerie photos du salon affichée sur l''espace /client (vitrine)';
comment on column public.tenant_gallery.photo_url is 'Data URL base64 de l''image (PNG/JPEG), resize côté client avant insert';
comment on column public.tenant_gallery.sort_order is 'Ordre d''affichage (float pour insertion sans renumérotation)';
