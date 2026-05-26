import { createBrowserClient as supabaseBrowserClient } from '@supabase/ssr';
import type { Database } from './types';

/**
 * Browser-side Supabase client.
 * Reads anon key from NEXT_PUBLIC_SUPABASE_* env vars.
 */
export function createBrowserClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const anon = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  if (!url || !anon) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  return supabaseBrowserClient<Database>(url, anon, {
    auth: {
      // Flux implicite : les liens email (réinitialisation de mot de passe)
      // portent les tokens dans le hash de l'URL — fonctionne « cross-device »
      // (lien demandé sur un appareil, ouvert sur un autre). Le flux PKCE lie
      // le lien à l'appareil d'origine et casse ce cas d'usage. Pas d'OAuth ici.
      flowType: 'implicit',
    },
  });
}
