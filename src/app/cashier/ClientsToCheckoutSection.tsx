'use client';

/**
 * ClientsToCheckoutSection — listing compact des clients en attente de paiement.
 *
 * Rendu dans l'onglet « Caisse » (POS) juste sous le sélecteur client. Affiche
 * les bookings du jour qui sont en cours (`in-chair`) ou terminés mais pas
 * encore réglés (`done` + `!paid`). Chaque ligne est ENTIÈREMENT cliquable et
 * charge le RDV dans le ticket à droite — pas de boutons séparés « Ajouter »
 * ou « Encaisser » : pour ajouter on clique sur les prestations en bas, pour
 * encaisser on utilise le bouton du ticket. Cf. retour utilisateur :
 *   « ces 2 boutton ne servent a rien car si je veux rajouter quelque chose
 *     je clique sur les prestations en bas »
 */

import { Ticket } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { Tag } from '@/components';
import { useFmtMoney } from '../_data/local-state';
import { bookingTotal, todayStr, type Barber, type Booking, type Service } from '../_data/mock';

interface Props {
  bookings: Booking[];
  services: Service[];
  barbers: Barber[];
  /** Click n'importe où sur la ligne → charge le RDV dans le ticket à droite
   *  (state lifté dans CashierApp). Tout le ticket bascule sur ce RDV : items
   *  pré-remplis, client/coiffeur lockés, Encaisser → payBooking. */
  onLoadIntoTicket: (booking: Booking) => void;
  /** ID du booking actuellement chargé dans le ticket (affiché en surbrillance
   *  copper pour que la caissière sache quel RDV est en cours d'encaissement). */
  loadedBookingId?: string | null;
  /** ID du booking qui vient d'arriver (après « Démarrer ») — flashé +
   *  scrollé en vue automatiquement. `null` = aucun flash en cours. */
  highlightBookingId?: string | null;
}

export function ClientsToCheckoutSection({
  bookings,
  services,
  barbers,
  onLoadIntoTicket,
  loadedBookingId,
  highlightBookingId,
}: Props) {
  const t = useTranslations('cashier.clientsToCheckout');
  const fmt = useFmtMoney();
  const highlightedRowRef = useRef<HTMLLIElement>(null);

  // Quand un nouveau booking arrive (clic « Démarrer »), on scroll sa ligne
  // dans la vue. La caissière vient de basculer d'onglet : sans ce scroll,
  // sur une page longue, elle pourrait ne pas voir où la ligne a atterri.
  useEffect(() => {
    if (highlightBookingId && highlightedRowRef.current) {
      highlightedRowRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [highlightBookingId]);

  // Filtre : aujourd'hui · en cours OU terminé non payé · non annulé.
  // Trié par ancienneté de démarrage (heure de début), les plus anciens
  // d'abord pour signaler ceux qui attendent le plus.
  const todayList = bookings
    .filter((b) => b.date === todayStr())
    .filter((b) => !b.paid && (b.status === 'in-chair' || b.status === 'done'))
    .sort((a, b) => a.time.localeCompare(b.time));

  return (
    <section className="bg-surface border-line mt-5 rounded-sm border">
      {/* Header */}
      <div className="border-line border-b px-4 py-3">
        <h3 className="display text-lg leading-tight">{t('header')}</h3>
        <p className="text-ink-soft mt-0.5 text-[11px]">{t('subheader')}</p>
      </div>

      {/* Body — liste ou empty state */}
      {todayList.length === 0 ? (
        <div className="text-ink-soft px-4 py-6 text-center text-xs">{t('empty')}</div>
      ) : (
        <ul className="divide-line divide-y">
          {todayList.map((b) => {
            const svc = services.find((s) => s.id === b.serviceId);
            const barber = barbers.find((x) => x.id === b.barberId);
            const isWalkin = b.source === 'walk_in';
            const isHighlighted = b.id === highlightBookingId;
            const isLoaded = b.id === loadedBookingId;
            return (
              <li
                key={b.id}
                ref={isHighlighted ? highlightedRowRef : undefined}
                className={`group transition-colors duration-1000 ${
                  isLoaded
                    ? 'bg-brand-primary/10'
                    : isHighlighted
                      ? 'bg-brand-primary/15'
                      : 'bg-transparent'
                }`}
              >
                {/* Toute la ligne est un bouton — on clique n'importe où pour
                    charger ce RDV dans le ticket à droite. Pas de boutons
                    annexes (Ajouter/Encaisser) — ils sont redondants avec le
                    flow du ticket. */}
                <button
                  type="button"
                  onClick={() => onLoadIntoTicket(b)}
                  className="btn-press hover:bg-bg-soft flex w-full items-center gap-3 px-4 py-3 text-start transition-colors"
                  aria-label={t('loadAria', { name: b.clientName })}
                >
                  {/* Heure */}
                  <div className="mono bg-surface-elev border-line min-w-[54px] rounded-sm border px-2 py-1.5 text-center">
                    <div className="text-brand-primary text-sm font-semibold leading-none">
                      {b.time}
                    </div>
                  </div>

                  {/* Identité + tags */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-ink truncate text-sm font-semibold">
                        {b.clientName}
                      </span>
                      {isWalkin && <Tag tone="copper">{t('walkinTag')}</Tag>}
                      {/* Cohérence visuelle avec Rendez-vous (Today) qui
                          utilise « copper À encaisser » pour status=done
                          non payé. Le green « Prêt » prêtait à confusion
                          (semblait « OK clos »). Audit T2.12. */}
                      {b.status === 'in-chair' ? (
                        <Tag tone="copper">{t('inChairTag')}</Tag>
                      ) : (
                        <Tag tone="copper">{t('doneTag')}</Tag>
                      )}
                      {isLoaded && <Tag tone="copper">{t('loadedTag')}</Tag>}
                    </div>
                    <div className="text-ink-mute mt-0.5 truncate text-[11px]">
                      {svc?.name ?? '—'}
                      {barber && (
                        <>
                          {' · '}
                          {t('withBarber', { barber: barber.name })}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Montant */}
                  <div className="mono text-ink hidden text-sm font-semibold sm:block">
                    {fmt(bookingTotal(b))}
                  </div>

                  {/* Indicateur clickable — icône Ticket (au lieu d'un
                      ChevronRight qui suggérait « voir détails »). Le clic
                      CHARGE le RDV dans le ticket à droite, pas vers une
                      sous-page. Audit T5.20. */}
                  <Ticket
                    className="text-ink-soft group-hover:text-brand-primary h-4 w-4 shrink-0 transition-colors"
                    strokeWidth={1.8}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
