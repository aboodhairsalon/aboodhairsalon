# Migrations — Aboodhairsalon (single-tenant)

## État actuel

Les 38 migrations actuelles dans ce dossier sont une **copie brute des migrations
System A multi-tenant**. Elles SONT KEEP pour référence mais N'ONT PAS encore été
adaptées au schéma single-tenant.

Avant le premier `supabase db push` sur le nouveau projet, il faut :

1. **Décider de la stratégie** :
   - **A.** Garder les 38 migrations, les appliquer telles quelles → on aurait
     une copie identique du schéma System A, MAIS avec un seul tenant en base.
     Avantage : aucune refactor à faire, code tenant-aware fonctionne tel quel.
     Inconvénient : on transporte le schema multi-tenant pour rien.
   - **B.** Consolider en une seule migration `0001_init.sql` propre, sans
     tenant_id, sans tables `tenants/tenant_branding/tenant_settings/tenant_role_domains`.
     Avantage : schema clean, single-tenant natif.
     Inconvénient : 1500+ lignes de SQL à écrire, refactor de tous les server actions.

2. **Recommandation : Option A pour la mise en prod rapide** (cf. handoff doc).
   Avantages :
   - Le code copié de System A continue à marcher tel quel (les requêtes
     `.eq('tenant_id', X)` ont été stripées par sed dans la Phase B2 du fork,
     mais le schema reste compatible avec un éventuel rollback ou support
     temporaire de plusieurs salons sur le même schéma).
   - On peut migrer les données existantes d'Aboodhairsalon depuis le Supabase
     System A directement (pg_dump / pg_restore avec filtre `tenant_id = '<uuid>'`).
   - La consolidation Option B peut se faire dans 6 mois quand on est sûr
     du schéma final.

3. **Action immédiate (option A)** :
   - Renommer les migrations 0001 → 0001 (garder l'ordre)
   - Créer 0039_salon_settings.sql qui ajoute la table mono-tenant `salon_settings`
     (1 ligne unique, miroir simplifié de `tenant_settings`)
   - Apply via `pnpm supabase db push`
   - Migrer les data d'Aboodhairsalon depuis l'ancien projet

## Décision pendante (à valider avec le gérant + équipe technique)

**Faut-il garder le schéma multi-tenant en base alors qu'il n'y a qu'un salon ?**

- ✅ **Oui** (Option A) : flexibilité future, faible coût de stockage,
  compatibilité totale avec le code copié, migration de données plus simple.
- ❌ **Non** (Option B) : nettoyage architectural strict, schéma plus simple
  à expliquer aux futurs devs, RLS plus simple.

Le choix dépend de la doctrine équipe : "boil the ocean" pencherait pour B,
"ship fast" penche pour A.

## Migration des données existantes (Aboodhairsalon)

Le tenant Aboodhairsalon a actuellement l'UUID `fa508622-b027-4907-9508-afd2e9f83eeb`
dans le Supabase System A. Pour migrer :

### Option A — schéma identique

```bash
# Sur le Supabase System A : dump filtered
pg_dump --schema=public --data-only \
  --table=bookings --table=sales --table=sale_items --table=refunds \
  --table=services --table=products --table=staff --table=client_profiles \
  --table=barber_reviews --table=tenant_gallery --table=push_subscriptions \
  --where="tenant_id='fa508622-b027-4907-9508-afd2e9f83eeb'" \
  > aboodhairsalon_data.sql

# Sur le nouveau Supabase Aboodhairsalon : restore
psql -f aboodhairsalon_data.sql
```

### Option B — schéma transformé

Plus complexe : il faudra un script SQL/Python qui :
- Lit chaque table avec `tenant_id = 'fa508622-...'`
- Strip la colonne tenant_id
- INSERT dans la table équivalente du nouveau projet

## Schéma cible (réflexion long terme)

Pour un single-tenant clean :

| Table System A                | Devient                                              |
| ----------------------------- | ---------------------------------------------------- |
| `tenants`                     | ❌ SUPPRIMÉ (1 ligne, c'est nous — `@/config/salon`) |
| `tenant_branding`             | ❌ SUPPRIMÉ (couleurs hardcodées en globals.css)     |
| `tenant_settings`             | ✅ Renommé `salon_settings` (1 ligne unique)         |
| `tenant_role_domains`         | ❌ SUPPRIMÉ (subdomain routing via middleware)       |
| `tenant_gallery`              | ✅ Renommé `gallery`                                  |
| `bookings`                    | ✅ Garde, drop `tenant_id`                            |
| `sales`, `sale_items`, `refunds` | ✅ Garde, drop `tenant_id`                         |
| `services`, `products`        | ✅ Garde, drop `tenant_id`                            |
| `staff`                       | ✅ Garde, drop `tenant_id`                            |
| `client_profiles`             | ✅ Garde, drop `tenant_id`                            |
| `barber_reviews`              | ✅ Garde, drop `tenant_id`                            |
| `push_subscriptions`          | ✅ Garde, drop `tenant_id`                            |
| `audit_log`                   | ✅ Garde, drop `tenant_id`                            |
| `super_admins`                | ❌ SUPPRIMÉ (pas de multi-salons)                    |
