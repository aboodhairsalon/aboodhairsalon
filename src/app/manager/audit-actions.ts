'use server';
/**
 * Server Actions — consultation du journal d'audit (audit_log).
 *
 * Le journal est rempli automatiquement par les triggers `audit_changes`
 * (migration 0001) sur les tables sensibles (sales, refunds, bookings,
 * client_profiles, etc.) ET manuellement par certaines actions critiques
 * (changement email côté client/manager, suppression RGPD, etc.).
 *
 * Cette action expose un GET paginé pour le manager — pas d'écriture
 * (l'audit est strictement read-only depuis l'app).
 *
 * Audit T5.28.
 */
import { createAdminClient } from '@/db';
import { requireTenant } from '../_data/auth-server';
import { rlManagerRead } from '../_lib/rate-limit';
import type { ManagerErrorCode, ManagerErrorValues } from './actions';

export type AuditLogEntry = {
  id: number;
  tenantId: string | null;
  actorId: string | null;
  tableName: string;
  rowId: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  diff: unknown;
  at: string;
};

export type GetAuditLogResult =
  | { ok: true; entries: AuditLogEntry[] }
  | { ok: false; errorKey: ManagerErrorCode; errorValues?: ManagerErrorValues };

export interface GetAuditLogInput {
  /** Filtre par table (ex. 'sales', 'bookings'). NULL = toutes les tables. */
  tableName?: string;
  /** Pagination — offset 0-indexed, limit max 200. */
  limit?: number;
}

/**
 * Récupère les dernières entrées du journal d'audit pour le tenant connecté.
 * Garde stricte : seul le gérant peut lire (pas le caissier — sinon il aurait
 * accès à l'historique des modifications faites par le manager).
 */
export async function getAuditLog(input: GetAuditLogInput = {}): Promise<GetAuditLogResult> {
  const ctx = await requireTenant();
  // Rate-limit pour eviter qu'un script ne sature le serveur en aspirant
  // tout le journal (peut-etre des milliers d'entrees).
  if (!(await rlManagerRead(ctx.user.id))) {
    return { ok: false, errorKey: 'rateLimited' };
  }

  const limit = Math.max(1, Math.min(200, Math.round(input.limit ?? 50)));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  let query = admin
    .from('audit_log')
    .select('id, tenant_id, actor_id, table_name, row_id, operation, diff, at')
    
    .order('at', { ascending: false })
    .limit(limit);

  if (input.tableName) {
    query = query.eq('table_name', input.tableName);
  }

  const { data, error } = await query;

  if (error) {
    return {
      ok: false,
      errorKey: 'dbError',
      errorValues: { message: (error as { message?: string }).message ?? '' },
    };
  }

  const entries: AuditLogEntry[] = (
    (data as
      | {
          id: number;
          tenant_id: string | null;
          actor_id: string | null;
          table_name: string;
          row_id: string;
          operation: string;
          diff: unknown;
          at: string;
        }[]
      | null) ?? []
  ).map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    actorId: r.actor_id,
    tableName: r.table_name,
    rowId: r.row_id,
    operation:
      r.operation === 'INSERT' || r.operation === 'UPDATE' || r.operation === 'DELETE'
        ? r.operation
        : 'UPDATE',
    diff: r.diff,
    at: r.at,
  }));

  return { ok: true, entries };
}
