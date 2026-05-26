# Runbook — Cutover Aboodhairsalon (System A → repo dédié)

> **Audience** : toi (gérant + dev unique) le jour où tu fais bascule.
> **Durée totale estimée** : 2-4 h actives + 1 semaine d'observation.
> **Risque** : modéré. Effectuer hors heures d'ouverture du salon.

---

## Pré-requis (à valider AVANT de commencer)

| Item | Vérif | Comment vérifier |
| ---- | ----- | ---------------- |
| Repo aboodhairsalon-app pushed sur GitHub | ✅ | https://github.com/aboodhairsalon/aboodhairsalon |
| Nouveau projet Supabase dédié | ✅ | https://supabase.com/dashboard/project/wgijrxzgimkfljgmkrqk |
| Service role key dans `.env.local` | ⏳ | `cat C:\Users\wiinc\aboodhairsalon\.env.local | grep SERVICE_ROLE` |
| Build local OK | ✅ | `cd C:\Users\wiinc\aboodhairsalon && pnpm build` |
| Compte Vercel pour Aboodhairsalon (séparé) | ⏳ | dashboard.vercel.com (vérifier compte ; SURTOUT PAS `egyptttw` qui sert à un autre projet) |
| Accès IONOS DNS (aboodhairsalon.com) | ⏳ | login.ionos.com |
| Accès Resend dashboard (vérification domaine) | ⏳ | resend.com/domains |
| Données salon AT REST | ✅ | aucun nouveau RDV ne doit être créé pendant la migration. Idéalement faire ça dimanche soir (jour de fermeture) |

---

## Étape 1 — Préparer le nouveau Supabase (30-45 min)

### 1.1 Appliquer les migrations

Deux options selon ta décision (cf. `supabase/migrations/README.md`) :

**Option A (recommandé pour aller vite)** — appliquer les 38 migrations System A + la nouvelle 0039 :

```powershell
cd C:\Users\wiinc\aboodhairsalon

# Lier le projet local au Supabase distant
npx supabase link --project-ref wgijrxzgimkfljgmkrqk
# Va te demander le DB password — récupérer depuis le dashboard Supabase

# Appliquer toutes les migrations
npx supabase db push

# Vérifier
npx supabase db diff --schema public
# Doit dire "No schema differences found"
```

**Option B (consolidé single-tenant — plus long, à faire plus tard)** : voir
décision dans `supabase/migrations/README.md`. Pour le cutover, on prend Option A.

### 1.2 Régénérer les types TS

```powershell
$env:SUPABASE_PROJECT_REF = "wgijrxzgimkfljgmkrqk"
pnpm db:types
git diff src/db/types.ts | head -20
# Vérifier que la table salon_settings apparaît dans les types
```

### 1.3 Vérifier que le build passe après types regenerated

```powershell
pnpm build
# Si erreurs → fixer (probablement les casts `as any` qu'on a mis avant les types existent)
```

### 1.4 Retirer les casts `as any` devenus inutiles

Une fois les types corrects, retirer les `// eslint-disable-next-line ... any`
dans :
- `src/app/_data/auth-server.ts` (query salon_settings)
- `src/app/_lib/favicon.ts`
- `src/app/_lib/email-sender.ts`
- `src/app/_data/tenant-brand.ts`

Commit séparé : `chore: retire casts any sur queries salon_settings (types regenerated)`.

---

## Étape 2 — Migrer les données depuis System A (45-90 min)

### 2.1 Dump filtré depuis System A

Le tenant Aboodhairsalon a l'UUID `fa508622-b027-4907-9508-afd2e9f83eeb` dans
System A. Dump uniquement ses données.

```powershell
# Récupérer la connection string du Supabase SOURCE (System A)
# Depuis le dashboard System A → Settings → Database → Connection string (URI)
$SOURCE_DB = "postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-eu-central-1.pooler.supabase.com:6543/postgres"

# Dump filtré (data only, tables clients)
pg_dump $SOURCE_DB `
  --schema=public --data-only --no-owner --no-acl `
  -t bookings -t sales -t sale_items -t refunds `
  -t services -t products -t staff -t client_profiles `
  -t barber_reviews -t tenant_gallery -t push_subscriptions `
  -t booking_extras -t cashback_transactions `
  --where="tenant_id='fa508622-b027-4907-9508-afd2e9f83eeb'" `
  > aboodhairsalon_data_$(Get-Date -Format yyyyMMdd_HHmm).sql
```

⚠️ Sur Windows, `pg_dump` n'est pas natif. Soit :
- Installer PostgreSQL 16+ ([download](https://www.postgresql.org/download/windows/))
- Utiliser Supabase CLI : `supabase db dump --linked --schema public --data-only -f data.sql`
- Utiliser une VM Linux temporaire avec psql

### 2.2 Migrer les comptes auth.users

Les users Manager et Cashier d'Aboodhairsalon vivent dans `auth.users` (Supabase
Auth) du System A. Ils ont des claims `app_metadata.tenant_id`, `role`, `staff_id`.

**Approche** : créer manuellement les comptes dans le nouveau Supabase via le
dashboard Auth → "Add user" (avec le même email). Le gérant devra demander un
reset de mot de passe à la première connexion.

**Alternative scriptée** (plus rapide pour plusieurs comptes) :
```bash
# Pour chaque user manager/cashier, copier email + role + staff_id
# Le password est non-recopiable (hash bcrypt non-portable entre instances).
# Le gérant fera "Mot de passe oublié" à la première connexion.
```

### 2.3 Restore dans le nouveau Supabase

```powershell
# Connection string du DESTINATION (nouveau Aboodhairsalon)
$DEST_DB = "postgresql://postgres.wgijrxzgimkfljgmkrqk:PASSWORD@aws-0-eu-central-1.pooler.supabase.com:6543/postgres"

# Restore le dump
psql $DEST_DB -f aboodhairsalon_data_YYYYMMDD_HHMM.sql

# Vérifier
psql $DEST_DB -c "select count(*) from bookings;"
# Doit matcher le count du dump
```

### 2.4 Migrer le bucket Storage (galerie photos)

```powershell
# Lister les objets du bucket source
npx supabase storage --linked-source ls salon-gallery/tenant/fa508622.../

# Re-uploader dans le bucket destination (sous un préfixe différent
# si on consolide single-tenant)
# OU: garder le préfixe UUID pour minimiser le diff
```

**Simplification** : si la galerie a < 20 photos, refaire l'upload manuellement
via /manager → Galerie. Plus rapide que scripter pg_dump du bucket.

---

## Étape 3 — Déployer sur Vercel (30-45 min)

### 3.1 Créer le projet Vercel

⚠️ **VÉRIFIER LE COMPTE VERCEL** : le compte `egyptttw` sert à un autre projet,
NE PAS y déployer Aboodhairsalon. Utiliser un compte dédié (créer si besoin).

```powershell
cd C:\Users\wiinc\aboodhairsalon
npx vercel login
# Choisir le compte aboodhairsalon
npx vercel link
# Confirmer le projet : aboodhairsalon
```

### 3.2 Configurer les env vars

Dans le dashboard Vercel → Project → Settings → Environment Variables.
Copier toutes les vars depuis `.env.local` (sauf NEXT_PUBLIC_APP_URL qui devient
`https://aboodhairsalon.com`).

Variables critiques :
- `NEXT_PUBLIC_SUPABASE_URL` = https://wgijrxzgimkfljgmkrqk.supabase.co
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = sb_publishable_...
- `SUPABASE_SERVICE_ROLE_KEY` = sb_secret_... (récupéré du dashboard)
- `RESEND_API_KEY` = re_...
- `CLIENT_TOKEN_SECRET` = openssl rand -hex 32
- `CRON_SECRET` = openssl rand -hex 32
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` (générés avec
  `npx web-push generate-vapid-keys`)

### 3.3 Premier déploiement

```powershell
npx vercel --prod
# OU push sur main → auto-deploy si Git Integration configurée
```

URL Vercel temporaire : `aboodhairsalon.vercel.app`. Tester :
- Login manager (avec compte créé en 2.2)
- Une page caisse
- Booking client public

---

## Étape 4 — Configurer les domaines (15 min code + 24h propagation DNS)

### 4.1 Ajouter les domaines dans Vercel

Project → Domains → Add :
- `aboodhairsalon.com` (apex)
- `www.aboodhairsalon.com`
- `cashier.aboodhairsalon.com`
- `manager.aboodhairsalon.com`
- (optionnel) `book.aboodhairsalon.com`

Vercel donne des records DNS à configurer.

### 4.2 Configurer les DNS chez IONOS

⚠️ **Sécurité** : ne modifier les DNS d'aboodhairsalon.com QU'APRÈS avoir
validé l'app sur l'URL temporaire Vercel. Une fois le DNS switch, plus de retour
en arrière sans 4-48h de re-propagation.

Sur IONOS → Domain → DNS records :

**Apex (aboodhairsalon.com)** :
```
Type: A
Name: @
Value: 76.76.21.21  (IP Vercel apex)
TTL: 3600
```

**Subdomains (www, cashier, manager)** :
```
Type: CNAME
Name: www | cashier | manager
Value: cname.vercel-dns.com
TTL: 3600
```

Propagation : 5 min à 24h selon le TTL existant. Vérifier avec :
```powershell
nslookup aboodhairsalon.com
nslookup cashier.aboodhairsalon.com
```

### 4.3 Vérifier le domaine Resend

Aller sur Resend → Domains → aboodhairsalon.com (probablement déjà vérifié dans
System A). Si pas vérifié, copier les 3 records DKIM/SPF/DMARC dans IONOS.

---

## Étape 5 — Test smoke sur le nouveau prod (30 min)

Une fois les DNS propagés :

1. **Login Manager** : `manager.aboodhairsalon.com/login` → entrer email + mot
   de passe (reset à la première connexion si pas migré le hash)
2. **Dashboard** : vérifier que les chiffres matchent System A
3. **Booking public** : `aboodhairsalon.com` → faire un test booking complet
   (Service → Date → Time → Confirm) avec un compte test
4. **Caisse** : `cashier.aboodhairsalon.com/login` → faire une vente test
5. **Email** : vérifier qu'un email de confirmation arrive (depuis le test
   booking) ET qu'il est bien `From: Aboodhairsalon <noreply@aboodhairsalon.com>`
6. **PWA** : installer manifest depuis /client + vérifier favicon
7. **Push notifications** : autoriser depuis /client et faire un test
8. **Sys-diag** : `manager.aboodhairsalon.com/sys-diag` → check env vars

Si une de ces étapes échoue, **NE PAS POURSUIVRE** vers l'étape 6. Diagnostiquer
+ fix avant cutover réel.

---

## Étape 6 — Cutover client (déclencheur : tu donnes feu vert)

À ce stade le nouveau prod est validé. La DB du salon a 2 versions :
- System A (anciens RDV/ventes) — toujours servis si quelqu'un tape
  l'URL Vercel originale
- Nouveau Supabase (RDV/ventes migrés) — servi par les domaines aboodhairsalon.com

### 6.1 Annonce à l'équipe

Envoyer message WhatsApp à Abood + équipe :
> "À partir de [DATE/HEURE], on bascule sur le nouveau système. Les liens
> habituels (cashier.aboodhairsalon.com, manager.aboodhairsalon.com) restent
> identiques. Si quelque chose vous semble bizarre, prévenez immédiatement."

### 6.2 Période d'observation 7 jours

Pendant 7 jours :
- Surveiller les logs Vercel (Function Logs) pour erreurs
- Vérifier que les emails de confirmation partent OK (Resend logs)
- Demander au gérant un feedback quotidien

### 6.3 Données frais entrants

Pendant la période d'observation, **TOUTES** les nouvelles données vont dans
le nouveau Supabase. Le tenant Aboodhairsalon dans System A devient gelé.

---

## Étape 7 — Cleanup System A (J+7 minimum)

### 7.1 Archiver le tenant dans System A

```sql
-- Sur le Supabase System A
UPDATE public.tenants
  SET status = 'archived',
      slug = 'archived-aboodhairsalon-' || extract(epoch from now())::text
  WHERE id = 'fa508622-b027-4907-9508-afd2e9f83eeb';
```

Le rename de slug évite collision si un autre tenant veut le slug
`aboodhairsalon` un jour.

### 7.2 Supprimer le tenant + cascade (J+30)

```sql
-- ⚠️ IRRÉVERSIBLE — backup le Supabase System A AVANT
DELETE FROM public.tenants
  WHERE id = 'fa508622-b027-4907-9508-afd2e9f83eeb';
-- Cascade : booking, sales, services, etc. supprimés (FK ON DELETE CASCADE)
```

### 7.3 Supprimer la route /site du code System A

Une fois Aboodhairsalon supprimé, plus aucun tenant n'utilise role_path=/site.
Supprimer le code :

```powershell
cd C:\Users\wiinc\system A
git rm -r apps/tenant/src/app/site/
git commit -m "chore: drop /site route (was Aboodhairsalon-specific)"
git push
```

### 7.4 Supprimer le bucket Storage source

Sur Supabase System A → Storage → Buckets → `salon-gallery` → supprimer le
préfixe `tenant/fa508622-.../` (les fichiers migrés vers le nouveau bucket).

---

## Rollback (si quelque chose tourne mal)

À tout moment AVANT l'étape 7, on peut revenir en arrière :
1. Sur IONOS DNS, repointer les records vers Vercel System A (anciens IPs)
2. Propagation 5-30 min
3. Communiquer le rollback à Abood

L'ancien tenant + données restent intacts dans System A tant que l'étape 7
n'a pas été faite.

---

## Annexe — Decisions log à remplir pendant le cutover

| Décision | Date | Choix | Raison |
| -------- | ---- | ----- | ------ |
| Option schéma (A ou B) | | | |
| Migration users (manuel ou scripté) | | | |
| Storage bucket migration (préfixe UUID conservé ou aboodhairsalon/) | | | |
| Période d'observation (jours) | | | |
| Vercel compte cible (lequel exactement) | | | |
| Date du cutover effectif | | | |
