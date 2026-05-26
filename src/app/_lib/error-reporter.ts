/**
 * error-reporter — wrapper léger pour le reporting d'erreurs prod.
 *
 * **Etat actuel** : pas de Sentry installé (impact bundle + clés). Cette
 * couche d'abstraction permet de basculer vers Sentry/Axiom/Better Stack
 * sans refactor ailleurs dans le codebase. Pour le moment elle log dans
 * `console.error` (visible dans Vercel Functions logs + Vercel Dashboard).
 *
 * **Activation Sentry future** :
 *  1. `pnpm add @sentry/nextjs` dans apps/tenant
 *  2. Créer `sentry.client.config.ts`, `sentry.server.config.ts`,
 *     `sentry.edge.config.ts` à la racine de apps/tenant
 *  3. Wrapper `next.config.ts` avec `withSentryConfig`
 *  4. Modifier `reportError()` ci-dessous pour appeler `Sentry.captureException`
 *  5. Poser `SENTRY_DSN` dans Vercel env vars
 *
 * Côté usage : `reportError(e, { feature: 'refund-email', tenantId })` dans
 * les catch blocks fire-and-forget — la structure additionnelle aide a filtrer
 * par feature dans Sentry plus tard.
 */

export interface ErrorContext {
  feature?: string;
  tenantId?: string;
  userId?: string;
  /** Metadata libre — sera envoyé en tags Sentry quand on installera. */
  [key: string]: string | number | boolean | null | undefined;
}

/**
 * Reporte une erreur au système de monitoring + log console.
 * Best-effort : si Sentry est down, on retombe sur console.
 */
export function reportError(error: unknown, context?: ErrorContext): void {
  const errorMessage =
    error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  // Console log structuré — visible dans Vercel Functions logs.
  // Format compatible Vercel Logs query : on peut filtrer par `tag.feature=...`.
   
  console.error('[error-reporter]', {
    message: errorMessage,
    stack,
    context: context ?? {},
    timestamp: new Date().toISOString(),
  });

  // TODO: brancher Sentry/Axiom ici quand SENTRY_DSN est posée :
  //   if (process.env.SENTRY_DSN && typeof Sentry !== 'undefined') {
  //     Sentry.captureException(error, { tags: context });
  //   }
}

/**
 * Wrapper pour les fire-and-forget — log mais ne propage pas.
 * Utilisable en `.catch(reportAndSwallow('feature-name'))`.
 */
export function reportAndSwallow(feature: string, extraContext?: ErrorContext) {
  return (error: unknown): void => {
    reportError(error, { feature, ...extraContext });
  };
}
