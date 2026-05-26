/**
 * Middleware Aboodhairsalon — single-tenant.
 *
 * Différences MAJEURES avec System A multi-tenant :
 *  - Pas de résolution tenant (DB lookup supprimé)
 *  - Pas de headers `x-tenant-*` (le tenant est implicite — c'est nous)
 *  - Pas de path-based slug routing (`/aboodhairsalon/cashier`)
 *  - Pas de canonicalisation cross-subdomain
 *
 * Responsabilités :
 *  1. Refresh de session Supabase (rotation des cookies SSR) — critique pour
 *     ne pas avoir de sessions expirées silencieusement côté Server Components.
 *  2. Routing par sous-domaine en production :
 *       - aboodhairsalon.com (apex)        → '/'         (vitrine + booking)
 *       - cashier.aboodhairsalon.com       → '/cashier'  (rewrite root)
 *       - manager.aboodhairsalon.com       → '/manager'  (rewrite root)
 *     En dev local, tout passe par localhost:3000 et le routing se fait par
 *     pathname natif. Pas de rewrite — on tape directement /cashier, /manager.
 *  3. Pose le header `x-pathname` avec le pathname effectif (après éventuel
 *     rewrite) pour que `i18n/request.ts` puisse choisir la locale par défaut
 *     selon la route (EN pour booking client, FR pour cashier/manager).
 *
 * Edge-runtime compatible : zero Node-only imports.
 */
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const SUPABASE_URL = process.env['NEXT_PUBLIC_SUPABASE_URL'];
const SUPABASE_ANON_KEY = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

/** Paths qui n'ont JAMAIS besoin de middleware (assets, healthchecks). */
const PUBLIC_PATHS = ['/_next', '/favicon.ico', '/api/health', '/sitemap.xml', '/robots.txt'];

/**
 * Détermine la "space" en fonction du host. Sert au rewrite root-path.
 *  - cashier.* → 'cashier'
 *  - manager.* → 'manager'
 *  - sinon (apex, www, localhost) → 'site' (vitrine + booking)
 */
function detectSpace(host: string): 'site' | 'cashier' | 'manager' {
  const h = host.split(':')[0]?.toLowerCase() ?? '';
  if (h.startsWith('cashier.')) return 'cashier';
  if (h.startsWith('manager.')) return 'manager';
  return 'site';
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Préparer la response de base — sera modifiée si Supabase pose des cookies
  // refresh (rotation token).
  let response = NextResponse.next({ request: { headers: request.headers } });

  // ── 1) Refresh session Supabase ────────────────────────────────────────
  // CRITIQUE : sans ce refresh, les tokens expirent silencieusement et les
  // Server Components voient des sessions périmées. `getUser()` force la
  // rotation si le token est expiré.
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet: { name: string; value: string; options: CookieOptions }[]) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: request.headers } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });
    await supabase.auth.getUser();
  }

  // ── 2) Subdomain routing ───────────────────────────────────────────────
  const host = request.headers.get('host') ?? '';
  const space = detectSpace(host);

  // Rewrites internes uniquement quand le path est `/` (URL bar reste à `/`,
  // Next.js sert le contenu de l'espace correspondant). Sinon on respecte le
  // pathname demandé (ex. /book/abc, /cashier/log).
  //   - aboodhairsalon.com/        → /client  (booking PWA, espace public)
  //   - cashier.aboodhairsalon.com/ → /cashier
  //   - manager.aboodhairsalon.com/ → /manager
  let effectivePathname = pathname;
  if (pathname === '/') {
    if (space === 'cashier') effectivePathname = '/cashier';
    else if (space === 'manager') effectivePathname = '/manager';
    else effectivePathname = '/client';
  }

  // ── 3) Pose x-pathname pour i18n ────────────────────────────────────────
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', effectivePathname);

  // Si on doit faire un rewrite, on le fait ici.
  if (effectivePathname !== pathname) {
    const url = request.nextUrl.clone();
    url.pathname = effectivePathname;
    const rewriteResponse = NextResponse.rewrite(url, { request: { headers: requestHeaders } });
    // Recopier les cookies posés par Supabase refresh.
    response.cookies.getAll().forEach((c) => rewriteResponse.cookies.set(c.name, c.value, c));
    return rewriteResponse;
  }

  // Sinon, recréer la response avec les headers modifiés + cookies refresh.
  const finalResponse = NextResponse.next({ request: { headers: requestHeaders } });
  response.cookies.getAll().forEach((c) => finalResponse.cookies.set(c.name, c.value, c));
  return finalResponse;
}

export const config = {
  matcher: [
    /*
     * Match toutes les requêtes SAUF :
     *  - _next/static (assets statiques)
     *  - _next/image (image optimizer)
     *  - favicon.ico, robots.txt, sitemap.xml
     */
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};
