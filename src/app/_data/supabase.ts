/**
 * Wrapper Supabase BROWSER pour /apps/tenant.
 *
 * Lazy singleton — réutilise la même instance entre composants `'use client'`
 * pour partager la session cookie.
 *
 * Pour le server-side (RSC, Route Handlers, Server Actions), utilise
 * `./supabase-server.ts` à la place — ce fichier-ci ne doit JAMAIS importer
 * `next/headers` ou autre module server-only.
 */
import { createBrowserClient } from '@/db';

let _browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function getBrowserClient() {
  if (!_browserClient) _browserClient = createBrowserClient();
  return _browserClient;
}
