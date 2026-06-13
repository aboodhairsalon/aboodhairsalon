'use client';
/**
 * Onglet « Rapport » du Manager — rapport comptable détaillé par période.
 *
 * Sélecteur Jour / Semaine / Mois → appelle getAccountingReport (server action)
 * et affiche : KPI de synthèse, détail comptable (brut → net), ventilation par
 * moyen de paiement (Visa / Cash / InstaPay), ventes par prestation et par
 * produit (quel service vend le plus), et compteur de rendez-vous
 * (réalisés / absents / annulés / à venir). Export CSV (UTF-8, arabe inclus) et
 * PDF (document A4 imprimable).
 */
import {
  Banknote,
  CalendarCheck,
  CreditCard,
  Download,
  FileText,
  Receipt,
  Scissors,
  Smartphone,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { Btn, Card } from '@/components';
import { SALON } from '@/config/salon';
import { useFmtMoney } from '../_data/local-state';
import { useTenantOrNull } from '../_components/TenantProvider';
import { buildReportCsv, downloadCsv, type ReportCsvLabels } from './csv-export';
import { downloadReportPdf, type ReportPdfLabels } from '../_lib/report-pdf';
import { getAccountingReport, type AccountingReport, type ReportPeriod } from './report-actions';

const PERIODS: ReportPeriod[] = ['day', 'week', 'month'];

/** Libellés PDF statiques en anglais — fallback latin quand la locale est AR
 *  (jsPDF/Helvetica ne rend pas l'arabe). Le CSV reste 100 % localisé. */
const EN_PDF_STATIC = {
  documentTitle: 'Accounting report',
  periodLabel: 'Period',
  generatedOn: 'Generated on',
  revenueNet: 'Net revenue',
  sales: 'Sales',
  avgTicket: 'Average ticket',
  bookingsDone: 'Appointments done',
  accountingTitle: 'Accounting detail',
  gross: 'Gross revenue',
  discount: 'Discounts',
  surplus: 'Surcharges',
  cashback: 'Cashback used',
  refunded: 'Refunds',
  net: 'Net revenue',
  tips: 'Tips',
  tax: 'Taxes',
  paymentsTitle: 'Payment methods',
  visa: 'Visa',
  cash: 'Cash',
  instapay: 'InstaPay',
  other: 'Other',
  share: 'Share',
  byServiceTitle: 'Sales by service',
  byProductTitle: 'Sales by product',
  colName: 'Item',
  colQty: 'Qty',
  colRevenue: 'Revenue',
  bookingsTitle: 'Appointments',
  done: 'Completed',
  noShow: 'No-shows',
  cancelled: 'Cancelled',
  upcoming: 'Upcoming',
  total: 'Total',
};
const EN_PERIOD: Record<ReportPeriod, string> = { day: 'Day', week: 'Week', month: 'Month' };

export function ManagerReport({ isRealTenant }: { isRealTenant: boolean }) {
  const t = useTranslations('manager.report');
  const locale = useLocale();
  const fmt = useFmtMoney();
  const tenant = useTenantOrNull();

  const [period, setPeriod] = useState<ReportPeriod>('day');
  const [report, setReport] = useState<AccountingReport | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const load = useCallback(
    (p: ReportPeriod) => {
      startTransition(async () => {
        const res = await getAccountingReport(p);
        if (res.ok) {
          setReport(res.report);
          setErrorKey(null);
        } else {
          setErrorKey(res.errorKey);
        }
      });
    },
    [startTransition],
  );

  useEffect(() => {
    if (isRealTenant) load(period);
  }, [period, isRealTenant, load]);

  // Locale BCP-47 pour formater dates (affichage). Le PDF force une locale latine.
  const bcp47 = locale === 'ar' ? 'ar-EG' : locale === 'en' ? 'en-US' : 'fr-FR';
  const currencyCode = tenant?.tenant.currency ?? SALON.currency;

  /** Plage de dates affichée (bornes Le Caire), dérivée des ISO du rapport. */
  const rangeLabel = useMemo(() => {
    if (!report) return '';
    const fmtDate = (iso: string) =>
      new Intl.DateTimeFormat(bcp47, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: SALON.timezone,
      }).format(new Date(iso));
    const start = fmtDate(report.rangeStartIso);
    // Borne haute exclue → dernier jour inclus = 1 ms avant.
    const end = fmtDate(new Date(new Date(report.rangeEndIso).getTime() - 1).toISOString());
    return start === end ? start : `${start} → ${end}`;
  }, [report, bcp47]);

  function buildPdfLabels(r: AccountingReport): ReportPdfLabels {
    const isAr = locale === 'ar';
    const pdfBcp47 = locale === 'fr' ? 'fr-FR' : 'en-US'; // chiffres occidentaux, devise latine
    const dyn = {
      periodName: isAr ? EN_PERIOD[r.period] : t(`period.${r.period}`),
      range: rangeLabel,
      generatedDate: new Intl.DateTimeFormat(isAr ? 'en-US' : bcp47, {
        dateStyle: 'long',
      }).format(new Date()),
      currency: currencyCode,
      bcp47: pdfBcp47,
    };
    if (isAr) {
      return { ...EN_PDF_STATIC, periodLabel: EN_PDF_STATIC.periodLabel, ...dyn };
    }
    return {
      documentTitle: t('title'),
      periodLabel: t('pdf.period'),
      generatedOn: t('pdf.generatedOn'),
      revenueNet: t('kpi.revenueNet'),
      sales: t('kpi.sales'),
      avgTicket: t('kpi.avgTicket'),
      bookingsDone: t('kpi.bookingsDone'),
      accountingTitle: t('accounting.title'),
      gross: t('accounting.gross'),
      discount: t('accounting.discount'),
      surplus: t('accounting.surplus'),
      cashback: t('accounting.cashback'),
      refunded: t('accounting.refunded'),
      net: t('accounting.net'),
      tips: t('accounting.tips'),
      tax: t('accounting.tax'),
      paymentsTitle: t('payments.title'),
      visa: t('payments.visa'),
      cash: t('payments.cash'),
      instapay: t('payments.instapay'),
      other: t('payments.other'),
      share: t('payments.share'),
      byServiceTitle: t('byService.title'),
      byProductTitle: t('byProduct.title'),
      colName: t('cols.name'),
      colQty: t('cols.qty'),
      colRevenue: t('cols.revenue'),
      bookingsTitle: t('bookings.title'),
      done: t('bookings.done'),
      noShow: t('bookings.noShow'),
      cancelled: t('bookings.cancelled'),
      upcoming: t('bookings.upcoming'),
      total: t('bookings.total'),
      ...dyn,
    };
  }

  function buildCsvLabels(): ReportCsvLabels {
    return {
      reportTitle: t('title'),
      salon: tenant?.tenant.name ?? SALON.name,
      currencyLabel: t('cols.amount'),
      currencyCode,
      periodLabel: t('pdf.period'),
      periodValue: `${t(`period.${period}`)} — ${rangeLabel}`,
      synthesis: t('kpi.revenueNet'),
      revenueNet: t('accounting.net'),
      sales: t('kpi.sales'),
      avgTicket: t('kpi.avgTicket'),
      gross: t('accounting.gross'),
      discount: t('accounting.discount'),
      surplus: t('accounting.surplus'),
      cashback: t('accounting.cashback'),
      refunded: t('accounting.refunded'),
      tips: t('accounting.tips'),
      tax: t('accounting.tax'),
      paymentsTitle: t('payments.title'),
      amount: t('cols.amount'),
      visa: t('payments.visa'),
      cash: t('payments.cash'),
      instapay: t('payments.instapay'),
      other: t('payments.other'),
      byServiceTitle: t('byService.title'),
      byProductTitle: t('byProduct.title'),
      colName: t('cols.name'),
      colQty: t('cols.qty'),
      colRevenue: t('cols.revenue'),
      bookingsTitle: t('bookings.title'),
      done: t('bookings.done'),
      noShow: t('bookings.noShow'),
      cancelled: t('bookings.cancelled'),
      upcoming: t('bookings.upcoming'),
      total: t('bookings.total'),
    };
  }

  function exportCsv() {
    if (!report) return;
    const csv = buildReportCsv(report, buildCsvLabels());
    downloadCsv(`rapport-${period}-${report.refDate}.csv`, csv);
  }

  function exportPdf() {
    if (!report) return;
    downloadReportPdf(
      report,
      {
        name: tenant?.tenant.name ?? SALON.name,
        logoDataUrl: tenant?.branding.logo_url ?? SALON.logoUrl,
        branch: tenant?.settings.branch ?? null,
        addressCity: tenant?.settings.address_city ?? null,
      },
      buildPdfLabels(report),
      `rapport-${period}-${report.refDate}.pdf`,
    );
  }

  const methodTotal = report
    ? report.byMethod.visa + report.byMethod.cash + report.byMethod.instapay + report.byMethod.other
    : 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      {/* En-tête : titre + sélecteur de période + exports */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-ink">
            <FileText className="h-5 w-5 text-brand-primary" strokeWidth={2} />
            {t('title')}
          </h2>
          <p className="mt-1 text-sm text-ink-mute">{t('subtitle')}</p>
          {report && (
            <p className="mt-1 text-xs text-ink-mute">{rangeLabel}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn
            variant="secondary"
            size="sm"
            icon={Download}
            onClick={exportCsv}
            disabled={!report || isPending}
          >
            {t('exportCsv')}
          </Btn>
          <Btn
            variant="secondary"
            size="sm"
            icon={FileText}
            onClick={exportPdf}
            disabled={!report || isPending}
          >
            {t('exportPdf')}
          </Btn>
        </div>
      </div>

      {/* Sélecteur de période — contrôle segmenté */}
      <div className="mb-6 inline-flex rounded-sm border border-line-hi bg-surface p-1">
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            aria-pressed={period === p}
            className={`rounded-[4px] px-4 py-2 text-sm font-semibold transition-colors ${
              period === p
                ? 'bg-brand-primary text-[#1A140C]'
                : 'text-ink-mute hover:text-ink'
            }`}
          >
            {t(`period.${p}`)}
          </button>
        ))}
        {isPending && (
          <span className="flex items-center px-3 text-xs text-ink-mute">{t('refreshing')}</span>
        )}
      </div>

      {!isRealTenant ? (
        <Card className="p-8 text-center text-sm text-ink-mute">{t('error')}</Card>
      ) : errorKey ? (
        <Card className="p-8 text-center text-sm text-red">{t('error')}</Card>
      ) : !report ? (
        <ReportSkeleton />
      ) : (
        <div className="space-y-6">
          {/* KPI de synthèse */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              icon={TrendingUp}
              label={t('kpi.revenueNet')}
              value={fmt(report.revenueNetCents)}
              accent
            />
            <KpiCard icon={Receipt} label={t('kpi.sales')} value={String(report.salesCount)} />
            <KpiCard icon={Wallet} label={t('kpi.avgTicket')} value={fmt(report.avgTicketCents)} />
            <KpiCard
              icon={CalendarCheck}
              label={t('kpi.bookingsDone')}
              value={String(report.bookings.done)}
            />
          </div>

          {report.salesCount === 0 && report.bookings.total === 0 ? (
            <Card className="p-8 text-center text-sm text-ink-mute">{t('empty')}</Card>
          ) : (
            <>
              {/* Moyens de paiement */}
              <Card className="p-5">
                <SectionHeader icon={CreditCard} title={t('payments.title')} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <MethodCard
                    icon={CreditCard}
                    label={t('payments.visa')}
                    value={fmt(report.byMethod.visa)}
                    pct={methodTotal ? Math.round((report.byMethod.visa / methodTotal) * 100) : 0}
                  />
                  <MethodCard
                    icon={Banknote}
                    label={t('payments.cash')}
                    value={fmt(report.byMethod.cash)}
                    pct={methodTotal ? Math.round((report.byMethod.cash / methodTotal) * 100) : 0}
                  />
                  <MethodCard
                    icon={Smartphone}
                    label={t('payments.instapay')}
                    value={fmt(report.byMethod.instapay)}
                    pct={
                      methodTotal ? Math.round((report.byMethod.instapay / methodTotal) * 100) : 0
                    }
                  />
                </div>
                {report.byMethod.other > 0 && (
                  <div className="mt-3 flex justify-between border-t border-line pt-3 text-sm">
                    <span className="text-ink-mute">{t('payments.other')}</span>
                    <span className="font-semibold text-ink">{fmt(report.byMethod.other)}</span>
                  </div>
                )}
              </Card>

              {/* Détail comptable (brut → net) */}
              <Card className="p-5">
                <SectionHeader icon={FileText} title={t('accounting.title')} />
                <dl className="space-y-1 text-sm">
                  <AcctRow label={t('accounting.gross')} value={fmt(report.grossCents)} />
                  {report.surplusCents > 0 && (
                    <AcctRow
                      label={t('accounting.surplus')}
                      value={`+ ${fmt(report.surplusCents)}`}
                    />
                  )}
                  {report.discountCents > 0 && (
                    <AcctRow
                      label={t('accounting.discount')}
                      value={`− ${fmt(report.discountCents)}`}
                      muted
                    />
                  )}
                  {report.cashbackCents > 0 && (
                    <AcctRow
                      label={t('accounting.cashback')}
                      value={`− ${fmt(report.cashbackCents)}`}
                      muted
                    />
                  )}
                  {report.refundedCents > 0 && (
                    <AcctRow
                      label={t('accounting.refunded')}
                      value={`− ${fmt(report.refundedCents)}`}
                      muted
                    />
                  )}
                  <AcctRow label={t('accounting.net')} value={fmt(report.revenueNetCents)} strong />
                  <div className="pt-2">
                    <AcctRow
                      label={t('accounting.tips')}
                      value={fmt(report.tipsCents)}
                      muted
                      hint={t('accounting.tipsNote')}
                    />
                    {report.taxCents > 0 && (
                      <AcctRow label={t('accounting.tax')} value={fmt(report.taxCents)} muted />
                    )}
                  </div>
                </dl>
              </Card>

              {/* Ventes par prestation */}
              {report.byService.length > 0 && (
                <Card className="p-5">
                  <SectionHeader icon={Scissors} title={t('byService.title')} />
                  <SalesTable
                    lines={report.byService}
                    fmt={fmt}
                    cols={{ name: t('cols.name'), qty: t('cols.qty'), revenue: t('cols.revenue') }}
                    topBadge={t('byService.topBadge')}
                  />
                </Card>
              )}

              {/* Ventes par produit */}
              {report.byProduct.length > 0 && (
                <Card className="p-5">
                  <SectionHeader icon={Receipt} title={t('byProduct.title')} />
                  <SalesTable
                    lines={report.byProduct}
                    fmt={fmt}
                    cols={{ name: t('cols.name'), qty: t('cols.qty'), revenue: t('cols.revenue') }}
                    topBadge={t('byService.topBadge')}
                  />
                </Card>
              )}

              {/* Rendez-vous */}
              <Card className="p-5">
                <SectionHeader icon={Users} title={t('bookings.title')} />
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <StatPill label={t('bookings.done')} value={report.bookings.done} />
                  <StatPill label={t('bookings.noShow')} value={report.bookings.noShow} danger />
                  <StatPill label={t('bookings.cancelled')} value={report.bookings.cancelled} />
                  <StatPill label={t('bookings.upcoming')} value={report.bookings.upcoming} />
                  <StatPill label={t('bookings.total')} value={report.bookings.total} strong />
                </div>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Sous-composants présentationnels
// =============================================================================

function SectionHeader({
  icon: Icon,
  title,
}: {
  icon: typeof FileText;
  title: string;
}) {
  return (
    <h3 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ink-mute">
      <Icon className="h-4 w-4 text-brand-primary" strokeWidth={2} />
      {title}
    </h3>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof FileText;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-sm border p-4 ${
        accent ? 'border-brand-primary/40 bg-brand-primary/5' : 'border-line-hi bg-surface-elev'
      }`}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-mute">
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
        <span className="truncate">{label}</span>
      </div>
      <p className={`mt-1.5 text-lg font-bold ${accent ? 'text-brand-primary' : 'text-ink'}`}>
        {value}
      </p>
    </div>
  );
}

function MethodCard({
  icon: Icon,
  label,
  value,
  pct,
}: {
  icon: typeof FileText;
  label: string;
  value: string;
  pct: number;
}) {
  return (
    <div className="rounded-sm border border-line-hi bg-surface-elev p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium text-ink-mute">
          <Icon className="h-4 w-4" strokeWidth={2} />
          {label}
        </span>
        <span className="text-xs text-ink-mute">{pct} %</span>
      </div>
      <p className="mt-1.5 text-base font-bold text-ink">{value}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
        <div className="h-full rounded-full bg-brand-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function AcctRow({
  label,
  value,
  strong,
  muted,
  hint,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
  hint?: string;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 py-1 ${
        strong ? 'mt-1 border-t border-line-hi pt-2' : ''
      }`}
    >
      <dt className={strong ? 'font-bold text-ink' : muted ? 'text-ink-mute' : 'text-ink'}>
        {label}
        {hint && <span className="ml-1 text-xs text-ink-mute">· {hint}</span>}
      </dt>
      <dd
        className={`tabular-nums ${
          strong ? 'text-base font-bold text-ink' : muted ? 'text-ink-mute' : 'font-semibold text-ink'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function SalesTable({
  lines,
  fmt,
  cols,
  topBadge,
}: {
  lines: AccountingReport['byService'];
  fmt: (cents: number) => string;
  cols: { name: string; qty: string; revenue: string };
  topBadge: string;
}) {
  const maxRev = lines.length > 0 ? Math.max(...lines.map((l) => l.revenueCents), 1) : 1;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 border-b border-line pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-mute">
        <span>{cols.name}</span>
        <span className="flex shrink-0 items-center gap-3">
          <span>{cols.qty}</span>
          <span className="w-24 text-right">{cols.revenue}</span>
        </span>
      </div>
      {lines.map((line, i) => (
        <div key={`${line.name}-${i}`} className="relative">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium text-ink">{line.name}</span>
              {i === 0 && (
                <span className="shrink-0 rounded-full bg-brand-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-primary">
                  {topBadge}
                </span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-3 tabular-nums">
              <span className="text-ink-mute">×{line.count}</span>
              <span className="w-24 text-right font-semibold text-ink">{fmt(line.revenueCents)}</span>
            </span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface">
            <div
              className="h-full rounded-full bg-brand-primary/60"
              style={{ width: `${Math.round((line.revenueCents / maxRev) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function StatPill({
  label,
  value,
  strong,
  danger,
}: {
  label: string;
  value: number;
  strong?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      className={`rounded-sm border p-3 text-center ${
        strong ? 'border-brand-primary/40 bg-brand-primary/5' : 'border-line-hi bg-surface-elev'
      }`}
    >
      <p
        className={`text-xl font-bold tabular-nums ${
          danger && value > 0 ? 'text-red' : strong ? 'text-brand-primary' : 'text-ink'
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] font-medium text-ink-mute">{label}</p>
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-sm bg-surface-elev" />
        ))}
      </div>
      <div className="h-32 animate-pulse rounded-sm bg-surface-elev" />
      <div className="h-40 animate-pulse rounded-sm bg-surface-elev" />
    </div>
  );
}
