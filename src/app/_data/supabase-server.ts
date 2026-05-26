import 'server-only';
/**
 * Wrapper Supabase SERVER pour /apps/tenant.
 *
 * À utiliser dans Server Components, Route Handlers, Server Actions.
 * Lit/écrit la session via les cookies Next.js.
 *
 * Pour les composants client (`'use client'`), utilise `./supabase.ts` à la place.
 */
import { createServerClient } from '@/db';
import { cookies } from 'next/headers';

export async function getServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient({
    getAll: () => cookieStore.getAll().map((c) => ({ name: c.name, value: c.value })),
    setAll: (next) => {
      try {
        next.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2]);
        });
      } catch {
        // setAll appelé depuis un Server Component (pas autorisé par Next).
        // Ignoré : le middleware ou un Route Handler tiendra la session.
      }
    },
  });
}
