-- =============================================================================
-- 0029_gallery_storage_bucket.sql — placeholder (bucket créé via script)
-- =============================================================================
--
-- Supabase ne permet pas d'altérer `storage.buckets` via les migrations SQL
-- standard (must be owner of relation). Le bucket `salon-gallery` est donc
-- créé via le script `scripts/setup-storage-buckets.mjs` qui utilise l'API
-- admin Storage (service_role JWT).
--
-- Cette migration est un placeholder pour documenter l'ordre de migration
-- et permettre à `supabase db push` de tracker que l'étape est franchie.
-- =============================================================================

-- No-op (placeholder)
do $$
begin
  raise notice 'Bucket salon-gallery created via scripts/setup-storage-buckets.mjs';
end$$;
