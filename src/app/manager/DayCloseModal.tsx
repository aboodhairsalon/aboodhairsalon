'use client';

/**
 * Modale de clôture du jour — récapitulatif de fin de journée.
 *
 * Bilan en lecture seule : chiffre, ventes, RDV honorés, ticket moyen,
 * répartition par moyen de paiement et par barbier, détail des ventes — avec
 * export CSV. Aucune écriture en base : c'est un rapport, pas un verrou.
 */
import { Banknote, CreditCard, Download, Smartphone } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Btn, Modal } from '@/components';
import type { Barber, Booking, Sale } from '../_data/mock';
import { buildSalesCsv, downloadCsv } from './csv-export';

const METHOD_DEFS: { key: Sale['method']; icon: LucideIcon; labelKey: string }[] = [
  { key: 'cash', icon: Banknote, labelKey: 'methodCash' },
  { key: 'card', icon: CreditCard, labelKey: 'methodCard' },
  { key: 'mobile', icon: Smartphone, labelKey: 'methodMobile' },
];

export function DayCloseModal({
  open,
  onClose,
  sales,
  bookings,
  barbers,
  fmt,
  dateIso,
}: {
  open: boolean;
  onClose: () => void;
  sales: Sale[];
  bookings: Booking[];
  barbers: Barber[];
  fmt: (cents: number) => string;
  dateIso: string;
}) {
  const t = useTranslations('manager.dayClose');
  const locale = useLocale();
  if (!open) return null;

  // On scinde :
  //  - `daySalesAll`     : TOUTES les ventes du jour, refunded incluses.
  //  - `daySales`        : exclut les ventes intégralement remboursées (les
  //                        partielles restent dedans car la prestation a bien
  //                        eu lieu et compte comme une vente).
  //  - `refundsToday`    : toutes les ventes qui ont au moins un centime de
  //                        refund (partiel OU complet) — utilisé pour le
  //                        bloc « remboursements du jour » d'audit.
  //
  // Pour le CA, on additionne le NET (total − refunded) au lieu de filtrer
  // binairement : ainsi un refund partiel diminue le CA du montant rendu,
  // pas du total facturé.
  const netOf = (s: Sale) => Math.max(0, s.totalCents - (s.refundedCents ?? 0));
  const daySalesAll = sales.filter((s) => s.date === dateIso);
  const daySales = daySalesAll.filter((s) => !s.refunded);
  const refundsToday = daySalesAll.filter((s) => (s.refundedCents ?? 0) > 0);
  const dayBookings = bookings.filter((b) => b.date === dateIso);

  const ca = daySalesAll.reduce((sum, s) => sum + netOf(s), 0);
  const refundedTotal = refundsToday.reduce((sum, s) => sum + (s.refundedCents ?? 0), 0);
  const honored = dayBookings.filter((b) => b.status === 'done' || b.status === 'in-chair').length;
  const ticket = daySales.length ? Math.round(ca / daySales.length) : 0;
  const tips = daySales.reduce((sum, s) => sum + (s.tipCents ?? 0), 0);

  const barberName = (id: string) => barbers.find((b) => b.id === id)?.name ?? '—';

  // Mappage locale i18n → tag BCP47 reconnu par toLocaleDateString. On
  // garde le default fr-FR pour 'fr' (cohérent avec le branding du salon)
  // mais on passe à en-US / ar-EG selon le visiteur connecté.
  const bcp47 = locale === 'ar' ? 'ar-EG' : locale === 'en' ? 'en-US' : 'fr-FR';
  const dateLabel = (() => {
    const [y, m, d] = dateIso.split('-').map(Number);
    if (!y || !m || !d) return dateIso;
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(bcp47, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  })();

  const perBarber = barbers
    .map((b) => {
      const bs = daySalesAll.filter((s) => s.barberId === b.id);
      return {
        b,
        count: bs.filter((s) => !s.refunded).length,
        total: bs.reduce((sum, s) => sum + netOf(s), 0),
      };
    })
    .sort((x, y) => y.total - x.total);

  const exportCsv = () => {
    // CSV de clôture : on inclut TOUTES les ventes du jour (refunds inclus)
    // pour la traçabilité comptable — chaque ligne expose son Total / Remboursé
    // / Net. Headers/labels traduits via next-intl (audit T5.7).
    downloadCsv(
      `cloture-${dateIso}.csv`,
      buildSalesCsv(daySalesAll, barberName, {
        date: t('csvDate'),
        time: t('csvTime'),
        barber: t('csvBarber'),
        method: t('csvMethod'),
        items: t('csvItems'),
        total: t('csvTotal'),
        refunded: t('csvRefunded'),
        net: t('csvNet'),
        methodCard: t('methodCard'),
        methodCash: t('methodCash'),
        methodMobile: t('methodMobile'),
      }),
    );
  };

  return (
    <Modal open onClose={onClose} title={t('title')} wide>
      <div className="space-y-6">
        <p className="text-ink-mute -mt-2 text-sm capitalize">{dateLabel}</p>

        {/* Indicateurs du jour */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label={t('kpiRevenue')} value={fmt(ca)} accent />
          <Stat label={t('kpiSales')} value={String(daySales.length)} />
          <Stat label={t('kpiBookings')} value={String(honored)} />
          <Stat label={t('kpiAvgTicket')} value={fmt(ticket)} />
          <Stat label={t('kpiTips')} value={fmt(tips)} />
        </div>

        {/* Ventes remboursées du jour — discret, mais visible pour audit.
            Le total et le compte ne pèsent PAS dans le CA ci-dessus. */}
        {refundsToday.length > 0 && (
          <div className="border-red/30 bg-red/8 text-red flex flex-wrap items-center gap-2 rounded-sm border px-3 py-2 text-xs">
            <span>
              {refundsToday.length > 1
                ? t('refundedCountMany', { count: refundsToday.length })
                : t('refundedCountOne', { count: refundsToday.length })}
              {' · '}
              {t('refundedTotal', { amount: fmt(refundedTotal) })}
            </span>
          </div>
        )}

        {/* Encaissements par moyen de paiement */}
        <div>
          <SectionTitle>{t('methodsHeader')}</SectionTitle>
          <div className="grid gap-2 sm:grid-cols-3">
            {METHOD_DEFS.map(({ key, icon: Icon, labelKey }) => {
              const ms = daySalesAll.filter((s) => s.method === key);
              const total = ms.reduce((sum, s) => sum + netOf(s), 0);
              return (
                <div key={key} className="border-line bg-bg-soft rounded-sm border p-3">
                  <div className="text-ink-soft flex items-center gap-1.5 text-xs">
                    <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                    {t(labelKey)}
                  </div>
                  <div className="display mt-1.5 text-xl">{fmt(total)}</div>
                  <div className="text-ink-soft mono text-[10px]">
                    {ms.length > 1
                      ? t('saleCountMany', { count: ms.length })
                      : t('saleCountOne', { count: ms.length })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Détail par barbier */}
        <div>
          <SectionTitle>{t('perBarberHeader')}</SectionTitle>
          {perBarber.length === 0 ? (
            <p className="text-ink-soft text-xs">{t('noActiveBarber')}</p>
          ) : (
            <div className="grid gap-1.5">
              {perBarber.map(({ b, count, total }) => (
                <div
                  key={b.id}
                  className="border-line flex items-center justify-between gap-3 border-b py-2 text-sm last:border-0"
                >
                  <span className="font-semibold" style={{ color: b.tone }}>
                    {b.name}
                  </span>
                  <span className="text-ink-soft mono ms-auto text-xs">
                    {count > 1 ? t('saleCountMany', { count }) : t('saleCountOne', { count })}
                  </span>
                  <span className="mono text-brand-primary w-20 text-end">{fmt(total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Détail des ventes */}
        {daySales.length > 0 ? (
          <div>
            <SectionTitle>{t('salesDetailHeader', { count: daySales.length })}</SectionTitle>
            <div className="scrollbar max-h-52 overflow-y-auto">
              {daySales.map((s) => (
                <div
                  key={s.id}
                  className="border-line flex items-center gap-3 border-b py-1.5 text-xs last:border-0"
                >
                  <span className="mono text-ink-soft w-12">{s.time}</span>
                  <span className="text-ink-mute flex-1 truncate">{barberName(s.barberId)}</span>
                  <span className="mono text-ink-soft w-16 text-end uppercase">{s.method}</span>
                  <span className="mono text-ink w-20 text-end">{fmt(s.totalCents)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-ink-soft py-2 text-center text-sm">{t('emptyLabel')}</p>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <Btn variant="secondary" full onClick={onClose}>
            {t('closeBtn')}
          </Btn>
          <Btn full icon={Download} onClick={exportCsv} disabled={daySales.length === 0}>
            {t('exportBtn')}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

// ─── Sous-composants ─────────────────────────────────────────────────────────

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="border-line bg-bg-soft rounded-sm border p-3">
      <div className="mono text-ink-soft text-[9px] uppercase tracking-[0.2em]">{label}</div>
      <div className={`display mt-1 text-2xl ${accent ? 'text-brand-primary' : 'text-ink'}`}>
        {value}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="mono text-ink-soft mb-2 text-[10px] uppercase tracking-[0.2em]">{children}</div>
  );
}
