'use client';

import {
  Banknote,
  Calendar,
  Check,
  Coffee,
  CreditCard,
  Minus,
  Package,
  Plus,
  Receipt,
  Smartphone,
  Trash2,
  User,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Btn, Card, Divider, Modal, Tag } from '@/components';
import { AppHeader, type TabDef } from '../_components/AppHeader';
import { ServiceIcon } from '../_components/ServiceIcon';
import { useToast } from '../_components/Toast';
import { sendReceiptEmail } from '../manager/email-actions';
import { useFmtMoney } from '../_data/local-state';
import {
  barbersOf,
  todayStr,
  type Barber,
  type Booking,
  type BookingExtra,
  type Product,
  type Sale,
  type SaleItem,
  type SaleMethod,
  type Service,
  type Staff,
} from '../_data/mock';
import {
  updateBookingStatus,
  payBooking,
  createDirectSale,
  setBookingExtras,
} from '../manager/booking-actions';
import { ClientSelector, type SelectedClient } from './ClientSelector';
import { ApplyCashbackButton, CashbackHint } from './ApplyCashbackButton';
import { ClientsToCheckoutSection } from './ClientsToCheckoutSection';
import { ReceiptQRModal, type ReceiptQRClient } from './ReceiptQRModal';
import { RefundModal } from './RefundModal';

/** Définition des onglets : `key` + `icon`. Les libellés sont résolus à
 *  chaque render via `useTranslations('cashier.tabs')` pour rester réactifs
 *  au changement de langue (cf. construction dans `CashierApp`). */
const TAB_KEYS = ['today', 'pos', 'log'] as const;
const TAB_ICONS: Record<(typeof TAB_KEYS)[number], LucideIcon> = {
  today: Calendar,
  pos: Wallet,
  log: Receipt,
};

// =============================================================================
// Props
// =============================================================================

export interface CashierAppProps {
  initialBookings: Booking[];
  initialSales: Sale[];
  services: Service[];
  initialProducts: Product[];
  staff: Staff[];
  /** Staff id du caissier connecté (claim `staff_id` du JWT) — identité de la session. */
  cashierStaffId: string;
  /** Nom du salon — affiché dans l'en-tête de l'espace Caisse. */
  tenantName: string;
  /** Slug du tenant — utilisé par l'AppHeader pour redirection logout vers
   *  `/{slug}/cashier/login`. Le layout cashier ne fournit pas de TenantProvider
   *  (pré-auth public), donc on passe le slug en prop explicite. */
  slug: string;
  /** UUID du tenant — passé au ClientSelector pour les recherches et créations
   *  de clients depuis la caisse (Server Actions admin scoped au tenant). */
  tenantId: string;
}

export function CashierApp({
  initialBookings,
  initialSales,
  services,
  initialProducts,
  staff,
  cashierStaffId,
  tenantName,
  slug,
  tenantId,
}: CashierAppProps) {
  const tTabs = useTranslations('cashier.tabs');
  const tCash = useTranslations('cashier');
  // tSale + handlePayBooking retirés depuis l'unification du flow encaissement
  // dans CashierPOS (cf. audit T2.10) — il ne reste plus que handleUpdateStatus
  // qui utilise tErrors.
  const tErrors = useTranslations('cashier.errors');
  const tabs: TabDef[] = TAB_KEYS.map((k) => ({ key: k, label: tTabs(k), icon: TAB_ICONS[k] }));
  const [tab, setTab] = useState('today');
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [bookings, setBookings] = useState<Booking[]>(initialBookings);
  const [sales, setSales] = useState<Sale[]>(initialSales);
  const [actionError, setActionError] = useState<string | null>(null);

  // ── State partagé pour l'encaissement de RDV / walk-ins ──────────────────
  //
  // Lifté ici (depuis l'ancien CashierToday) pour que les deux onglets
  // « Rendez-vous » et « Caisse » puissent ouvrir la même PaymentModal /
  // AddExtrasModal. On stocke l'ID plutôt que l'objet Booking complet : si
  // l'utilisateur ajoute des extras pendant que la modale est ouverte, on
  // dérive la version fraîche depuis l'état `bookings`.
  const [addingBookingId, setAddingBookingId] = useState<string | null>(null);

  // Démarrer un RDV (transition upcoming → in-chair) bascule la caissière
  // sur l'onglet Caisse et flashe brièvement la ligne nouvellement arrivée
  // dans « Clients à encaisser ». Le flash s'estompe via une transition CSS
  // au moment où on remet `highlightBookingId` à `null` (cf. la section).
  const [highlightBookingId, setHighlightBookingId] = useState<string | null>(null);

  // Booking « charger dans le ticket » — depuis la section Clients à encaisser
  // de l'onglet Caisse, on clique une ligne pour pré-remplir le ticket à droite
  // avec les items du RDV. Communication CashierApp → CashierPOS via prop watch.
  // Le CashierPOS consomme via useEffect puis appelle `onBookingLoaded` pour
  // remettre cette valeur à null (le prop sert juste de signal de transfert).
  const [bookingToLoadInTicket, setBookingToLoadInTicket] = useState<Booking | null>(null);

  const barbers = barbersOf(staff);
  // Identité du caissier connecté — résolue depuis le claim `staff_id` du JWT
  // (cf. requireCashier), et non plus depuis un « caissier du jour » localStorage.
  const me = staff.find((s) => s.id === cashierStaffId);
  const headerName = me?.name ?? tCash('fallbackHeaderName');

  // Helper : affiche une erreur 4 s puis disparaît.
  const showError = (msg: string) => {
    setActionError(msg);
    setTimeout(() => setActionError(null), 4000);
  };

  const updateBookingLocal = (id: string, patch: Partial<Booking>) =>
    setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  const addSaleLocal = (s: Sale) => setSales((prev) => [...prev, s]);

  const decStock = (productId: string, qty: number) =>
    setProducts((prev) =>
      prev.map((p) => (p.id === productId ? { ...p, stock: Math.max(0, p.stock - qty) } : p)),
    );

  // Wrapper : met à jour le statut en local ET en DB.
  const handleUpdateStatus = async (id: string, frontStatus: Booking['status']) => {
    // Mapping front ('in-chair') → DB ('in_chair')
    const dbStatus =
      frontStatus === 'in-chair' ? ('in_chair' as const) : (frontStatus as 'done' | 'cancelled');

    // Mise à jour optimiste
    updateBookingLocal(id, { status: frontStatus });

    // UX : « Démarrer » bascule la caissière sur l'onglet Caisse — la ligne
    // arrive dans « Clients à encaisser » juste sous la recherche client.
    // Le flash visuel signale la nouvelle arrivée pour qu'elle ne passe pas
    // inaperçue (résorbé après 2,5 s via la transition CSS).
    if (frontStatus === 'in-chair') {
      setTab('pos');
      setHighlightBookingId(id);
      setTimeout(() => setHighlightBookingId((cur) => (cur === id ? null : cur)), 2500);
    }

    const result = await updateBookingStatus(id, dbStatus);
    if (!result.ok) {
      // Rollback
      showError(tErrors(result.errorKey as 'unknownError', result.errorValues));
    }
  };

  // Marquer un RDV `upcoming` dont l'heure est passée comme `no_show`.
  // Sépare du flow handleUpdateStatus parce que (1) on n'expose pas
  // 'no-show' dans le type BookingStatus front (les bookings no_show
  // disparaissent de la vue caisse, ils ne sont pas un état UI persistant)
  // et (2) on retire optimistiquement la ligne du state local. Audit T5.29.
  const handleMarkNoShow = async (id: string) => {
    const snapshot = bookings.find((b) => b.id === id);
    if (!snapshot) return;
    // Optimistic remove
    setBookings((prev) => prev.filter((b) => b.id !== id));
    const result = await updateBookingStatus(id, 'no_show');
    if (!result.ok) {
      // Rollback : remettre le RDV
      setBookings((prev) => [...prev, snapshot]);
      showError(tErrors(result.errorKey as 'unknownError', result.errorValues));
    }
  };

  // Récupère le booking courant pour AddExtrasModal (toujours la version
  // fraîche de l'état). `payingBookingId` + `handlePayBooking` ont été
  // retirés : tout l'encaissement passe maintenant par CashierPOS, qui
  // détient son propre PaymentModal + Surplus inline (audit T2.10).
  const addingBooking = addingBookingId
    ? (bookings.find((b) => b.id === addingBookingId) ?? null)
    : null;

  // Ajout d'extras à un booking — persistance en DB depuis l'audit T2.9
  // (avant : purement local, perdu au refresh ou cross-device).
  // Optimistic UI : on update le state immédiatement, puis on POST la liste
  // complète au serveur (Server Action `setBookingExtras`). Si la requête
  // échoue, on rollback. Le payBooking lui-même lit toujours `booking.extras`
  // depuis l'état local (cohérent grâce à la persistance DB côté load).
  const handleAddExtras = (extras: BookingExtra[]) => {
    if (!addingBooking) return;
    const next = [...(addingBooking.extras ?? []), ...extras];
    const prev = addingBooking.extras ?? [];
    updateBookingLocal(addingBooking.id, { extras: next });
    setAddingBookingId(null);

    void setBookingExtras(
      addingBooking.id,
      next.map((e) => ({
        key: e.key,
        kind: e.kind,
        refId: e.refId,
        name: e.name,
        priceCents: e.priceCents,
        qty: e.qty,
      })),
    ).then((res) => {
      if (!res.ok) {
        // Rollback en cas d'échec serveur.
        updateBookingLocal(addingBooking.id, { extras: prev });
        showError(tErrors(res.errorKey as 'unknownError', res.errorValues));
      }
    });
  };

  return (
    <main className="min-h-screen">
      <AppHeader
        role="cashier"
        name={headerName}
        brandName={tenantName}
        hideLogo
        tabs={tabs}
        active={tab}
        setActive={setTab}
        slug={slug}
      />

      {/* Bannière erreur action serveur */}
      {actionError && (
        <div className="bg-red/10 border-red/30 border-b px-6 py-3">
          <p className="text-red mx-auto max-w-7xl text-sm">{actionError}</p>
        </div>
      )}

      {tab === 'today' && (
        <CashierToday
          services={services}
          barbers={barbers}
          bookings={bookings}
          updateBookingStatus={handleUpdateStatus}
          onMarkNoShow={handleMarkNoShow}
          // Encaisser depuis Rendez-vous → flow unifié : on charge le RDV
          // dans le ticket POS (même flow que Caisse > Clients à encaisser)
          // pour permettre Surplus inline, suppléments dans Prestations,
          // et un seul PaymentModal. Audit T2.10.
          onCollect={(b) => {
            setBookingToLoadInTicket(b);
            setTab('pos');
          }}
          onAddExtras={(b) => setAddingBookingId(b.id)}
          // Retrait d'extra persistant (audit T2.9) — optimistic UI +
          // rollback si le serveur refuse. Sans persistance, l'extra
          // réapparaîtrait au prochain refresh / changement de device.
          onRemoveExtra={(b, extraKey) => {
            const prev = b.extras ?? [];
            const next = prev.filter((x) => x.key !== extraKey);
            updateBookingLocal(b.id, { extras: next });
            void setBookingExtras(
              b.id,
              next.map((e) => ({
                key: e.key,
                kind: e.kind,
                refId: e.refId,
                name: e.name,
                priceCents: e.priceCents,
                qty: e.qty,
              })),
            ).then((res) => {
              if (!res.ok) {
                updateBookingLocal(b.id, { extras: prev });
                showError(tErrors(res.errorKey as 'unknownError', res.errorValues));
              }
            });
          }}
        />
      )}
      {tab === 'pos' && (
        <CashierPOS
          services={services}
          products={products}
          barbers={barbers}
          bookings={bookings}
          addSaleLocal={addSaleLocal}
          setSales={setSales}
          decrementStock={decStock}
          showError={showError}
          tenantId={tenantId}
          slug={slug}
          updateBookingLocal={updateBookingLocal}
          // Charger un RDV depuis « Clients à encaisser » → POS le récupère
          // via useEffect, pré-remplit le ticket, puis appelle onBookingLoaded
          // pour remettre ce signal à null.
          bookingToLoadInTicket={bookingToLoadInTicket}
          onBookingLoaded={() => setBookingToLoadInTicket(null)}
          highlightBookingId={highlightBookingId}
        />
      )}
      {tab === 'log' && <CashierLog sales={sales} setSales={setSales} barbers={barbers} />}

      {/* AddExtrasModal partagé — déclenché depuis « Rendez-vous » (Ajouter)
          pour pré-stocker des extras avant le chargement dans le ticket. Le
          PaymentModal parent a été RETIRÉ : tout l'encaissement passe par
          CashierPOS maintenant, ce qui supprime le doublon UI (Surplus inline
          dans POS + champ Supplément dans Modal) — audit T2.10. */}
      <AddExtrasModal
        booking={addingBooking}
        services={services}
        products={products}
        onClose={() => setAddingBookingId(null)}
        onConfirm={handleAddExtras}
      />
    </main>
  );
}

// =============================================================================
// Rendez-vous (anciennement « RDV du jour »)
// =============================================================================
interface TodayProps {
  services: Service[];
  barbers: Barber[];
  bookings: Booking[];
  updateBookingStatus: (id: string, status: Booking['status']) => Promise<void>;
  /** Marquer un RDV `upcoming` (dont l'heure est passée) comme `no_show`.
   *  Le RDV disparaît de la liste (suit le filtre cashier/page.tsx qui exclut
   *  cancelled/no_show). Audit T5.29. */
  onMarkNoShow: (id: string) => Promise<void>;
  /** Retrait persistant d'un extra (DB + state) — wrappe `setBookingExtras`
   *  + optimistic UI + rollback côté CashierApp (audit T2.9). */
  onRemoveExtra: (booking: Booking, extraKey: string) => void;
  /** Ouvre PaymentModal (state lifté dans CashierApp). */
  onCollect: (booking: Booking) => void;
  /** Ouvre AddExtrasModal (state lifté). */
  onAddExtras: (booking: Booking) => void;
}

type AppointmentsPeriod = 'day' | 'week' | 'month';

/** Calcule la fenêtre [debut, fin) couverte par la période sélectionnée,
 *  en dates locales (YYYY-MM-DD). Semaine = Lundi → Dimanche. Mois = 1er → fin. */
function rangeForPeriod(period: AppointmentsPeriod): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  const fmt = (date: Date) => {
    const yy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  };

  if (period === 'day') {
    const today = new Date(y, m, d);
    const tomorrow = new Date(y, m, d + 1);
    return { start: fmt(today), end: fmt(tomorrow) };
  }
  if (period === 'week') {
    // Lundi de la semaine en cours (getDay : Dim=0, Lun=1, …, Sam=6).
    const dow = now.getDay();
    const offsetToMonday = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(y, m, d + offsetToMonday);
    const nextMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
    return { start: fmt(monday), end: fmt(nextMonday) };
  }
  // 'month'
  const firstDay = new Date(y, m, 1);
  const firstNext = new Date(y, m + 1, 1);
  return { start: fmt(firstDay), end: fmt(firstNext) };
}

function CashierToday({
  services,
  barbers,
  bookings,
  updateBookingStatus,
  onMarkNoShow,
  onRemoveExtra,
  onCollect,
  onAddExtras,
}: TodayProps) {
  const tStatus = useTranslations('cashier.status');
  const tToday = useTranslations('cashier.today');
  const fmt = useFmtMoney();
  const [period, setPeriod] = useState<AppointmentsPeriod>('day');
  const range = rangeForPeriod(period);
  const filteredBookings = bookings
    .filter((b) => b.status !== 'cancelled')
    .filter((b) => b.date >= range.start && b.date < range.end)
    .sort((a, b) =>
      a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date),
    );

  const totalOf = (b: Booking) =>
    b.amountCents + (b.extras ?? []).reduce((s, e) => s + e.priceCents * e.qty, 0);

  const renderStatus = (b: Booking) => {
    if (b.paid) return <Tag tone="green">{tStatus('paid')}</Tag>;
    if (b.status === 'in-chair') return <Tag tone="copper">{tStatus('inChair')}</Tag>;
    if (b.status === 'done') return <Tag tone="copper">{tStatus('toCollect')}</Tag>;
    return <Tag>{tStatus('upcoming')}</Tag>;
  };

  // Titre + sous-titre adaptés à la période.
  const periodTitle =
    period === 'day'
      ? tToday('title')
      : period === 'week'
        ? tToday('titleWeek')
        : tToday('titleMonth');
  const emptyMsg =
    period === 'day'
      ? tToday('emptySubtitle')
      : period === 'week'
        ? tToday('emptyWeek')
        : tToday('emptyMonth');

  return (
    <div className="mx-auto max-w-7xl px-6 py-10 md:px-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Tag tone="copper">
            {tToday('todayPrefix')} ·{' '}
            {new Date().toLocaleDateString('fr-FR', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </Tag>
          <h2 className="display mt-3 text-4xl">{periodTitle}</h2>
        </div>
        <div className="flex gap-3">
          <Stat label={tToday('statBookings')} value={filteredBookings.length.toString()} />
          <Stat
            label={tToday('statToCollect')}
            value={filteredBookings
              .filter((b) => !b.paid && b.status !== 'upcoming')
              .length.toString()}
            accent
          />
          <Stat
            label={tToday('statPaid')}
            value={filteredBookings.filter((b) => b.paid).length.toString()}
          />
        </div>
      </div>

      {/* Sélecteur de période — Jour / Semaine / Mois. Filtre côté client sur
          la fenêtre déjà chargée (-7j / +45j) par le Server Component. */}
      <div className="border-line bg-bg-soft mb-6 inline-flex rounded-sm border p-1">
        {(['day', 'week', 'month'] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={`mono px-4 py-1.5 text-[11px] uppercase tracking-wider transition-colors ${
              period === p ? 'bg-brand-primary text-white' : 'text-ink-mute hover:text-ink'
            }`}
          >
            {p === 'day'
              ? tToday('periodDay')
              : p === 'week'
                ? tToday('periodWeek')
                : tToday('periodMonth')}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filteredBookings.map((b, i) => {
          const s = services.find((x) => x.id === b.serviceId);
          const barber = barbers.find((x) => x.id === b.barberId);
          const hasExtras = (b.extras ?? []).length > 0;
          const canAddExtras = !b.paid && (b.status === 'in-chair' || b.status === 'done');
          const isWalkin = b.source === 'walk_in';
          // « Marquer absent » apparaît uniquement quand le RDV est encore
          // `upcoming` ET que son heure de début est dépassée depuis ≥ 15 min
          // (laisse une marge au client en retard). Sans ce seuil, le bouton
          // s'afficherait dès la minute du RDV → risque de marquer no_show
          // un client qui arrive 2 min en retard. Audit T5.29.
          const bookingStart = new Date(`${b.date}T${b.time}:00`);
          const minutesPast = (Date.now() - bookingStart.getTime()) / 60_000;
          const canMarkNoShow = b.status === 'upcoming' && minutesPast >= 15;
          // En vue Semaine/Mois on annote la date (sinon redondant avec « Aujourd'hui »).
          const showDate = period !== 'day';
          return (
            <Card key={b.id} className={`fade-up overflow-hidden p-0 delay-${(i % 6) + 1}`}>
              <div className="flex items-center gap-4 p-4">
                <div className="mono bg-surface-elev border-line min-w-[60px] rounded-sm border px-3 py-2 text-center">
                  <div className="display text-brand-primary text-2xl leading-none">{b.time}</div>
                  {showDate && (
                    <div className="text-ink-soft mt-1 text-[9px] uppercase tracking-wider">
                      {new Date(b.date).toLocaleDateString('fr-FR', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="display text-lg">{b.clientName}</span>
                    {renderStatus(b)}
                    {isWalkin && <Tag tone="copper">{tToday('walkinTag')}</Tag>}
                    {hasExtras && (
                      <Tag tone="copper">
                        {tToday('extrasCount', { count: (b.extras ?? []).length })}
                      </Tag>
                    )}
                  </div>
                  <div className="text-ink-mute mt-1 text-xs">
                    {s?.name} · {s?.duration} min · avec{' '}
                    <span style={{ color: barber?.tone }}>{barber?.name}</span>
                  </div>
                </div>
                <div className="hidden text-end sm:block">
                  <div className="mono text-ink text-lg font-semibold">{fmt(totalOf(b))}</div>
                  {hasExtras && (
                    <div className="mono text-ink-soft mt-0.5 text-[10px] uppercase tracking-wider">
                      {tToday('baseLabel', { amount: fmt(b.amountCents) })}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {b.status === 'upcoming' && (
                    <Btn
                      size="sm"
                      variant="secondary"
                      onClick={() => void updateBookingStatus(b.id, 'in-chair')}
                    >
                      {tToday('actionStart')}
                    </Btn>
                  )}
                  {/* Annuler — disponible tant que le RDV n'est pas démarré
                      ni payé. Confirme via prompt natif pour eviter les
                      clics accidentels (action libere le slot, irreversible
                      cote client qui peut en re-prendre un autre). T5.9. */}
                  {b.status === 'upcoming' && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(tToday('confirmCancel', { name: b.clientName }))) {
                          void updateBookingStatus(b.id, 'cancelled');
                        }
                      }}
                      className="btn-press border-line text-ink-soft hover:border-red hover:text-red mono rounded-sm border px-3 py-1.5 text-[10px] uppercase tracking-wider transition-colors"
                    >
                      {tToday('actionCancel')}
                    </button>
                  )}
                  {canMarkNoShow && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(tToday('confirmNoShow', { name: b.clientName }))) {
                          void onMarkNoShow(b.id);
                        }
                      }}
                      className="btn-press border-line text-ink-soft hover:border-red hover:text-red mono rounded-sm border px-3 py-1.5 text-[10px] uppercase tracking-wider transition-colors"
                    >
                      {tToday('actionMissed')}
                    </button>
                  )}
                  {canAddExtras && (
                    <Btn
                      size="sm"
                      variant="secondary"
                      icon={Plus as LucideIcon}
                      onClick={() => onAddExtras(b)}
                    >
                      {tToday('actionAdd')}
                    </Btn>
                  )}
                  {b.status === 'in-chair' && (
                    <Btn
                      size="sm"
                      variant="secondary"
                      onClick={() => void updateBookingStatus(b.id, 'done')}
                    >
                      {tToday('actionEnd')}
                    </Btn>
                  )}
                  {b.status === 'done' && !b.paid && (
                    <Btn size="sm" onClick={() => onCollect(b)} icon={CreditCard as LucideIcon}>
                      {tToday('actionCollect')}
                    </Btn>
                  )}
                </div>
              </div>

              {/* Liste des extras en sous-ligne */}
              {hasExtras && (
                <div className="border-line bg-bg-soft/60 border-t">
                  <div className="mono text-ink-soft px-4 pt-3 text-[10px] uppercase tracking-[0.25em]">
                    {tToday('extrasHeader')}
                  </div>
                  <ul className="space-y-1 px-4 py-3">
                    {(b.extras ?? []).map((e) => (
                      <li key={e.key} className="flex items-center justify-between gap-3 text-sm">
                        <span className="flex min-w-0 items-center gap-3">
                          <span
                            className={`mono text-[10px] uppercase tracking-wider ${e.kind === 'service' ? 'text-brand-glow' : 'text-green'}`}
                          >
                            {e.kind === 'service'
                              ? tToday('extraServiceTag')
                              : tToday('extraProductTag')}
                          </span>
                          <span className="text-ink truncate">{e.name}</span>
                          {e.qty > 1 && <span className="mono text-ink-soft">× {e.qty}</span>}
                        </span>
                        <span className="flex items-center gap-3">
                          <span className="mono text-ink-mute text-sm">
                            {fmt(e.priceCents * e.qty)}
                          </span>
                          {!b.paid && (
                            <button
                              type="button"
                              onClick={() => onRemoveExtra(b, e.key)}
                              aria-label={tToday('removeItemAria')}
                              className="btn-press text-ink-soft hover:text-red"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          );
        })}
        {filteredBookings.length === 0 && (
          <Card className="p-12 text-center">
            <Coffee className="text-ink-soft mx-auto mb-4 h-10 w-10" strokeWidth={1} />
            <div className="display mb-2 text-xl">{tToday('emptyTitle')}</div>
            <div className="text-ink-mute text-sm">{emptyMsg}</div>
          </Card>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Modal "Ajouter au RDV" — mini POS pour suppléments
// =============================================================================
interface AddExtrasModalProps {
  booking: Booking | null;
  services: Service[];
  products: Product[];
  onClose: () => void;
  onConfirm: (extras: BookingExtra[]) => void;
}

function AddExtrasModal({ booking, services, products, onClose, onConfirm }: AddExtrasModalProps) {
  const t = useTranslations('cashier.addExtras');
  const fmt = useFmtMoney();
  const [draft, setDraft] = useState<BookingExtra[]>([]);

  // Reset le draft chaque fois qu'on ouvre sur un nouveau booking
  const open = !!booking;
  const lastBookingId = useRef<string | null>(null);
  if (open && booking && lastBookingId.current !== booking.id) {
    lastBookingId.current = booking.id;
    if (draft.length > 0) {
      // se passe juste après le mount, batch React le résout
      setTimeout(() => setDraft([]), 0);
    }
  }
  if (!open) lastBookingId.current = null;

  const addItem = (
    kind: 'service' | 'product',
    refId: string,
    name: string,
    priceCents: number,
  ) => {
    setDraft((prev) => {
      const existing = prev.find((x) => x.kind === kind && x.refId === refId);
      if (existing) {
        return prev.map((x) =>
          x.kind === kind && x.refId === refId ? { ...x, qty: x.qty + 1 } : x,
        );
      }
      return [
        ...prev,
        {
          key: `${kind}-${refId}-${Date.now()}`,
          kind,
          refId,
          name,
          priceCents,
          qty: 1,
        },
      ];
    });
  };

  const removeOne = (key: string) =>
    setDraft((prev) =>
      prev.flatMap((x) => (x.key === key ? (x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : []) : [x])),
    );

  const total = draft.reduce((s, e) => s + e.priceCents * e.qty, 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={booking ? t('title', { clientName: booking.clientName }) : ''}
      wide
    >
      {booking && (
        <div className="grid gap-5 md:grid-cols-[1fr_280px]">
          <div className="space-y-5">
            <div>
              <div className="mono text-ink-soft mb-2 text-[10px] uppercase tracking-[0.3em]">
                {t('servicesHeader')}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {services.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => addItem('service', s.id, s.name, s.priceCents)}
                    className="btn-press tile-hover border-line bg-surface rounded-sm border p-3 text-start"
                  >
                    <div className="text-brand-primary mb-1">
                      <ServiceIcon iconKey={s.icon} className="h-4 w-4" />
                    </div>
                    <div className="display text-sm leading-tight">{s.name}</div>
                    <div className="mono text-ink text-xs">{fmt(s.priceCents)}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mono text-ink-soft mb-2 text-[10px] uppercase tracking-[0.3em]">
                {t('productsHeader')}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {products.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={p.stock === 0}
                    onClick={() => addItem('product', p.id, p.name, p.priceCents)}
                    className={`btn-press tile-hover bg-surface rounded-sm border p-3 text-start ${
                      p.stock === 0
                        ? 'border-line cursor-not-allowed opacity-30'
                        : p.stock <= p.low
                          ? 'border-red/30'
                          : 'border-line'
                    }`}
                  >
                    <div className="mb-1 flex items-start justify-between">
                      <Package className="text-brand-primary h-4 w-4" strokeWidth={1.5} />
                      <span
                        className={`mono text-[9px] uppercase tracking-wider ${p.stock <= p.low ? 'text-red' : 'text-ink-soft'}`}
                      >
                        {t('stockBadge', { count: p.stock })}
                      </span>
                    </div>
                    <div className="display text-sm leading-tight">{p.name}</div>
                    <div className="mono text-ink text-xs">{fmt(p.priceCents)}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Récap droite */}
          <div className="bg-bg-soft border-line rounded-sm border p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="mono text-ink-soft text-[10px] uppercase tracking-[0.25em]">
                {t('draftHeader')}
              </div>
              {draft.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDraft([])}
                  className="mono text-red btn-press text-[10px] uppercase tracking-wider hover:underline"
                >
                  {t('clearBtn')}
                </button>
              )}
            </div>

            {draft.length === 0 ? (
              <div className="text-ink-soft py-8 text-center">
                <Plus className="mx-auto mb-2 h-8 w-8 opacity-50" strokeWidth={1} />
                <div className="text-ink-mute text-xs">{t('emptyDraft')}</div>
              </div>
            ) : (
              <ul className="scrollbar mb-4 max-h-[260px] space-y-2 overflow-y-auto pe-1">
                {draft.map((e) => (
                  <li
                    key={e.key}
                    className="bg-surface-elev flex items-center gap-2 rounded-sm p-2 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-ink truncate font-semibold">{e.name}</div>
                      <div className="mono text-ink-mute mt-0.5">
                        {fmt(e.priceCents)} × {e.qty}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeOne(e.key)}
                      className="btn-press border-line hover:border-brand-primary flex h-6 w-6 items-center justify-center rounded-sm border"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="border-line border-t pt-3">
              <div className="mb-3 flex items-baseline justify-between">
                <span className="mono text-ink-soft text-[10px] uppercase tracking-[0.25em]">
                  {t('subtotal')}
                </span>
                <span className="display text-brand-primary mono text-2xl">{fmt(total)}</span>
              </div>
              <Btn
                full
                disabled={draft.length === 0}
                onClick={() => onConfirm(draft)}
                icon={Check as LucideIcon}
              >
                {t('confirm')}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

interface StatProps {
  label: string;
  value: string;
  accent?: boolean;
}

function Stat({ label, value, accent }: StatProps) {
  return (
    <Card className="px-4 py-3">
      <div className="mono text-ink-soft text-[9px] uppercase tracking-[0.25em]">{label}</div>
      <div className={`display mt-1 text-3xl ${accent ? 'text-brand-primary' : 'text-ink'}`}>
        {value}
      </div>
    </Card>
  );
}

// =============================================================================
// POS rapide
// =============================================================================
interface POSProps {
  services: Service[];
  products: Product[];
  barbers: Barber[];
  /** Bookings du jour — alimente la section « Clients à encaisser ». */
  bookings: Booking[];
  addSaleLocal: (s: Sale) => void;
  /** Setter complet sur les ventes — nécessaire pour le rollback en cas
   *  d'échec serveur (`createDirectSale` refuse) et pour propager l'ID DB
   *  à la vente locale après succès (sinon le bouton Rembourser plante sur
   *  le Zod uuid()). */
  setSales: React.Dispatch<React.SetStateAction<Sale[]>>;
  decrementStock: (productId: string, qty: number) => void;
  showError: (msg: string) => void;
  tenantId: string;
  slug: string;
  /** Met à jour un booking local (utilisé pour marquer paid=true après
   *  l'encaissement quand un RDV est chargé dans le ticket). */
  updateBookingLocal: (id: string, patch: Partial<Booking>) => void;
  /** Booking signalé par CashierApp à charger dans le ticket — POS écoute via
   *  useEffect, pré-remplit cart/client/barber/loadedBooking, puis appelle
   *  `onBookingLoaded` pour remettre le signal à null. */
  bookingToLoadInTicket: Booking | null;
  onBookingLoaded: () => void;
  /** ID du booking à « flasher » brièvement dans « Clients à encaisser »
   *  juste après le clic « Démarrer » dans l'onglet Rendez-vous. `null`
   *  signifie « aucun flash en cours ». */
  highlightBookingId: string | null;
}

interface CartLine extends SaleItem {
  k: string;
  id: string;
  type: 'service' | 'product';
  qty: number;
}

function CashierPOS({
  services,
  products,
  barbers,
  bookings,
  addSaleLocal,
  setSales,
  decrementStock,
  showError,
  tenantId,
  slug,
  updateBookingLocal,
  bookingToLoadInTicket,
  onBookingLoaded,
  highlightBookingId,
}: POSProps) {
  const t = useTranslations('cashier.pos');
  const tSale = useTranslations('cashier.saleItem');
  const tErrors = useTranslations('cashier.errors');
  const fmt = useFmtMoney();
  const router = useRouter();
  const [cart, setCart] = useState<CartLine[]>([]);
  // Onglet du catalogue : « Prestations » vs « Produits ». Au lieu d'empiler
  // les deux sections (demande salon), on les sépare en deux onglets et on
  // passe à 4 cartes par ligne.
  const [catalogTab, setCatalogTab] = useState<'services' | 'products'>('services');
  const [barberId, setBarberId] = useState(barbers[0]?.id ?? '');
  // Le client est désormais un objet sélectionné (ou null) — fini la double
  // saisie nom + téléphone qui créait des doublons quand chaque caissier
  // tapait le nom différemment. Le téléphone reste la clé du profil de
  // fidélité (cohérent avec /client). Email obligatoire à la création
  // pour pouvoir contacter le client + lui envoyer le reçu.
  const [client, setClient] = useState<SelectedClient | null>(null);
  const [paying, setPaying] = useState(false);
  // RDV chargé dans le ticket — quand non null, le ticket de droite encaisse
  // ce booking : items pré-remplis, client lié, et au paiement on appelle
  // `payBooking` au lieu de `createDirectSale`. Une bannière au-dessus du
  // ticket affiche le RDV chargé + bouton pour le décrocher.
  const [loadedBooking, setLoadedBooking] = useState<Booking | null>(null);
  // Clé technique pour identifier la ligne « service de base » d'un RDV
  // chargé dans le cart — on la filtre AVANT d'envoyer les extras à
  // payBooking, sinon le service serait facturé deux fois (la base est
  // déjà dans la table bookings).
  const bookingBaseKey = (id: string) => `booking-base-${id}`;

  // Après une vente réussie, on affiche un reçu avec QR. Ces deux states
  // capturent l'instantané de la vente terminée (le `cart` a déjà été vidé
  // au moment de l'affichage).
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [lastSale, setLastSale] = useState<{
    client: ReceiptQRClient | null;
    totalCents: number;
    itemsLabel: string;
    items: { name: string; qty: number; priceCents: number }[];
    saleId: string;
    method: 'card' | 'cash' | 'mobile';
    tipCents?: number;
  } | null>(null);

  const total = cart.reduce((s, i) => s + i.priceCents * i.qty, 0);

  const add = (
    item: { id: string; name: string; priceCents: number },
    type: 'service' | 'product',
    barberId?: string,
  ) => {
    setCart((c) => {
      // Clé : pour une PRESTATION on inclut le coiffeur → une même prestation
      // réalisée par 2 coiffeurs = 2 lignes distinctes. Produits / lignes libres
      // (surplus) : pas de coiffeur, clé inchangée.
      const k = type === 'service' && barberId ? `${type}-${item.id}-${barberId}` : `${type}-${item.id}`;
      const ex = c.find((x) => x.k === k);
      if (ex) return c.map((x) => (x.k === k ? { ...x, qty: x.qty + 1 } : x));
      return [
        ...c,
        { k, type, id: item.id, name: item.name, priceCents: item.priceCents, qty: 1, barberId },
      ];
    });
  };

  // Coiffeurs autorisés pour une prestation : barberIds vide = tous. Repli sur
  // tous si le filtre vide tout (coiffeur assigné retiré).
  const allowedBarbersFor = (svc: Service): Barber[] => {
    const ids = svc.barberIds ?? [];
    if (ids.length === 0) return barbers;
    const filtered = barbers.filter((b) => ids.includes(b.id));
    return filtered.length > 0 ? filtered : barbers;
  };

  // Sélecteur de coiffeur PAR prestation. Ouvert au clic sur une prestation à
  // plusieurs coiffeurs (mode 'add') OU au clic sur le coiffeur d'une ligne du
  // ticket pour le changer (mode { changeKey }).
  const [barberPick, setBarberPick] = useState<{
    service: { id: string; name: string; priceCents: number };
    allowed: Barber[];
    mode: 'add' | { changeKey: string };
  } | null>(null);

  // Clic sur une prestation : 1 coiffeur possible → ajout direct ; sinon →
  // ouvre le sélecteur.
  const addService = (s: Service) => {
    const allowed = allowedBarbersFor(s);
    const item = { id: s.id, name: s.name, priceCents: s.priceCents };
    if (allowed.length <= 1) {
      add(item, 'service', allowed[0]?.id);
    } else {
      setBarberPick({ service: item, allowed, mode: 'add' });
    }
  };

  // Validation du sélecteur de coiffeur.
  const pickBarber = (barberId: string) => {
    if (!barberPick) return;
    if (barberPick.mode === 'add') {
      add(barberPick.service, 'service', barberId);
    } else {
      const changeKey = barberPick.mode.changeKey;
      setCart((c) => {
        const line = c.find((x) => x.k === changeKey);
        if (!line) return c;
        const newKey = `service-${line.id}-${barberId}`;
        if (newKey === changeKey) return c;
        // Une ligne identique (même prestation + nouveau coiffeur) existe déjà
        // → on fusionne les quantités au lieu de créer un doublon.
        const dupe = c.find((x) => x.k === newKey);
        if (dupe) {
          return c
            .filter((x) => x.k !== changeKey)
            .map((x) => (x.k === newKey ? { ...x, qty: x.qty + line.qty } : x));
        }
        return c.map((x) => (x.k === changeKey ? { ...x, k: newKey, barberId } : x));
      });
    }
    setBarberPick(null);
  };

  const sub = (k: string) =>
    setCart((c) =>
      c.flatMap((x) => (x.k === k ? (x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : []) : [x])),
    );

  const clear = () => setCart([]);

  // ── Surplus inline (ligne libre au-dessus des prestations) ─────────────
  //
  // Au lieu d'ouvrir une modale ou de jongler avec le champ « Supplément »
  // de PaymentModal, la caissière peut maintenant ajouter une ligne libre
  // (description + montant) DIRECTEMENT depuis l'UI POS. La ligne va dans
  // le cart comme un item service ordinaire, donc elle apparaît dans le
  // ticket à droite immédiatement. Cf. retour utilisateur :
  //   « rajouter juste au-dessus des prestations une ligne surplus avec
  //     une description et le montant, qui s'affiche automatiquement sur
  //     le ticket à droite »
  const [surplusDesc, setSurplusDesc] = useState('');
  const [surplusAmount, setSurplusAmount] = useState('');
  // Normalise « 12,30 » → « 12.30 » avant parseFloat — sans ça les caissières
  // FR / EG saisissent souvent avec virgule et le montant tombe en 12 EGP
  // au lieu de 12,30 EGP sans warning (audit T2.11).
  const surplusAmountCents = Math.max(
    0,
    Math.round((parseFloat(surplusAmount.replace(',', '.')) || 0) * 100),
  );
  const surplusValid = surplusDesc.trim().length > 0 && surplusAmountCents > 0;
  const addSurplus = () => {
    if (!surplusValid) return;
    const k = `surplus-${Date.now()}`;
    setCart((c) => [
      ...c,
      {
        k,
        type: 'service',
        id: k, // ID local — n'a pas de refId DB (sale_item.service_id = null
        // côté serveur via createDirectSale ; le name suffit à tracer).
        name: surplusDesc.trim(),
        priceCents: surplusAmountCents,
        qty: 1,
      },
    ]);
    setSurplusDesc('');
    setSurplusAmount('');
  };

  // ── Remise libre (« discount ») ──────────────────────────────────────────
  // Miroir du surplus, mais avec montant NÉGATIF côté ligne. Le total cumule
  // priceCents × qty (cf. ligne ~981), donc une ligne négative soustrait
  // naturellement. On cap à `total` courant pour ne jamais passer le ticket
  // en négatif. Persisté en sale_item.unit_price_cents — la migration 0005
  // déclare la colonne « signée : remise = négatif » (intention d'origine).
  const [discountDesc, setDiscountDesc] = useState('');
  const [discountAmount, setDiscountAmount] = useState('');
  const discountAmountCents = Math.max(
    0,
    Math.round((parseFloat(discountAmount.replace(',', '.')) || 0) * 100),
  );
  const discountExceedsTotal = discountAmountCents > total;
  const discountValid =
    discountDesc.trim().length > 0 && discountAmountCents > 0 && !discountExceedsTotal;
  const addDiscount = () => {
    if (!discountValid) return;
    const k = `discount-${Date.now()}`;
    setCart((c) => [
      ...c,
      {
        k,
        type: 'service',
        id: k, // ID local, pas de service_id en DB (comme le surplus).
        name: `${t('discountLinePrefix')}: ${discountDesc.trim()}`,
        priceCents: -discountAmountCents,
        qty: 1,
      },
    ]);
    setDiscountDesc('');
    setDiscountAmount('');
  };

  // ── Chargement d'un RDV dans le ticket (depuis ClientsToCheckoutSection) ─
  //
  // Le parent CashierApp envoie un signal via prop `bookingToLoadInTicket`.
  // On pré-remplit cart/barber/client, on note loadedBooking pour brancher
  // l'encaissement vers payBooking, puis on rend la main au parent qui
  // remet le signal à null.
  useEffect(() => {
    if (!bookingToLoadInTicket) return;
    const b = bookingToLoadInTicket;
    const baseService = services.find((s) => s.id === b.serviceId);

    const newCart: CartLine[] = [];
    if (baseService) {
      newCart.push({
        k: bookingBaseKey(b.id),
        type: 'service',
        id: baseService.id,
        name: baseService.name,
        priceCents: b.amountCents,
        qty: 1,
        // Prestation de base → coiffeur du RDV (modifiable par ligne ensuite).
        barberId: b.barberId || undefined,
      });
    }
    // Extras déjà ajoutés au RDV (cf. AddExtrasModal côté Rendez-vous) — on
    // les recopie tels quels dans le cart pour que la caissière les voie
    // et puisse les ajuster. Les extras-prestations héritent par défaut du
    // coiffeur du RDV (modifiable).
    (b.extras ?? []).forEach((e) => {
      newCart.push({
        k: e.key,
        type: e.kind,
        id: e.refId,
        name: e.name,
        priceCents: e.priceCents,
        qty: e.qty,
        barberId: e.kind === 'service' ? b.barberId || undefined : undefined,
      });
    });
    setCart(newCart);

    if (b.barberId) setBarberId(b.barberId);
    if (b.clientPhone) {
      // Le SelectedClient n'a que phone/firstName/lastName/email. On dérive
      // les noms depuis clientName (snapshot booking) ; pas idéal mais ça
      // suffit pour afficher le chip et activer le cashback.
      const parts = b.clientName.trim().split(/\s+/);
      setClient({
        phone: b.clientPhone,
        firstName: parts.slice(0, -1).join(' ') || parts[0] || null,
        lastName: parts.length > 1 ? (parts[parts.length - 1] ?? null) : null,
        email: null,
      });
    }
    setLoadedBooking(b);
    onBookingLoaded();
  }, [bookingToLoadInTicket, onBookingLoaded, services]);

  // Décrocher le RDV chargé : on vide le ticket pour redémarrer une vente
  // directe classique.
  const cancelLoadedBooking = () => {
    setLoadedBooking(null);
    setCart([]);
    setClient(null);
  };

  const onPay = async (method: SaleMethod, surplus: PaymentSurplus) => {
    cart.filter((x) => x.type === 'product').forEach((p) => decrementStock(p.id, p.qty));

    // Cf. CashierToday.handlePay — description du supplément remplace le
    // libellé générique « Supplément » quand elle est saisie.
    const supplementName = surplus.extraDescription || tSale('surplus');
    const supplementItems: SaleItem[] =
      surplus.extraCents > 0
        ? [{ type: 'service', name: supplementName, priceCents: surplus.extraCents, qty: 1 }]
        : [];

    // Capture du nom display + téléphone du client AVANT le reset du panier
    // — utilisé pour la vente locale (UI optimiste), createDirectSale (DB)
    // et la modale Reçu/QR qui s'affiche après.
    const clientDisplayName = client
      ? [client.firstName, client.lastName].filter(Boolean).join(' ').trim() || client.phone
      : '';
    const clientPhoneValue = client?.phone ?? '';
    // Capture du panier AVANT reset — on conserve refId + KEY pour l'insert
    // DB. La `k` est nécessaire pour distinguer le service de base d'un RDV
    // chargé (clé stable `booking-base-<id>`) des éventuelles autres lignes
    // que la caissière aurait ajoutées AVEC le même service. Sans `k`, le
    // filtre (id, priceCents) collisionnerait → le service de base ne serait
    // pas envoyé dans payBooking.extras → vente facturée 2× moins que prévu.
    const cartSnapshot = cart.map((c) => ({
      k: c.k,
      id: c.id,
      type: c.type,
      name: c.name,
      priceCents: c.priceCents,
      qty: c.qty,
      barberId: c.barberId,
    }));
    const itemsSnapshot = cartSnapshot.map(({ type, name, priceCents, qty, barberId: bid }) => ({
      type,
      name,
      priceCents,
      qty,
      barberId: bid,
    }));
    // Coiffeur « principal » de la vente (= 1re prestation avec coiffeur) pour
    // sales.barber_id (compat stats par coiffeur). L'attribution fine est par
    // ligne (sale_items.barber_id).
    const primaryBarberId = cart.find((c) => c.type === 'service' && c.barberId)?.barberId;
    // Total brut (avant cashback) — total panier + supplément éventuel.
    // Le cashback débité est soustrait pour obtenir le montant effectivement
    // encaissé en caisse. Le débit DB côté client_profiles a déjà été fait
    // par ApplyCashbackButton — `surplus.cashbackAppliedCents` ne sert ici
    // qu'à ajuster le total de la sale enregistrée.
    const grossTotal = total + surplus.extraCents;
    const totalWithSurplus = Math.max(0, grossTotal - surplus.cashbackAppliedCents);

    // ID local UNIQUE partagé entre la vente locale et le snapshot reçu —
    // permet plus tard de retrouver la sale locale et de réécrire son id
    // avec celui de la DB en une seule passe (sinon Date.now() appelé deux
    // fois donne deux IDs ≠ et la sale locale reste éternellement orpheline).
    const localId = 'local-' + Date.now();

    addSaleLocal({
      id: localId,
      date: todayStr(),
      time: new Date().toTimeString().slice(0, 5),
      items: [...itemsSnapshot, ...supplementItems],
      method,
      totalCents: totalWithSurplus,
      barberId: primaryBarberId ?? barberId,
      clientName: clientDisplayName || undefined,
      tipCents: surplus.tipCents,
    });

    // Snapshot pour la modale Reçu + PDF (avant que le state ne soit reset).
    const receiptItems = [
      ...itemsSnapshot.map(({ name, priceCents, qty }) => ({ name, priceCents, qty })),
      ...supplementItems.map((s) => ({ name: s.name, priceCents: s.priceCents, qty: s.qty ?? 1 })),
    ];
    const receiptSnapshot = {
      client: client
        ? { phone: client.phone, firstName: client.firstName, lastName: client.lastName }
        : null,
      totalCents: totalWithSurplus,
      itemsLabel: itemsSnapshot
        .map((i) => (i.qty > 1 ? `${i.name} × ${i.qty}` : i.name))
        .join(' + '),
      items: receiptItems,
      saleId: localId,
      method,
      tipCents: surplus.tipCents,
    };

    // Capture du booking chargé AVANT le reset — utilisé pour brancher vers
    // payBooking et marquer le RDV comme paid optimistiquement.
    const loadedBookingSnapshot = loadedBooking;

    // Optimistic : marque le booking comme payé tout de suite (rollback côté
    // server-side via revalidatePath si l'action échoue).
    if (loadedBookingSnapshot) {
      updateBookingLocal(loadedBookingSnapshot.id, { paid: true });
    }

    clear();
    setClient(null);
    setLoadedBooking(null);
    setPaying(false);
    setLastSale(receiptSnapshot);
    setReceiptOpen(true);

    // Branche : si un RDV est chargé dans le ticket → payBooking pour lier
    // la vente au booking + bénéficier de la logique « marquer paid + créer
    // sale + sale_items » côté serveur. Les items DU CART qui ne sont pas
    // le service de base sont envoyés comme `extras` ; le service de base
    // est implicite (payBooking le lit depuis bookings.service_id).
    let result;
    if (loadedBookingSnapshot) {
      // Le service de base du RDV est déjà connu côté serveur (lu depuis
      // bookings.service_id par payBooking) — on l'EXCLUT du cart envoyé en
      // extras. Filtre par la CLÉ TECHNIQUE `bookingBaseKey(id)` (stable,
      // unique) plutôt que par (id, priceCents) qui pouvait collisionner
      // si la caissière ajoutait la même prestation que le RDV comme
      // supplément → 1ère prestation jamais facturée. Confirmé par audit
      // 2026-05-24 T1.6.
      const baseKey = bookingBaseKey(loadedBookingSnapshot.id);
      const extras = cartSnapshot
        .filter((c) => c.k !== baseKey)
        .map((c) => ({
          kind: c.type,
          refId: c.id,
          name: c.name,
          priceCents: c.priceCents,
          qty: c.qty,
          barberId: c.barberId,
        }));
      const baseSvc = services.find((s) => s.id === loadedBookingSnapshot.serviceId);
      result = await payBooking({
        bookingId: loadedBookingSnapshot.id,
        method,
        serviceName: baseSvc?.name,
        tipCents: surplus.tipCents,
        extraCents: surplus.extraCents,
        extraDescription: surplus.extraDescription,
        cashbackAppliedCents: surplus.cashbackAppliedCents,
        extras,
      });
    } else {
      result = await createDirectSale({
        barberId: primaryBarberId || undefined,
        clientPhone: clientPhoneValue || undefined,
        clientName: clientDisplayName || undefined,
        tipCents: surplus.tipCents,
        extraCents: surplus.extraCents,
        extraDescription: surplus.extraDescription,
        cashbackAppliedCents: surplus.cashbackAppliedCents,
        method,
        items: cartSnapshot.map((c) => ({
          kind: c.type,
          refId: c.id,
          name: c.name,
          priceCents: c.priceCents,
          qty: c.qty,
          barberId: c.barberId,
        })),
      });
    }

    if (!result.ok) {
      // Rollback : la vente locale (optimistic UI) doit disparaître pour
      // ne pas laisser une vente fantôme dans le log Caisse et fausser les
      // KPIs côté Direction (qui partage le state via les props sales).
      // Le stock est rollback aussi (les `decrementStock` du début).
      // Le RDV chargé est aussi remis à paid=false pour rester cohérent.
      setSales((prev) => prev.filter((s) => s.id !== localId));
      cartSnapshot.filter((x) => x.type === 'product').forEach((p) => decrementStock(p.id, -p.qty));
      if (loadedBookingSnapshot) {
        updateBookingLocal(loadedBookingSnapshot.id, { paid: false });
      }
      // Ferme la modale Reçu : l'utilisateur ne peut pas envoyer un email
      // pour une vente qui n'existe pas en DB. Affiche le toast d'erreur.
      setReceiptOpen(false);
      setLastSale(null);
      showError(tErrors(result.errorKey as 'unknownError', result.errorValues));
      // Resync depuis la DB pour récupérer l'état server-authoritatif —
      // critique si plusieurs caissiers travaillent en parallèle ou si le
      // fail vient d'une race (stock épuisé par un autre POS). Le refresh
      // re-trigger le Server Component cashier/page.tsx qui re-fetch les
      // products + bookings + sales serveur, écrasant les valeurs locales.
      router.refresh();
    } else if (result.id) {
      // Propage l'ID DB sur deux fronts :
      //   1. La vente locale (sales[]) — pour que le bouton "Rembourser"
      //      fonctionne dans CashierLog (refund-actions.ts exige un UUID).
      //   2. Le snapshot Reçu (lastSale) — pour débloquer l'envoi email
      //      et le PDF avec un identifiant stable côté serveur.
      const dbId = result.id;
      setSales((prev) => prev.map((s) => (s.id === localId ? { ...s, id: dbId } : s)));
      setLastSale((prev) => (prev ? { ...prev, saleId: dbId } : prev));
    }
  };

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-6 py-10 md:px-10 lg:grid-cols-[1fr_380px]">
      <div>
        <div className="mb-6">
          <Tag tone="copper">{t('eyebrow')}</Tag>
          <h2 className="display mt-2 text-3xl">{t('title')}</h2>
        </div>

        {/* Le coiffeur se choisit désormais PAR prestation (au clic / dans le
            ticket), plus via un sélecteur global ici. */}

        {/* ── Client rattaché à la vente (recherche + sélection / création) ─
            Remplace les anciens champs « Nom » + « Téléphone » séparés qui
            créaient des doublons. Le client doit être identifié (existant
            ou nouveau) pour que les points de fidélité s'accumulent sur
            le bon profil et qu'on puisse afficher le QR code post-vente. */}
        <div className="mt-4">
          <span className="mono text-ink-soft mb-1.5 block text-[9px] uppercase tracking-[0.2em]">
            Client{' '}
            <span className="text-ink-mute font-normal normal-case">
              (recommandé · pour les points de fidélité)
            </span>
          </span>
          <ClientSelector tenantId={tenantId} value={client} onChange={setClient} />
          {/* Solde cashback du client dès qu'il est rattaché — le caissier le
              voit immédiatement (avant le paiement). L'application réelle se
              fait dans la modale d'encaissement. */}
          {tenantId && client?.phone && (
            <CashbackHint tenantId={tenantId} phone={client.phone} />
          )}
        </div>

        {/* Clients en attente d'encaissement — RDV en cours ou terminés non
            payés. Cliquer une ligne → charge le RDV dans le ticket à droite. */}
        <ClientsToCheckoutSection
          bookings={bookings}
          services={services}
          barbers={barbers}
          onLoadIntoTicket={(b) => {
            // Warning si le ticket courant contient déjà des items NON liés
            // à un RDV déjà chargé : on prévient la caissière qu'elle va
            // écraser une vente en cours de préparation. Audit T2.13.
            const isReplacingDifferent = loadedBooking && loadedBooking.id !== b.id;
            const hasUnloadedItems = !loadedBooking && cart.length > 0;
            if (
              (isReplacingDifferent || hasUnloadedItems) &&
              typeof window !== 'undefined' &&
              !window.confirm(t('loadBookingReplaceWarning', { name: b.clientName }))
            ) {
              return; // L'utilisateur annule → on garde le ticket courant.
            }

            // POS reçoit le booking et le pousse via useEffect dans son cart.
            // On le marque immédiatement ici via setLoadedBooking pour que la
            // bannière apparaisse au prochain render.
            const baseService = services.find((s) => s.id === b.serviceId);
            const newCart: CartLine[] = [];
            if (baseService) {
              newCart.push({
                k: bookingBaseKey(b.id),
                type: 'service',
                id: baseService.id,
                name: baseService.name,
                priceCents: b.amountCents,
                qty: 1,
              });
            }
            (b.extras ?? []).forEach((e) => {
              newCart.push({
                k: e.key,
                type: e.kind,
                id: e.refId,
                name: e.name,
                priceCents: e.priceCents,
                qty: e.qty,
              });
            });
            setCart(newCart);
            if (b.barberId) setBarberId(b.barberId);
            if (b.clientPhone) {
              const parts = b.clientName.trim().split(/\s+/);
              setClient({
                phone: b.clientPhone,
                firstName: parts.slice(0, -1).join(' ') || parts[0] || null,
                lastName: parts.length > 1 ? (parts[parts.length - 1] ?? null) : null,
                email: null,
              });
            }
            setLoadedBooking(b);
          }}
          loadedBookingId={loadedBooking?.id ?? null}
          highlightBookingId={highlightBookingId}
        />

        {/* Onglets catalogue : Prestations | Produits — séparés (plus empilés
            sous des dividers), 4 cartes par ligne. Style aligné sur le
            sélecteur de période du tableau de bord. */}
        <div className="border-line bg-bg-soft mt-2 mb-5 inline-flex rounded-sm border p-1">
          {(['services', 'products'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setCatalogTab(k)}
              className={`mono px-5 py-1.5 text-[11px] uppercase tracking-wider transition-colors ${
                catalogTab === k ? 'bg-brand-primary text-white' : 'text-ink-mute hover:text-ink'
              }`}
            >
              {k === 'services' ? t('servicesDivider') : t('productsDivider')}
              <span className="ms-2 opacity-60">
                {k === 'services' ? services.length : products.length}
              </span>
            </button>
          ))}
        </div>

        {/* Onglet Prestations — groupé par catégorie (reflète l'organisation
            faite côté Manager). Si aucun service n'a de catégorie → grille
            plate sans header. */}
        {catalogTab === 'services' &&
          (services.length === 0 ? (
            <p className="text-ink-mute py-10 text-center text-sm">{t('catalogEmpty')}</p>
          ) : (
            (() => {
              const grouped: Array<[string, typeof services]> = [];
              for (const s of services) {
                const cat = s.category?.trim() ?? '';
                let entry = grouped.find(([c]) => c === cat);
                if (!entry) {
                  entry = [cat, []];
                  grouped.push(entry);
                }
                entry[1].push(s);
              }
              return grouped.map(([cat, items]) => (
                <div key={cat || '__none__'} className={cat ? 'mt-3' : ''}>
                  {cat && (
                    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="mono text-ink-soft text-[10px] uppercase tracking-wider">
                        {cat}
                      </span>
                      {/* Coiffeur(s) de la section = union des coiffeurs assignés
                          à ses prestations. Vide = tous → on n'affiche rien. */}
                      {(() => {
                        const names = Array.from(new Set(items.flatMap((s) => s.barberIds)))
                          .map((id) => barbers.find((b) => b.id === id)?.name)
                          .filter(Boolean);
                        return names.length > 0 ? (
                          <span className="text-ink-soft inline-flex items-center gap-1 text-[11px] normal-case tracking-normal">
                            <User className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                            {names.join(', ')}
                          </span>
                        ) : null;
                      })()}
                    </div>
                  )}
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {items.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => addService(s)}
                        className="btn-press tile-hover border-line bg-surface rounded-sm border p-4 text-start"
                      >
                        <div className="text-brand-primary mb-2">
                          <ServiceIcon iconKey={s.icon} className="h-5 w-5" />
                        </div>
                        <div className="display mb-1 text-base">{s.name}</div>
                        <div className="mono text-ink text-sm">{fmt(s.priceCents)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ));
            })()
          ))}

        {/* Onglet Produits */}
        {catalogTab === 'products' &&
          (products.length === 0 ? (
            <p className="text-ink-mute py-10 text-center text-sm">{t('catalogEmpty')}</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {products.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={p.stock === 0}
                  onClick={() => add({ id: p.id, name: p.name, priceCents: p.priceCents }, 'product')}
                  className={`btn-press tile-hover bg-surface rounded-sm border p-4 text-start ${
                    p.stock === 0
                      ? 'border-line cursor-not-allowed opacity-30'
                      : p.stock <= p.low
                        ? 'border-red/30'
                        : 'border-line'
                  }`}
                >
                  <div className="mb-2 flex items-start justify-between">
                    <Package className="text-brand-primary h-5 w-5" strokeWidth={1.5} />
                    <span
                      className={`mono text-[10px] uppercase tracking-wider ${p.stock <= p.low ? 'text-red' : 'text-ink-soft'}`}
                    >
                      {t('stockBadge', { count: p.stock })}
                    </span>
                  </div>
                  <div className="display mb-1 text-base">{p.name}</div>
                  <div className="mono text-ink text-sm">{fmt(p.priceCents)}</div>
                </button>
              ))}
            </div>
          ))}
      </div>

      {/* Colonne droite : ticket + ajustements (Surplus / Remise) empilés
          DESSOUS le ticket. Le tout sticky comme un seul panneau. */}
      <div className="self-start space-y-4 lg:sticky lg:top-32">
      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="display text-2xl">{t('ticket')}</h3>
          {cart.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (loadedBooking) cancelLoadedBooking();
                else clear();
              }}
              className="btn-press text-red mono text-xs uppercase tracking-wider"
            >
              {t('clearTicket')}
            </button>
          )}
        </div>

        {/* Bannière RDV chargé — pour que la caissière sache que ce ticket
            paiera le RDV X (et pas une vente directe). X pour décrocher. */}
        {loadedBooking && (
          <div className="border-brand-primary/30 bg-brand-primary/5 mb-3 flex items-start gap-2 rounded-sm border p-3">
            <Receipt className="text-brand-primary mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
            <div className="min-w-0 flex-1">
              <div className="mono text-brand-primary text-[9px] uppercase tracking-[0.2em]">
                {t('loadedBookingTag')}
              </div>
              <div className="text-ink mt-0.5 truncate text-sm font-semibold">
                {loadedBooking.clientName}
              </div>
              <div className="text-ink-mute mt-0.5 text-[11px]">
                {services.find((s) => s.id === loadedBooking.serviceId)?.name ?? '—'} ·{' '}
                {loadedBooking.time}
              </div>
            </div>
            <button
              type="button"
              onClick={cancelLoadedBooking}
              aria-label={t('loadedBookingDetachAria')}
              title={t('loadedBookingDetachTitle')}
              className="btn-press border-line hover:border-red text-ink-soft hover:text-red flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="border-line text-ink-mute mb-3 flex flex-wrap gap-x-3 gap-y-0.5 border-b pb-3 text-xs">
          <span>
            {t('ticketClient')}{' '}
            <span className="text-ink font-semibold">
              {client
                ? [client.firstName, client.lastName].filter(Boolean).join(' ').trim() ||
                  client.phone
                : '—'}
            </span>
          </span>
        </div>

        {cart.length === 0 ? (
          <div className="text-ink-soft py-10 text-center">
            <Receipt className="mx-auto mb-3 h-10 w-10" strokeWidth={1} />
            <div className="mono text-xs uppercase tracking-wider">{t('ticketEmpty')}</div>
            <div className="text-ink-mute mt-2 text-xs">{t('ticketEmptyHint')}</div>
          </div>
        ) : (
          <div className="scrollbar mb-4 max-h-[300px] space-y-2 overflow-y-auto pe-1">
            {cart.map((c) => (
              <div key={c.k} className="bg-surface-elev flex items-center gap-2 rounded-sm p-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{c.name}</div>
                  {/* Coiffeur de la ligne (prestations réelles uniquement, pas
                      les lignes libres / surplus). Tap → change le coiffeur. */}
                  {(() => {
                    const svc =
                      c.type === 'service' ? services.find((s) => s.id === c.id) : undefined;
                    if (!svc) return null;
                    const allowed = allowedBarbersFor(svc);
                    return (
                      <button
                        type="button"
                        onClick={() =>
                          setBarberPick({
                            service: { id: c.id, name: c.name, priceCents: c.priceCents },
                            allowed,
                            mode: { changeKey: c.k },
                          })
                        }
                        className="text-ink-soft hover:text-ink mt-0.5 flex items-center gap-1 text-[11px]"
                      >
                        <User className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                        <span className="underline-offset-2 hover:underline">
                          {barbers.find((b) => b.id === c.barberId)?.name ?? t('chooseBarber')}
                        </span>
                      </button>
                    );
                  })()}
                  <div className="mono text-ink-mute text-xs">
                    {fmt(c.priceCents)} × {c.qty}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => sub(c.k)}
                  className="btn-press border-line hover:border-brand-primary flex h-7 w-7 items-center justify-center rounded-sm border"
                >
                  <Minus className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => add({ id: c.id, name: c.name, priceCents: c.priceCents }, c.type, c.barberId)}
                  className="btn-press border-line hover:border-brand-primary flex h-7 w-7 items-center justify-center rounded-sm border"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <Divider />
        <div className="mb-5 flex items-baseline justify-between">
          <span className="mono text-ink-soft text-[10px] uppercase tracking-[0.25em]">
            {t('total')}
          </span>
          <span className="display text-brand-primary mono text-4xl">{fmt(total)}</span>
        </div>
        <Btn
          full
          size="lg"
          disabled={cart.length === 0}
          onClick={() => setPaying(true)}
          icon={CreditCard as LucideIcon}
        >
          {t('collect')}
        </Btn>
      </Card>

      {/* Ajustements libres — Surplus (ajoute) + Remise (soustrait), empilés
          SOUS le ticket. Accent vert/rouge + bouton, pour ne jamais confondre. */}
      <div className="space-y-3">
        {/* Surplus libre (AJOUT) — accent vert (borderInlineStart = RTL-safe). */}
        <div
          className="bg-surface border-line rounded-sm border p-4"
          style={{ borderInlineStartWidth: '3px', borderInlineStartColor: '#10B981' }}
        >
          <h3 className="display text-base leading-tight">{t('surplusHeader')}</h3>
          <div className="mt-3 grid grid-cols-[1fr_110px] gap-2">
            <input
              type="text"
              value={surplusDesc}
              onChange={(e) => setSurplusDesc(e.target.value)}
              placeholder={t('surplusDescPlaceholder')}
              className="border-line bg-bg-soft text-ink placeholder:text-ink-soft focus:border-brand-primary rounded-sm border px-3 py-2 text-sm outline-none"
            />
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={surplusAmount}
              onChange={(e) => setSurplusAmount(e.target.value)}
              placeholder={t('surplusAmountPlaceholder')}
              className="border-line bg-bg-soft text-ink placeholder:text-ink-soft focus:border-brand-primary mono rounded-sm border px-3 py-2 text-sm outline-none"
            />
          </div>
          <button
            type="button"
            onClick={addSurplus}
            disabled={!surplusValid}
            className={`btn-press mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-sm px-4 py-2 text-xs font-semibold transition-colors ${
              surplusValid
                ? 'border-brand-primary/60 bg-brand-primary/5 text-brand-primary hover:bg-brand-primary/10 border'
                : 'border-line text-ink-soft cursor-not-allowed border opacity-50'
            }`}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            {t('surplusAddBtn')}
          </button>
        </div>

        {/* Remise libre (SOUSTRACTION) — accent rouge. Cap = total courant. */}
        <div
          className="bg-surface border-line rounded-sm border p-4"
          style={{ borderInlineStartWidth: '3px', borderInlineStartColor: '#DC2626' }}
        >
          <h3 className="display text-base leading-tight">{t('discountHeader')}</h3>
          <div className="mt-3 grid grid-cols-[1fr_110px] gap-2">
            <input
              type="text"
              value={discountDesc}
              onChange={(e) => setDiscountDesc(e.target.value)}
              placeholder={t('discountDescPlaceholder')}
              className="border-line bg-bg-soft text-ink placeholder:text-ink-soft focus:border-brand-primary rounded-sm border px-3 py-2 text-sm outline-none"
            />
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
              placeholder={t('discountAmountPlaceholder')}
              className="border-line bg-bg-soft text-ink placeholder:text-ink-soft focus:border-brand-primary mono rounded-sm border px-3 py-2 text-sm outline-none"
            />
          </div>
          <button
            type="button"
            onClick={addDiscount}
            disabled={!discountValid}
            style={
              discountValid
                ? { borderColor: 'rgba(220,38,38,0.5)', backgroundColor: 'rgba(220,38,38,0.06)', color: '#B91C1C' }
                : undefined
            }
            className={`btn-press mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-sm border px-4 py-2 text-xs font-semibold transition-colors ${
              discountValid ? '' : 'border-line text-ink-soft cursor-not-allowed opacity-50'
            }`}
          >
            <Minus className="h-3.5 w-3.5" strokeWidth={2} />
            {t('discountAddBtn')}
          </button>
          {discountExceedsTotal && (
            <p className="mt-2 text-[11px] font-medium" style={{ color: '#B91C1C' }}>
              {t('discountExceedsTotal')}
            </p>
          )}
        </div>
      </div>
      </div>

      <PaymentModal
        open={paying}
        onClose={() => setPaying(false)}
        title={t('paymentModalTitle')}
        items={cart.map((c) => ({
          type: c.type,
          name: c.name,
          priceCents: c.priceCents,
          qty: c.qty,
        }))}
        tenantId={tenantId}
        clientPhone={client?.phone ?? null}
        onConfirm={(method, surplus) => void onPay(method, surplus)}
      />

      {/* Sélecteur de coiffeur par prestation (ouvert à l'ajout d'une
          prestation à plusieurs coiffeurs, ou au clic sur le coiffeur d'une
          ligne du ticket). */}
      <Modal
        open={!!barberPick}
        onClose={() => setBarberPick(null)}
        title={barberPick ? t('barberPickTitle', { name: barberPick.service.name }) : ''}
      >
        {barberPick && (
          <div className="flex flex-wrap gap-2">
            {barberPick.allowed.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => pickBarber(b.id)}
                className="btn-press border-line hover:border-brand-primary bg-surface flex items-center gap-2 rounded-sm border px-4 py-2.5 text-sm font-semibold"
              >
                <User className="h-4 w-4" strokeWidth={1.6} />
                {b.name}
              </button>
            ))}
          </div>
        )}
      </Modal>

      {/* Sticky bottom CTA mobile — au-dessous de `lg` le ticket n'est
          plus sticky parce qu'il est en colonne empilée. La caissière doit
          scroller jusqu'en bas pour trouver « Encaisser ». Ce bandeau
          flottant affiche le total + bouton dès qu'il y a au moins 1 item.
          Audit T5.22. */}
      {cart.length > 0 && (
        <div
          className="bg-surface border-line pointer-events-auto fixed inset-x-0 bottom-0 z-40 border-t px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.12)] lg:hidden"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
        >
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div className="flex flex-col">
              <span className="mono text-ink-soft text-[9px] uppercase tracking-[0.25em]">
                {t('total')}
              </span>
              <span className="mono text-brand-primary display text-xl">{fmt(total)}</span>
            </div>
            <Btn
              size="md"
              disabled={cart.length === 0}
              onClick={() => setPaying(true)}
              icon={CreditCard as LucideIcon}
            >
              {t('collect')}
            </Btn>
          </div>
        </div>
      )}

      {/* Modale Reçu + QR — affichée après chaque vente. Permet au client
          de scanner pour retrouver sa facture et ses points dans son espace.
          Si aucun client n'était rattaché, la modale reste affichée pour
          confirmer l'encaissement mais sans QR. */}
      <ReceiptQRModal
        open={receiptOpen}
        onClose={() => {
          setReceiptOpen(false);
          setLastSale(null);
        }}
        client={lastSale?.client ?? null}
        totalCents={lastSale?.totalCents ?? 0}
        itemsLabel={lastSale?.itemsLabel ?? ''}
        items={lastSale?.items ?? []}
        saleId={lastSale?.saleId ?? ''}
        method={lastSale?.method ?? 'card'}
        tipCents={lastSale?.tipCents}
        slug={slug}
      />
    </div>
  );
}

// =============================================================================
// PaymentModal
// =============================================================================
interface PaymentSurplus {
  extraCents: number;
  tipCents: number;
  /** Cashback déjà débité côté DB (via ApplyCashbackButton). À soustraire
   *  du total à encaisser en caisse — la sale enregistrée reflètera ce
   *  montant net. Le débit client_profiles.cashback_redeemed_cents est
   *  déjà fait par le composant — le parent n'a plus rien à faire. */
  cashbackAppliedCents: number;
  /** Description du supplément — obligatoire dès qu'`extraCents > 0`.
   *  Devient le `name` du sale_item généré côté serveur (à la place du
   *  générique « Supplément »), pour expliquer le surplus dans le log
   *  d'encaissements et sur le reçu client. */
  extraDescription: string;
}

interface PaymentModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  items: SaleItem[];
  /** Tenant ID + phone du client attaché, si présent. Utilisés par le
   *  bouton « Appliquer cashback » pour fetch/débiter le solde. */
  tenantId: string | null;
  clientPhone: string | null;
  onConfirm: (method: SaleMethod, surplus: PaymentSurplus) => void;
}

function PaymentModal({
  open,
  onClose,
  title,
  items,
  tenantId,
  clientPhone,
  onConfirm,
}: PaymentModalProps) {
  const t = useTranslations('cashier.payment');
  const fmt = useFmtMoney();
  const [extra, setExtra] = useState('');
  const [tip, setTip] = useState('');
  /** Description obligatoire dès qu'un supplément est saisi — justifie la
   *  ligne pour le client (sur le reçu) et pour la Direction (dans le log). */
  const [extraDescription, setExtraDescription] = useState('');
  /** Montant cashback débité — set par le callback du composant
   *  ApplyCashbackButton. Le débit DB est déjà fait à ce moment-là. */
  const [cashbackAppliedCents, setCashbackAppliedCents] = useState(0);
  /** Méthode de paiement sélectionnée — la confirmation ne se fait QUE via
   *  le bouton plein en dessous (2-step flow). Audit T2.8 : tap accidentel
   *  sur méthode = vente immédiate sans undo, désormais impossible. */
  const [selectedMethod, setSelectedMethod] = useState<SaleMethod | null>(null);

  // Réinitialise les champs surplus + cashback + sélection à chaque ouverture.
  useEffect(() => {
    if (open) {
      setExtra('');
      setTip('');
      setExtraDescription('');
      setCashbackAppliedCents(0);
      setSelectedMethod(null);
    }
  }, [open]);

  const itemsTotal = items.reduce((s, i) => s + i.priceCents * (i.qty ?? 1), 0);
  // Saisie en unités (€/EGP) → centimes. Valeurs négatives/NaN ramenées à 0.
  // Normalise virgule décimale FR/EG → point avant parseFloat (cf. audit T2.11).
  const toCents = (v: string) =>
    Math.max(0, Math.round((parseFloat(v.replace(',', '.')) || 0) * 100));
  const extraCents = toCents(extra);
  const tipCents = toCents(tip);
  // Total brut (avant cashback) — c'est ce qui apparaîtra dans le détail.
  const grossTotal = itemsTotal + extraCents + tipCents;
  // Montant à encaisser après cashback. Garde-fou : on ne descend jamais
  // sous zéro (au pire le caissier remet 0 et le cashback excédentaire
  // serait perdu — mais ApplyCashbackButton plafonne déjà à grossTotal).
  const grandTotal = Math.max(0, grossTotal - cashbackAppliedCents);

  const methods: Array<{ key: SaleMethod; label: string; icon: LucideIcon }> = [
    { key: 'card', label: t('methodCard'), icon: CreditCard },
    { key: 'cash', label: t('methodCash'), icon: Banknote },
    { key: 'mobile', label: t('methodMobile'), icon: Smartphone },
  ];

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="mb-5 space-y-2">
        {items.map((i, k) => (
          <div key={k} className="flex items-center justify-between text-sm">
            <span className="text-ink-mute">
              {i.name}
              {i.qty && i.qty > 1 ? ` × ${i.qty}` : ''}
            </span>
            <span className="mono">{fmt(i.priceCents * (i.qty ?? 1))}</span>
          </div>
        ))}
      </div>

      {/* Pourboire — à part du chiffre. Le supplément libre se saisit
          désormais EXCLUSIVEMENT via la ligne Surplus inline au-dessus
          des Prestations dans CashierPOS (un seul endroit, pas de doublon
          possible entre PaymentModal + Surplus). Audit T2.10. */}
      <div className="border-line mb-4 border-t pt-4">
        <label className="block">
          <span className="mono text-ink-soft mb-1.5 block text-[9px] uppercase tracking-[0.2em]">
            {t('tipLabel')}
          </span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            value={tip}
            onChange={(e) => setTip(e.target.value)}
            placeholder="0"
            className="border-line bg-bg-soft text-ink placeholder:text-ink-soft focus:border-brand-primary w-full rounded-sm border px-3 py-2 text-sm outline-none"
          />
        </label>
      </div>

      {/* Bouton « Appliquer cashback » — visible uniquement si client attaché
          ET tenant connu. Le composant fait le débit DB lui-même, on capture
          juste le montant pour ajuster le total à encaisser. */}
      {tenantId && clientPhone && (
        <div className="mb-4">
          <ApplyCashbackButton
            tenantId={tenantId}
            phone={clientPhone}
            saleTotalCents={grossTotal}
            onRedeemed={(amountCents) => setCashbackAppliedCents(amountCents)}
          />
        </div>
      )}

      <Divider />
      {/* Si du cashback a été appliqué, on affiche la mécanique brut →
          cashback → net pour que le caissier comprenne le montant final. */}
      {cashbackAppliedCents > 0 && (
        <>
          <div className="text-ink-soft mb-1 flex items-baseline justify-between text-xs">
            <span>{t('grossLabel')}</span>
            <span className="mono">{fmt(grossTotal)}</span>
          </div>
          <div
            className="mb-1 flex items-baseline justify-between text-xs"
            style={{ color: '#E0A23D' }}
          >
            <span>{t('cashbackLabel')}</span>
            <span className="mono">− {fmt(cashbackAppliedCents)}</span>
          </div>
        </>
      )}
      <div className="mb-6 flex items-baseline justify-between">
        <span className="mono text-ink-soft text-[10px] uppercase tracking-[0.25em]">
          {t('amountDue')}
        </span>
        <span className="display text-brand-primary mono text-4xl">{fmt(grandTotal)}</span>
      </div>
      {/* Flow 2 étapes : on SÉLECTIONNE d'abord la méthode (1er clic =
          highlight, pas de commit), puis on CONFIRME via le bouton plein
          en dessous. Évite l'encaissement par tap accidentel sur mobile
          (audit T2.8) — auparavant un clic = vente immédiate sans undo. */}
      <div className="grid grid-cols-3 gap-2">
        {methods.map((m) => {
          const selected = selectedMethod === m.key;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setSelectedMethod(m.key)}
              className={`btn-press tile-hover rounded-sm border p-5 text-center transition-colors ${
                selected
                  ? 'border-brand-primary bg-brand-primary/10'
                  : 'bg-surface-elev border-line-hi hover:border-brand-primary'
              }`}
            >
              <m.icon className="text-brand-primary mx-auto mb-3 h-7 w-7" strokeWidth={1.3} />
              <div className="text-sm font-semibold">{m.label}</div>
            </button>
          );
        })}
      </div>

      {/* Bouton de confirmation finale — affiche le montant à encaisser
          et la méthode sélectionnée. Désactivé tant que la méthode n'est
          pas choisie OU que la description du surplus manque. */}
      {(() => {
        const blockedDesc = extraCents > 0 && !extraDescription.trim();
        const ready = selectedMethod && !blockedDesc;
        const selectedLabel = methods.find((m) => m.key === selectedMethod)?.label ?? '';
        // Audit T5.21 : sur mobile le bouton disabled etait peu visible
        // (bg-soft + text-ink-soft = faible contraste avec le fond modal).
        // On differencie clairement : bordure pointillée + texte plus
        // visible + petite flèche ↑ indiquant les methods au-dessus.
        return (
          <button
            type="button"
            disabled={!ready}
            onClick={() => {
              if (!selectedMethod) return;
              onConfirm(selectedMethod, {
                extraCents,
                tipCents,
                cashbackAppliedCents,
                extraDescription: extraDescription.trim(),
              });
            }}
            title={!ready ? t('selectMethodFirst') : ''}
            className={`btn-press mt-4 w-full rounded-sm py-4 text-base font-semibold transition-all ${
              ready
                ? 'bg-brand-primary text-white hover:opacity-90'
                : 'bg-bg-soft text-ink-mute border-line-hi cursor-not-allowed border-2 border-dashed'
            }`}
          >
            {ready
              ? t('confirmCollect', { amount: fmt(grandTotal), method: selectedLabel })
              : `↑ ${t('selectMethodFirst')}`}
          </button>
        );
      })()}
    </Modal>
  );
}

// =============================================================================
// Encaissements log
// =============================================================================
interface LogProps {
  sales: Sale[];
  setSales: React.Dispatch<React.SetStateAction<Sale[]>>;
  barbers: Barber[];
}

function CashierLog({ sales, setSales, barbers }: LogProps) {
  const t = useTranslations('cashier.log');
  const tErrors = useTranslations('manager.errors');
  const fmt = useFmtMoney();
  const locale = useLocale();
  const toast = useToast();
  const [resending, startResend] = useTransition();
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [refundTarget, setRefundTarget] = useState<Sale | null>(null);

  const handleResendEmail = (saleId: string) => {
    // Bornes UX : on stocke l'id en cours pour griser uniquement la ligne
    // active, pas tout le tableau.
    setResendingId(saleId);
    startResend(async () => {
      const res = await sendReceiptEmail({
        saleId,
        locale: locale === 'ar' || locale === 'en' ? locale : 'fr',
        forceResend: true,
      });
      setResendingId(null);
      if (res.ok) {
        toast.success(t('resendEmailSentToast'));
      } else {
        toast.error(tErrors(res.errorKey as 'dbError', res.errorValues));
      }
    });
  };

  const todays = sales
    .filter((s) => s.date === todayStr())
    .sort((a, b) => b.time.localeCompare(a.time));

  // Montant net effectivement encaissé pour une vente : total facturé moins
  // la part remboursée (0 pour les ventes intactes, partielle ou totale pour
  // les autres). Utilisé partout dans les KPIs.
  const netOf = (s: Sale) => Math.max(0, s.totalCents - (s.refundedCents ?? 0));

  // KPIs : on additionne le NET de chaque vente (au lieu d'exclure binairement
  // les refunds). Une vente entièrement remboursée contribue 0 ; un refund
  // partiel contribue ce qui reste.
  const total = todays.reduce((s, x) => s + netOf(x), 0);
  const byMethod = todays.reduce<Record<SaleMethod, number>>(
    (acc, s) => {
      acc[s.method] = (acc[s.method] ?? 0) + netOf(s);
      return acc;
    },
    { card: 0, cash: 0, mobile: 0 },
  );

  const handleRefunded = (
    saleId: string,
    refundedAt: string,
    reason: string | null,
    refundedCents: number,
    fullyRefunded: boolean,
  ) => {
    setSales((prev) =>
      prev.map((s) =>
        s.id === saleId
          ? {
              ...s,
              refunded: fullyRefunded,
              refundedAt,
              refundReason: reason ?? undefined,
              refundedCents,
            }
          : s,
      ),
    );
    setRefundTarget(null);
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-10 md:px-10">
      <div className="mb-8">
        <Tag tone="copper">{t('eyebrow')}</Tag>
        <h2 className="display mt-3 text-4xl">
          {t('titlePrefix')}
          <span className="display-i text-brand-glow">
            {new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
          </span>
        </h2>
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-4">
        <Card className="col-span-2 p-5 sm:col-span-1">
          <div className="mono text-ink-soft text-[9px] uppercase tracking-[0.25em]">
            {t('kpiTotal')}
          </div>
          <div className="display text-brand-primary mono mt-1 text-4xl">{fmt(total)}</div>
        </Card>
        <Card className="p-5">
          <div className="mono text-ink-soft text-[9px] uppercase tracking-[0.25em]">
            {t('kpiCard')}
          </div>
          <div className="display mono mt-1 text-2xl">{fmt(byMethod.card)}</div>
        </Card>
        <Card className="p-5">
          <div className="mono text-ink-soft text-[9px] uppercase tracking-[0.25em]">
            {t('kpiCash')}
          </div>
          <div className="display mono mt-1 text-2xl">{fmt(byMethod.cash)}</div>
        </Card>
        <Card className="p-5">
          <div className="mono text-ink-soft text-[9px] uppercase tracking-[0.25em]">
            {t('kpiMobile')}
          </div>
          <div className="display mono mt-1 text-2xl">{fmt(byMethod.mobile)}</div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        {/* Table à défilement horizontal sur mobile — colonnes à gabarit fixe. */}
        <div className="scrollbar overflow-x-auto">
          <div className="border-line mono text-ink-soft grid min-w-[860px] grid-cols-[80px_1fr_140px_140px_100px_120px_120px] gap-4 border-b px-5 py-3 text-[9px] uppercase tracking-[0.25em]">
            <div>{t('colTime')}</div>
            <div>{t('colDetail')}</div>
            <div>{t('colClient')}</div>
            <div>{t('colBarber')}</div>
            <div>{t('colMethod')}</div>
            <div className="text-end">{t('colAmount')}</div>
            <div className="sr-only">{t('refundActionsAria')}</div>
          </div>
          {todays.length === 0 ? (
            <div className="text-ink-mute p-10 text-center">{t('empty')}</div>
          ) : (
            todays.map((s) => {
              const b = barbers.find((x) => x.id === s.barberId);
              const refunded = s.refunded === true;
              const refundedCents = s.refundedCents ?? 0;
              const isPartial = !refunded && refundedCents > 0;
              const net = netOf(s);
              return (
                <div
                  key={s.id}
                  className={`border-line grid min-w-[860px] grid-cols-[80px_1fr_140px_140px_100px_120px_120px] items-center gap-4 border-b px-5 py-4 text-sm last:border-0 ${
                    refunded ? 'opacity-60' : ''
                  }`}
                >
                  <div className="mono text-brand-primary">{s.time}</div>
                  <div className="text-ink-mute flex items-center gap-2 truncate">
                    <span className={refunded ? 'line-through' : ''}>
                      {s.items.map((i) => i.name).join(' + ')}
                    </span>
                    {refunded && (
                      <Tag tone="red">
                        <span className="mono text-[9px] uppercase tracking-wider">
                          {t('refundedTag')}
                        </span>
                      </Tag>
                    )}
                    {isPartial && (
                      <Tag tone="copper">
                        <span className="mono text-[9px] uppercase tracking-wider">
                          {t('partialRefundedTag', { amount: fmt(refundedCents) })}
                        </span>
                      </Tag>
                    )}
                  </div>
                  <div className={`text-ink truncate ${refunded ? 'line-through' : ''}`}>
                    {s.clientName || '—'}
                  </div>
                  <div style={{ color: b?.tone }} className={refunded ? 'line-through' : ''}>
                    {b?.name}
                  </div>
                  <div className="mono text-[10px] uppercase tracking-wider">
                    {s.method === 'card'
                      ? t('methodShortCard')
                      : s.method === 'cash'
                        ? t('methodShortCash')
                        : t('methodShortMobile')}
                  </div>
                  <div className="text-end">
                    {/* Refund partiel : on garde le total visible mais on
                        affiche le NET en dessous pour que la caissière voie
                        immédiatement combien est resté en caisse. Refund
                        total : line-through sur le total (= 0 net). */}
                    <div className={`mono font-semibold ${refunded ? 'line-through' : ''}`}>
                      {fmt(s.totalCents)}
                    </div>
                    {isPartial && (
                      <div className="mono text-brand-primary text-[10px] font-semibold">
                        = {fmt(net)}
                      </div>
                    )}
                    {(s.tipCents ?? 0) > 0 && (
                      <div className="mono text-ink-soft text-[10px]">
                        {t('tipLine', { amount: fmt(s.tipCents ?? 0) })}
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end gap-1.5">
                    {/* Bouton « Renvoyer email » — uniquement si la vente a
                        un id DB (pas un placeholder local-*) ET pas
                        actuellement en envoi. Le serveur garde rate-limit
                        (3/h par saleId) + bypass de l'idempotence
                        (forceResend=true). Audit T5.10. */}
                    {!s.id.startsWith('local-') && (
                      <button
                        type="button"
                        onClick={() => handleResendEmail(s.id)}
                        disabled={resending && resendingId === s.id}
                        title={t('resendEmailTitle')}
                        aria-label={t('resendEmailAria')}
                        className="btn-press mono border-line-hi hover:border-brand-primary hover:text-brand-primary text-ink-mute rounded-sm border px-2 py-1.5 text-[9px] uppercase tracking-wider transition-colors disabled:opacity-40"
                      >
                        {resending && resendingId === s.id ? '…' : '@'}
                      </button>
                    )}
                    {/* Bouton « Rembourser » visible tant qu'il reste quelque
                        chose à rembourser — caché uniquement quand la vente
                        est intégralement remboursée. */}
                    {!refunded && (
                      <button
                        type="button"
                        onClick={() => setRefundTarget(s)}
                        className="btn-press mono border-line-hi hover:border-red hover:text-red text-ink-mute rounded-sm border px-2 py-1.5 text-[9px] uppercase tracking-wider transition-colors"
                      >
                        {t('refundBtn')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>

      <RefundModal
        sale={refundTarget}
        onClose={() => setRefundTarget(null)}
        onRefunded={handleRefunded}
      />
    </div>
  );
}
