-- =============================================================================
-- 0024_push_subscriptions_tenant_check.sql — durcissement RLS
-- =============================================================================
--
-- La policy `push_subscriptions_self` (cf. 0022) couvrait `user_id = auth.uid()`
-- mais laissait `tenant_id` libre. Un user authentifié pouvait insérer une
-- subscription avec un `tenant_id` ≠ son tenant (via une autre route où le
-- filtre serveur aurait été oublié) → cross-tenant write.
--
-- On ajoute la contrainte `tenant_id = public.current_tenant_id()` sur le
-- WITH CHECK pour défendre en profondeur — même si une Server Action future
-- oublie le filtre, la DB rejette.
-- =============================================================================

drop policy if exists push_subscriptions_self on public.push_subscriptions;

create policy push_subscriptions_self on public.push_subscriptions
  for all
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and tenant_id = public.current_tenant_id()
  );
