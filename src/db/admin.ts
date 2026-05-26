import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

/**
 * Service-role Supabase client. NEVER expose to the browser.
 * Use ONLY in Edge Functions, cron jobs, and trusted server contexts.
 * Bypasses RLS — handle with extreme care (CLAUDE.md §SÉCURITÉ).
 */
export function createAdminClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRole = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !serviceRole) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient<Database>(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
