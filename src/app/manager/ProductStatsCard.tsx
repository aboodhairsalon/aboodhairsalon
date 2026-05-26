'use client';

/**
 * ProductStatsCard — top vendeurs sur la fenêtre choisie (défaut 30 j).
 *
 * Affiché sous la table d'inventaire dans l'onglet Stock. Charge à la
 * demande au montage (pas pré-chargé pour ne pas peser sur le bundle initial
 * du Manager). En mode démo publique (pas de tenantId), rend null.
 *
 * Le composant agrège déjà côté serveur via `getProductStats` ; ici on se
 * contente de formater + ranger en table.
 */
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Card } from '@/components';
import { useFmtMoney } from '../_data/local-state';
import { useTenantOrNull } from '../_components/TenantProvider';
import { getProductStats, type ProductStatRow } from './product-stats-actions';

function toBcp47(locale: string): string {
  return locale === 'ar' ? 'ar-EG' : locale === 'en' ? 'en-US' : 'fr-FR';
}

export function ProductStatsCard({ periodDays = 30 }: { periodDays?: number }) {
  const t = useTranslations('manager.stock.stats');
  const tErrors = useTranslations('manager.errors');
  const locale = useLocale();
  const bcp47 = toBcp47(locale);
  const fmt = useFmtMoney();
  const session = useTenantOrNull();
  const tenantId = session?.tenant.id;

  const [rows, setRows] = useState<ProductStatRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    void getProductStats(tenantId, periodDays).then((res) => {
      if (!alive) return;
      if (res.ok) setRows(res.rows);
      else setError(tErrors(res.errorKey as 'dbError', res.errorValues));
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [tenantId, periodDays, tErrors]);

  // Mode démo public (pas de tenant) : on ne rend rien — pas de données.
  if (!tenantId) return null;

  // Totaux agrégés (footer de la table).
  const totalQty = (rows ?? []).reduce((s, r) => s + r.qtySold, 0);
  const totalRevenue = (rows ?? []).reduce((s, r) => s + r.revenueCents, 0);
  const totalMargin = (rows ?? []).reduce((s, r) => s + r.marginCents, 0);

  // Format nombre selon BCP47 (séparateurs de milliers localisés).
  const fmtInt = (n: number) => new Intl.NumberFormat(bcp47).format(n);

  return (
    <div className="mt-10">
      <div className="mb-5">
        <h3 className="display text-2xl">{t('title')}</h3>
        <p className="text-ink-mute mt-1 text-sm">{t('subtitle', { days: periodDays })}</p>
      </div>

      {loading && (
        <Card className="p-8 text-center">
          <div className="text-ink-soft text-sm">{t('loading')}</div>
        </Card>
      )}

      {!loading && error && (
        <Card className="p-6">
          <div className="text-red text-sm font-semibold">{t('errorTitle')}</div>
          <div className="text-ink-mute mt-1 text-xs">{error}</div>
        </Card>
      )}

      {!loading && !error && rows !== null && rows.length === 0 && (
        <Card className="py-12 text-center">
          <p className="text-ink-mute mx-auto max-w-md text-sm">{t('empty')}</p>
        </Card>
      )}

      {!loading && !error && rows !== null && rows.length > 0 && (
        <Card className="overflow-hidden">
          <div className="scrollbar overflow-x-auto">
            <div className="border-line mono text-ink-soft grid min-w-[720px] grid-cols-[40px_1fr_80px_110px_110px_110px_90px] gap-3 border-b px-5 py-3 text-[9px] uppercase tracking-[0.25em]">
              <div>{t('colRank')}</div>
              <div>{t('colProduct')}</div>
              <div className="text-end">{t('colQty')}</div>
              <div className="text-end">{t('colRevenue')}</div>
              <div className="text-end">{t('colCost')}</div>
              <div className="text-end">{t('colMargin')}</div>
              <div className="text-end">{t('colMarginPct')}</div>
            </div>
            {rows.map((r, i) => (
              <div
                key={r.productId ?? `orphan-${i}`}
                className="border-line grid min-w-[720px] grid-cols-[40px_1fr_80px_110px_110px_110px_90px] items-center gap-3 border-b px-5 py-4 text-sm last:border-0"
              >
                <div className="mono text-brand-primary font-semibold">{i + 1}</div>
                <div className="min-w-0">
                  <div className="text-ink truncate font-semibold">{r.name}</div>
                  {r.sku && (
                    <div className="mono text-ink-soft text-[10px] uppercase tracking-wider">
                      {r.sku}
                    </div>
                  )}
                </div>
                <div className="mono text-ink text-end">{fmtInt(r.qtySold)}</div>
                <div className="mono text-end">{fmt(r.revenueCents)}</div>
                <div className="mono text-ink-mute text-end">{fmt(r.costCents)}</div>
                <div
                  className={`mono text-end font-semibold ${
                    r.marginCents > 0
                      ? 'text-green'
                      : r.marginCents < 0
                        ? 'text-red'
                        : 'text-ink-soft'
                  }`}
                >
                  {fmt(r.marginCents)}
                </div>
                <div className="mono text-ink-soft text-end">
                  {r.marginPct === null ? '—' : `${r.marginPct}%`}
                </div>
              </div>
            ))}
            {/* Footer totaux */}
            <div className="border-line bg-bg-soft grid min-w-[720px] grid-cols-[40px_1fr_80px_110px_110px_110px_90px] items-center gap-3 border-t px-5 py-3 text-sm">
              <div />
              <div className="mono text-ink-soft text-[10px] uppercase tracking-wider">
                {t('totalRevenue')}
              </div>
              <div className="mono text-ink text-end font-semibold">{fmtInt(totalQty)}</div>
              <div className="mono text-brand-primary text-end font-semibold">
                {fmt(totalRevenue)}
              </div>
              <div />
              <div
                className={`mono text-end font-semibold ${
                  totalMargin > 0 ? 'text-green' : totalMargin < 0 ? 'text-red' : 'text-ink-soft'
                }`}
              >
                {fmt(totalMargin)}
              </div>
              <div />
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
