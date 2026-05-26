import { createServerClient as supabaseServerClient } from '@supabase/ssr';
import type { Database } from './types';

type CookieAdapter = {
  getAll: () => { name: string; value: string }[];
  setAll: (cookies: { name: string; value: string; options?: Record<string, unknown> }[]) => void;
};

/**
 * Server-side Supabase client (RSC, Server Actions, Route Handlers).
 * Caller must wire Next.js cookies() into the adapter.
 */
export function createServerClient(cookies: CookieAdapter) {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const anon = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  if (!url || !anon) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  return supabaseServerClient<Database>(url, anon, {
    cookies: {
      getAll: cookies.getAll,
      setAll: cookies.setAll,
    },
  });
}
