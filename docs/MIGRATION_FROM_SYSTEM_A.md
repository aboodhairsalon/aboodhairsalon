# Migration depuis System A — état du découplage

> **Date du fork** : 2026-05-26
> **Source** : `C:\Users\wiinc\system A\apps\tenant` (tenant Aboodhairsalon,
>             UUID `fa508622-b027-4907-9508-afd2e9f83eeb`)
> **Cible** : `C:\Users\wiinc\aboodhairsalon-app` (mono-app dédiée)
> **GitHub** : https://github.com/aboodhairsalon/aboodhairsalon

---

## Pourquoi ce fork ?

Aboodhairsalon est le PREMIER client de la plateforme System A. Plutôt que de
maintenir une intégration multi-tenant pour un seul tenant, on extrait
Aboodhairsalon dans un projet **single-tenant dédié** qui servira de :

- **App de production** : c'est ce qui tourne pour le salon réel
- **Template canonique** : à forker pour chaque futur client (modèle studio)
- **Référence d'apprentissage** : il sera personnalisé sans toucher au core
  System A — ce qui permet d'expérimenter rapidement (variantes UX,
  features spécifiques au salon)

Le code System A reste maintenu en parallèle, mais Aboodhairsalon ne consomme
plus son monorepo.

---

## État du découplage

### ✅ Phase A — Scaffolding base (TERMINÉ)

- `package.json` — Next 15, Supabase SSR, Resend, next-intl, lucide-react, zod,
  Upstash (rate-limit), qrcode, date-fns. **Aucune dépendance `@system-a/*`.**
- `tsconfig.json` — strict, paths `@/* → src/*`, noUncheckedIndexedAccess
- `next.config.ts` — security headers, image whitelist Supabase Storage,
  typedRoutes
- `tailwind.config` → remplacé par directive `@theme` dans globals.css (Tailwind v4 beta)
- `postcss.config.mjs` — Tailwind v4 plugin
- `eslint.config.js` — flat config inline (plus de `@system-a/config`)
- `.gitignore`, `.env.example`, `.env.local.example`
- `vercel.json` — region fra1, cron rappels J-1
- `README.md` — bootstrap + différences avec System A
- `src/i18n/` — config.ts, request.ts, locale-actions.ts, messages/{fr,en,ar}.json
- `src/app/layout.tsx` — root layout simplifié (no tenant lookup)
- `src/app/fonts.ts` — Fraunces + Manrope + JetBrains + Inter Tight + Instrument Serif
- `src/app/globals.css` — consolidé (tokens + base + components + utilities)
- `src/middleware.ts` — **SIMPLIFIÉ** : juste Supabase auth refresh + subdomain
  routing (`cashier.* → /cashier`, `manager.* → /manager`, sinon → `/client`)
- `src/config/salon.ts` — config statique du salon (nom, couleurs, contact, etc.)
- `src/app/page.tsx` — placeholder racine

### ✅ Phase B1 — Bulk copy + transform imports (TERMINÉ)

Source copiée :
- `apps/tenant/src/app/_components/` → `src/app/_components/`
- `apps/tenant/src/app/_data/` → `src/app/_data/`
- `apps/tenant/src/app/_lib/` → `src/app/_lib/`
- `apps/tenant/src/app/_pwa/` → `src/app/_pwa/`
- `apps/tenant/src/app/{api,cashier,client,login,manager,reset-password,signup,site,sys-diag}/` → `src/app/`
- `packages/db/src/` → `src/db/` (admin.ts, client.ts, server.ts, index.ts, types.ts)
- `packages/lib/src/{dates,money,slugify,schemas/*}` → `src/lib/`
- `packages/ui/src/components/*` → `src/components/*`
- `packages/ui/src/utils/cn.ts` → `src/lib/utils/cn.ts`
- `packages/emails/src/{templates/,index.ts}` → `src/emails/`
- `apps/tenant/public/*` → `public/`
- `apps/tenant/messages/*.json` → `src/i18n/messages/`

Imports transformés (sed bulk) :
- `@system-a/db*` → `@/db*`
- `@system-a/lib*` → `@/lib*`
- `@system-a/ui` → `@/components`
- `@system-a/ui/fonts` → `@/app/fonts`
- `@system-a/emails` → `@/emails`

`src/components/index.ts` créé avec ré-exports : Btn, BtnLink, Tag, Card,
Divider, StripeBar, Modal, Input, cn — même surface que `@system-a/ui`.

### 🔄 Phase B2 — Strip multi-tenant code (PARTIELLEMENT TERMINÉ)

**Fait :**
- `src/app/_data/auth-server.ts` — **RÉÉCRIT** :
  - `requireTenant()` ne lit plus le tenant depuis le JWT
  - Le `TenantContext` est construit depuis `@/config/salon` (statique) + 1
    ligne `salon_settings` (DB)
  - `requireCashier()` ne dépend plus de `tenant_id`
  - Le nom `requireTenant` est conservé pour compat (alias `requireManager`
    ajouté)
- `src/app/_lib/favicon.ts` — Lit depuis `salon_settings.logo_url`, fallback
  `/brand/favicon.svg`
- `src/app/_lib/email-sender.ts` — Lit depuis `salon_settings.email_from_address`,
  fallback `RESEND_FROM_EMAIL` env, fallback `noreply@aboodhairsalon.com`
- `src/app/_data/tenant-brand.ts` — Lit depuis `salon_settings.logo_url`
- **Bulk sed** : 116 `.eq('tenant_id', ctx.tenant.id)` retirés des queries
  (Server Actions). Reste 1 (dans un commentaire).
- **Bulk sed** : 92 → 59 occurrences de `tenant_id:` dans le code (les 59 restantes
  sont dans `src/db/types.ts` qui sera regenerated)

**À FAIRE (handoff prioritaire) :**

#### B2.a — Strip `ctx.tenant.id` guards (≈17 occurrences)
Des Server Actions ont des guards comme :
```ts
const ctx = await requireTenant();
if (ctx.tenant.id !== tenantId) {
  return { ok: false, errorKey: 'tenantNotAuthorized' };
}
```
Ces guards étaient nécessaires en multi-tenant. En single-tenant, ils sont
toujours faux (ctx.tenant.id == SALON.slug, et `tenantId` venait d'un input
utilisateur qu'il fallait valider).

**Action** : retirer le guard OU le remplacer par un cast `=== SALON.slug`.
Fichiers : `manager/dashboard-actions.ts`, `manager/clients-actions.ts`,
`client/profile-actions.ts`, etc.

#### B2.b — Strip `x-tenant-*` header reads (≈68 occurrences)
Le middleware ne pose plus ces headers. Le code qui les lit doit être adapté :
```ts
const tenantId = h.get('x-tenant-id');         // → SALON.slug (ou supprimer)
const slug     = h.get('x-tenant-slug');       // → SALON.slug
const tenantName = h.get('x-tenant-name');     // → SALON.name
const primary  = h.get('x-tenant-brand-primary'); // → SALON.brand.primary
```
Fichiers touchés : `site/layout.tsx`, `site/data.ts`, `login/page.tsx`,
`login/LoginForm.tsx`, `cashier/layout.tsx`, `client/data.ts`,
`client/bookings-actions.ts`, `client/token-verify-action.ts`, `sys-diag/page.tsx`.

#### B2.c — Adapter le signup
`src/app/signup/actions.ts` est le signup multi-tenant (création d'un nouveau
tenant + branding + settings + manager user). Pour Aboodhairsalon mono-app,
le signup n'a pas de sens — la base est pré-provisionnée.

**Décision à prendre** :
- **Option 1** : Supprimer entièrement `src/app/signup/`. Le gérant est créé
  manuellement via Supabase dashboard à l'init (la `salon_settings` row est
  seedée par migration).
- **Option 2** : Garder la page mais la transformer en "Onboarding initial"
  qui se déclenche uniquement si `salon_settings` n'a pas encore de ligne.
- **Option 3** : Garder la page comme "Invitation team member" (réservée
  aux gérants, pour ajouter un autre manager ou cashier).

Recommandation : **Option 1** pour aller vite. Le gérant unique est créé via
SQL seed.

#### B2.d — Adapter le login
`src/app/login/page.tsx` lit `x-tenant-slug` et `x-tenant-id` pour afficher le
logo du salon. Single-tenant : juste lire le logo depuis `salon_settings.logo_url`
ou `@/config/salon` (static).

`src/app/login/LoginForm.tsx` redirige après login vers `/${slug}/manager`.
Single-tenant : juste `/manager`.

#### B2.e — Adapter les manifests PWA
`src/app/{cashier,manager,client}/manifest/route.ts` génèrent dynamiquement
un manifest.json par tenant. Single-tenant : hardcoder pour Aboodhairsalon
(nom, couleurs, icônes). Garder la route pour permettre une future
personnalisation par fork.

#### B2.f — Adapter sys-diag
`src/app/sys-diag/page.tsx` lit les headers tenant + queries `tenant_branding`.
À simplifier : juste lire `salon_settings` + check env vars + montrer la
config statique de `@/config/salon`.

### ⏳ Phase C — Migrations DB single-tenant (NON COMMENCÉ)

Voir `supabase/migrations/README.md` pour le plan détaillé.

**Decision pendante** : on garde le schema multi-tenant tel quel (Option A,
plus rapide) ou on consolide (Option B, plus clean) ?

Recommandation : **Option A** pour go-live, **Option B** dans 6 mois.

Une seule migration à ajouter immédiatement : `0039_salon_settings.sql` qui
créé la table mono-tenant. Voir squelette ci-dessous.

```sql
-- 0039_salon_settings.sql
create table public.salon_settings (
  id          uuid primary key default '00000000-0000-0000-0000-000000000001'::uuid,
  -- ↑ Une seule ligne, ID fixe pour éviter la prolifération
  logo_url    text,
  tax_rate_bp int not null default 1400, -- 14% VAT Égypte
  legal_name  text,
  legal_address text,
  -- ... (cf. tenant_settings dans 0008_salon_profile_fields.sql pour la liste complète)
  email_from_address text,
  cashback_rate_bp int not null default 250,
  updated_at  timestamptz not null default now(),
  constraint salon_settings_singleton check (id = '00000000-0000-0000-0000-000000000001'::uuid)
);

-- Seed la ligne unique
insert into public.salon_settings (id) values ('00000000-0000-0000-0000-000000000001'::uuid);

-- RLS : lecture autorisée pour tous les users authentifiés (le manager UI doit la lire)
alter table public.salon_settings enable row level security;
create policy salon_settings_read on public.salon_settings for select using (true);
create policy salon_settings_write on public.salon_settings for update
  using (auth.uid() in (select user_id from public.staff where role = 'manager'));
```

### ⏳ Phase D — Config branding hardcoded + salon_settings (NON COMMENCÉ)

Une fois la migration 0039 appliquée, le `src/config/salon.ts` est complet
côté code, et `salon_settings` côté DB est seedé. Reste à :

- Remplir les valeurs réelles dans `src/config/salon.ts` (téléphone, adresse,
  Instagram, URL Google Maps, etc. — actuellement avec des placeholders)
- Décider du contenu initial de `salon_settings` (peut être seedé via migration
  ou laissé NULL pour que le manager le remplisse au premier login)

### ⏳ Phase E — Build + lint + type-check (NON COMMENCÉ)

Étapes :
1. `pnpm install` (vérifier qu'aucune dépendance ne manque)
2. `pnpm db:types` — régénérer `src/db/types.ts` depuis le nouveau Supabase
3. `pnpm type-check` — devrait montrer les erreurs résiduelles (B2.a + B2.b)
4. Fixer les erreurs une par une
5. `pnpm lint` — clean ESLint
6. `pnpm build` — vérifier que la prod build passe

### ⏳ Phase F — Init git + push GitHub (NON COMMENCÉ)

```bash
cd C:/Users/wiinc/aboodhairsalon-app
git init
git add -A
git commit -m "Initial commit — fork from System A monorepo"
git branch -M main
git remote add origin git@github.com:aboodhairsalon/aboodhairsalon.git
git push -u origin main
```

⚠️ **Compte GitHub** : `aboodhairsalon` (PAS `hadadzak`, PAS `egyptttw`).
Vérifier `git config user.email` avant le push.

---

## Architecture target rappel

```
┌─────────────────────────────────────────────────────────────────────────┐
│ aboodhairsalon.com (apex)                                               │
│  ├─ /        → /client  (booking PWA)                                   │
│  ├─ /book/*  → catalog + booking flow                                   │
│  ├─ /profile/* → client account (bookings, cashback, profile)           │
│  └─ /site/*  → vitrine optionnelle                                      │
├─────────────────────────────────────────────────────────────────────────┤
│ cashier.aboodhairsalon.com                                              │
│  ├─ /        → /cashier (caisse PWA)                                    │
│  └─ /login   → /cashier/login                                           │
├─────────────────────────────────────────────────────────────────────────┤
│ manager.aboodhairsalon.com                                              │
│  ├─ /        → /manager (direction)                                     │
│  └─ /login   → /login (commune)                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

DNS à configurer chez IONOS (à faire APRÈS Vercel project setup) :
- `aboodhairsalon.com`     → Vercel apex
- `www.aboodhairsalon.com` → Vercel apex (canonical sans www en redirect 308)
- `cashier.aboodhairsalon.com` → Vercel (même app, différent host)
- `manager.aboodhairsalon.com` → Vercel (même app, différent host)

---

## Côté équipe : ce qui change pour le développement

### Pour le gérant Abood

Rien à voir côté UX en surface. Les URLs canoniques pointent toujours sur
`cashier.aboodhairsalon.com` et `manager.aboodhairsalon.com`. Les bookmarks
restent valides.

Cependant, **les données ne se synchronisent plus** entre l'ancien System A
et le nouveau projet. La cutover production doit se faire en une fois :
1. Snapshot du Supabase System A pour Aboodhairsalon (UUID `fa508622-...`)
2. Restore dans le nouveau Supabase dédié
3. DNS switch (les 4 subdomains pointent vers le nouveau Vercel project)
4. Ancien tenant marqué `status = 'archived'` dans System A pour éviter
   confusion future

### Pour les futurs salons partenaires

Le process de fork pour un nouveau salon (ex. "BabaCoiffeur") :
1. Fork le repo `aboodhairsalon/aboodhairsalon` sur GitHub
2. Renommer en `babacoiffeur/babacoiffeur`
3. Éditer `src/config/salon.ts` (nom, couleurs, contact, URL canonique)
4. Éditer les messages i18n si nécessaire (catalog spécifique, etc.)
5. Créer un nouveau projet Supabase (region EU-Central)
6. Apply les migrations
7. Seed `salon_settings` avec les valeurs du nouveau salon
8. Créer un projet Vercel, lier le repo, set env vars
9. Configurer DNS

Tout doit pouvoir se faire en **< 4h** de travail technique. Documenter
ce process dans `docs/FORK.md` une fois le premier fork (Aboodhairsalon)
en prod.

---

## Risques & points d'attention

### Risque 1 : Types.ts désynchronisé

`src/db/types.ts` décrit le schema multi-tenant System A. Tant qu'on n'a
pas regenerated via `pnpm db:types` contre le NOUVEAU Supabase, le type-check
va passer (l'ancien schema couvre les tables) mais le runtime échouera sur
les requêtes vers `salon_settings` (qui n'existe pas dans l'ancien schema).

**Mitigation** : régénérer `types.ts` ASAP après application des migrations
sur le nouveau projet Supabase.

### Risque 2 : Couplage Manager UI ↔ Multi-tenant fields

L'UI Manager affiche/édite des champs `tenant_*` (slug, plan, status). En
mono-app, ces concepts disparaissent (le salon n'a pas de "plan" payant —
c'est nous qui l'opérons).

**Mitigation** : auditer chaque page Manager et supprimer les sections
"Compte" (gestion plan, billing, etc.) qui n'ont plus de sens.

### Risque 3 : Path-based slug routing dans les redirections internes

Le code copié contient des `router.push(\`/\${slug}/manager\`)` qui ne marcheront
plus (le slug n'existe plus dans l'URL). À grep et remplacer par `router.push('/manager')`.

```bash
grep -rn '\${slug}/' src --include="*.ts" --include="*.tsx"
```

### Risque 4 : Sentry / monitoring

Le projet a un wrapper `error-reporter.ts` (Sentry stub). Décider si on
active Sentry pour Aboodhairsalon en prod ou non. Si oui, créer un projet
Sentry dédié (pas réutiliser celui de System A).

---

## Reprendre demain — checklist

Pour reprendre ce travail proprement :

- [ ] Vérifier que les 3 secrets Supabase sont prêts (dashboard nouveau projet)
- [ ] Vérifier que le repo GitHub est accessible (clone test)
- [ ] Décider Option A vs B pour le schema (cf. supabase/migrations/README.md)
- [ ] Appliquer les migrations + créer 0039_salon_settings.sql
- [ ] `pnpm install && pnpm db:types`
- [ ] `pnpm type-check` et fixer les errors une par une
- [ ] Phase B2.a-f (strip ctx.tenant.id + x-tenant-* + signup/login/manifests)
- [ ] `pnpm build` doit passer
- [ ] Migrer les données depuis l'ancien Supabase
- [ ] Setup Vercel project + env vars
- [ ] DNS switch IONOS (les 4 subdomains)
- [ ] Test live avec un compte de test
- [ ] Cutover Aboodhairsalon (annoncer au gérant + équipe)
- [ ] Marquer l'ancien tenant `status='archived'` dans System A
