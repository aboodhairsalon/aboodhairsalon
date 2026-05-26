# Aboodhairsalon

Application web (booking + caisse + direction) du salon Aboodhairsalon (Alexandrie, Égypte).

Fork single-tenant du template **System A**, personnalisé pour Aboodhairsalon. Sert de référence canonique pour la réplication chez d'autres salons partenaires.

---

## Architecture

- **Mono-app Next.js 15** (App Router, RSC, React 19)
- **Supabase Postgres** + Auth + Storage (projet dédié)
- **Resend** pour les emails transactionnels
- **next-intl** pour i18n (FR/EN/AR + RTL)
- **Tailwind v4** beta pour le style
- **PWA** avec manifests par espace (booking client, caisse, direction)

### Espaces

| Sous-domaine                       | Espace        | Rôle Supabase            |
| ---------------------------------- | ------------- | ------------------------ |
| `aboodhairsalon.com`               | Vitrine + booking client | `client` ou anonyme |
| `cashier.aboodhairsalon.com`       | Caisse        | `cashier`                |
| `manager.aboodhairsalon.com`       | Direction     | `manager`                |

En dev local tous pointent sur `http://localhost:3000` ; le routing se fait par pathname (`/`, `/cashier`, `/manager`).

---

## Démarrage

### Prérequis

- Node ≥ 20
- pnpm ≥ 9 (ou npm)
- Compte Supabase (projet dédié à Aboodhairsalon)
- Compte Resend (domaine aboodhairsalon.com vérifié)

### Installation

```bash
pnpm install
cp .env.example .env.local
# Remplir .env.local avec les vraies clés
pnpm dev
```

### Variables d'environnement

Voir [`.env.example`](./.env.example) pour la liste complète et les explications.

### Commandes

```bash
pnpm dev          # Démarre Next.js en dev sur :3000
pnpm build        # Build production
pnpm start        # Démarre le build production
pnpm lint         # ESLint
pnpm type-check   # tsc --noEmit
pnpm db:types     # Régénère src/db/types.ts depuis Supabase (requiert SUPABASE_PROJECT_REF)
```

---

## Différences avec System A monorepo

Si tu connais System A, voici ce qui change pour cette version :

| System A (monorepo)                          | Aboodhairsalon (mono-app)                   |
| -------------------------------------------- | ------------------------------------------- |
| Turborepo + pnpm workspaces                  | Single Next.js app, pas de monorepo         |
| `@system-a/db`, `@system-a/lib`, etc.        | Tout inline dans `src/db/`, `src/lib/`, etc. |
| Multi-tenant (`tenants` table + `tenant_id`) | Single-tenant (pas de `tenant_id` partout)  |
| RLS basée sur `tenant_id` + rôles            | RLS basée sur `auth.uid()` + rôles uniquement |
| Middleware résout le tenant via host/slug    | Middleware juste refresh la session Supabase |
| Branding dynamique en DB (`tenant_branding`) | Branding hardcodé en config + `salon_settings` (1 ligne) |
| Trois apps Next.js (marketing/tenant/admin)  | Une seule app                                |
| Path-based slug routing (`/{slug}/cashier`)  | Subdomain routing pur                        |

---

## Structure

```
src/
├── app/                    # App Router
│   ├── (site)/             # Vitrine + booking public (aboodhairsalon.com)
│   ├── cashier/            # Espace caisse
│   ├── manager/            # Espace direction
│   ├── login/              # Login partagé
│   ├── api/                # Routes API (webhooks, cron)
│   ├── layout.tsx          # Root layout
│   └── globals.css         # Tailwind v4 @theme + styles globaux
├── db/                     # Client Supabase + types générés
│   ├── client.ts           # Client browser
│   ├── server.ts           # Client serveur (RSC + Server Actions)
│   ├── admin.ts            # Client admin (service role, contourne RLS)
│   └── types.ts            # Types générés par `supabase gen types`
├── lib/                    # Helpers métier
│   ├── auth-server.ts      # requireRole, requireAuth, etc.
│   ├── client-token.ts     # HMAC pour ?p= URLs
│   ├── rate-limit.ts       # Upstash + fallback mémoire
│   ├── email-sender.ts     # Resolve from-address + send via Resend
│   └── ...
├── emails/                 # React Email templates
├── components/             # Composants partagés
├── config/                 # Branding hardcodé + constantes salon
└── i18n/                   # next-intl config + messages
    ├── config.ts
    ├── request.ts
    ├── locale-actions.ts
    └── messages/
        ├── fr.json
        ├── en.json
        └── ar.json
```

---

## Déploiement

Voir [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).

---

## Réplication chez un autre salon

Voir [`docs/FORK.md`](./docs/FORK.md) pour le process de fork (TODO après cutover prod).
