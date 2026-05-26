'use client';

/**
 * AuditLogModal — affiche les 50 dernieres entrees du journal d'audit
 * pour le tenant connecte. Filtres par table optionnels.
 *
 * Audit T5.28. Volontairement basique : on liste les entries avec leur
 * table, operation, timestamp et un blob JSON tronque. Pour creuser un
 * cas précis le manager peut copier le row_id et chercher en DB.
 */
import { History, Loader2, RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { Modal, Tag } from '@/components';
import { useTenantOrNull } from '../_components/TenantProvider';
import { getAuditLog, type AuditLogEntry } from './audit-actions';

const TABLE_FILTERS = ['', 'sales', 'bookings', 'client_profiles', 'staff', 'services', 'products'];

export function AuditLogModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('manager.auditLog');
  const locale = useLocale();
  const session = useTenantOrNull();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [tableFilter, setTableFilter] = useState<string>('');
  const [loading, startLoading] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Auto-refresh à l'ouverture + à chaque changement de filtre. La fonction
  // est inlineée dans le useEffect pour éviter la dépendance circulaire avec
  // startLoading (useTransition est stable).
  useEffect(() => {
    if (!open) return;
    startLoading(async () => {
      setError(null);
      const res = await getAuditLog({
        tableName: tableFilter || undefined,
        limit: 50,
      });
      if (res.ok) {
        setEntries(res.entries);
      } else {
        setError(res.errorKey);
      }
    });
  }, [open, tableFilter, startLoading]);

  const refresh = () => {
    startLoading(async () => {
      setError(null);
      const res = await getAuditLog({
        tableName: tableFilter || undefined,
        limit: 50,
      });
      if (res.ok) {
        setEntries(res.entries);
      } else {
        setError(res.errorKey);
      }
    });
  };

  if (!session) return null;

  const bcp47 = locale === 'ar' ? 'ar-EG' : locale === 'en' ? 'en-US' : 'fr-FR';
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString(bcp47, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const operationTone = (op: AuditLogEntry['operation']): 'green' | 'copper' | 'red' => {
    switch (op) {
      case 'INSERT':
        return 'green';
      case 'UPDATE':
        return 'copper';
      case 'DELETE':
        return 'red';
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('title')} wide>
      <div className="space-y-4">
        <p className="text-ink-mute text-xs">{t('description')}</p>

        {/* Filtre par table */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="mono text-ink-soft text-[10px] uppercase tracking-[0.2em]">
            {t('filterLabel')}
          </span>
          {TABLE_FILTERS.map((tbl) => (
            <button
              key={tbl || 'all'}
              type="button"
              onClick={() => setTableFilter(tbl)}
              className={`mono rounded-sm border px-2.5 py-1 text-[10px] uppercase tracking-wider transition-colors ${
                tableFilter === tbl
                  ? 'border-brand-primary bg-brand-primary/10 text-brand-primary'
                  : 'border-line text-ink-soft hover:border-brand-primary/50'
              }`}
            >
              {tbl || t('filterAll')}
            </button>
          ))}
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="btn-press border-line text-ink-soft hover:text-brand-primary ml-auto inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[10px] disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            <span className="mono uppercase tracking-wider">{t('refresh')}</span>
          </button>
        </div>

        {/* Erreur */}
        {error && (
          <div className="bg-red/10 border-red/30 text-red rounded-sm border px-3 py-2 text-xs">
            {t('errorLoading')}
          </div>
        )}

        {/* Liste */}
        {loading && entries.length === 0 ? (
          <div className="text-ink-soft flex items-center justify-center gap-2 py-12">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-xs">{t('loading')}</span>
          </div>
        ) : entries.length === 0 ? (
          <div className="text-ink-soft py-12 text-center">
            <History className="mx-auto mb-2 h-6 w-6 opacity-60" strokeWidth={1.2} />
            <p className="text-xs">{t('empty')}</p>
          </div>
        ) : (
          <ul className="border-line max-h-[60vh] divide-y overflow-y-auto rounded-sm border">
            {entries.map((e) => (
              <li key={e.id} className="p-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag tone={operationTone(e.operation)}>
                    <span className="mono text-[9px] uppercase tracking-wider">{e.operation}</span>
                  </Tag>
                  <span className="mono text-ink font-semibold">{e.tableName}</span>
                  <span className="text-ink-soft mono text-[10px]">#{e.rowId.slice(0, 8)}</span>
                  <span className="mono text-ink-mute ms-auto text-[10px]">{fmtDate(e.at)}</span>
                </div>
                {e.diff !== null && e.diff !== undefined ? (
                  <pre className="bg-bg-soft text-ink-mute mono mt-2 max-h-32 overflow-auto rounded-sm p-2 text-[10px]">
                    {JSON.stringify(e.diff, null, 2).slice(0, 600)}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
