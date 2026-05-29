'use client';

import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Building2,
  Calendar,
  Check,
  Clock,
  ContactRound,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  History,
  Image as ImageIcon,
  KeyRound,
  Mail,
  Minus,
  Package,
  Phone,
  Plus,
  Receipt,
  Scissors,
  Settings,
  Star,
  Trash2,
  TrendingUp,
  Upload,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Btn, Card, Input, Modal, Tag } from '@/components';
import { SALON } from '@/config/salon';
import { AppHeader, type TabDef } from '../_components/AppHeader';
import { ServiceIcon } from '../_components/ServiceIcon';
import { StaffPhoto } from '../_components/StaffPhoto';
import { useTenantOrNull } from '../_components/TenantProvider';
import { useToast } from '../_components/Toast';
import {
  useActiveCashierId,
  useFmtMoney,
  useSalonProfile,
  writeActiveCashierId,
  writeSalonProfile,
} from '../_data/local-state';
import { updateSalonProfile } from './actions';
import { AuditLogModal } from './AuditLogModal';
import { CashierAccessModal } from './CashierAccessModal';
import { BirthdayWidget } from './BirthdayWidget';
import { ManagerClients } from './ManagerClients';
import { ManagerReviews } from './ManagerReviews';
import { GalleryEditor } from './GalleryEditor';
import { ProductStatsCard } from './ProductStatsCard';
import { PushNotificationsCard } from './PushNotificationsCard';
import {
  DEFAULT_WEEK_SCHEDULE,
  OpeningHoursEditor,
  generateHoursSummary,
  useDayLabels,
  parseWeekSchedule,
  type DayKey,
} from './OpeningHoursEditor';
import {
  createProduct,
  createService,
  createStaff,
  deleteProduct,
  deleteService,
  deleteStaff,
  updateProduct,
  updateService,
  updateStaff,
} from './crud-actions';
import { buildSalesCsv, downloadCsv } from './csv-export';
import { getDashboardSeries } from './dashboard-actions';
import { getManagerReservations } from './reservations-actions';
import { DayCloseModal } from './DayCloseModal';
import { usePersistedCollection, type PersistOps } from './use-persisted';
import { getBarberRatings, type BarberRating } from '../client/review-actions';
import {
  CASHIER_SHIFTS,
  INITIAL_BOOKINGS,
  INITIAL_PRODUCTS,
  INITIAL_SALES,
  INITIAL_SERVICES,
  INITIAL_STAFF,
  STAFF_TONES,
  barbersOf,
  cashiersOf,
  todayStr,
  type Barber,
  type Booking,
  type Cashier,
  type Product,
  type Sale,
  type SalonProfile,
  type Service,
  type Staff,
  type StaffRole,
} from '../_data/mock';

/** Définition des onglets manager : `key` + `icon` uniquement. Les libellés
 *  sont résolus à chaque render via `useTranslations('manager.tabs')` pour
 *  rester réactifs au changement de langue (cf. construction dans ManagerApp). */
const MANAGER_TAB_KEYS = [
  'dash',
  'team',
  'avis',
  'reserv',
  'services',
  'stock',
  'clients',
  'settings',
] as const;
const MANAGER_TAB_ICONS: Record<(typeof MANAGER_TAB_KEYS)[number], LucideIcon> = {
  dash: BarChart3,
  team: Users,
  avis: Star,
  reserv: Calendar,
  services: Scissors,
  stock: Package,
  clients: ContactRound,
  settings: Settings,
};

/**
 * Sections personnalisées stockées en localStorage.
 * Persiste même quand la section est vide (aucun membre assigné).
 * key ex: 'systema:barber-sections', 'systema:cashier-sections', 'systema:service-sections'.
 */
function useLocalSections(key: string, defaults: string[] = []) {
  const [sections, setSectionsRaw] = useState<string[]>(() => {
    if (typeof window === 'undefined') return defaults;
    try {
      const raw = localStorage.getItem(key);
      // Key absent = first use → return defaults (written to localStorage on first mutation).
      if (raw === null) return defaults;
      return JSON.parse(raw) as string[];
    } catch {
      return defaults;
    }
  });

  const setSections = (next: string[] | ((prev: string[]) => string[])) => {
    setSectionsRaw((prev) => {
      const val = typeof next === 'function' ? next(prev) : next;
      localStorage.setItem(key, JSON.stringify(val));
      return val;
    });
  };

  return [sections, setSections] as const;
}

/** Staff → StaffInput pour les Server Actions (drop id, garde le reste). */
function staffToInput(s: Staff) {
  return {
    name: s.name,
    initials: s.initials,
    tone: s.tone,
    isActive: s.isActive,
    phone: s.phone,
    email: s.email,
    photoUrl: s.photoUrl ?? null,
    roles: s.roles,
    shift: s.shift ?? null,
    commissionBp: s.commissionBp,
    category: s.category,
  };
}

const STAFF_OPS: PersistOps<Staff> = {
  create: (s) => createStaff(staffToInput(s)),
  update: (id, s) => updateStaff(id, staffToInput(s)),
  remove: (id) => deleteStaff(id),
};

const SERVICE_OPS: PersistOps<Service> = {
  create: (s) =>
    createService({
      name: s.name,
      duration: s.duration,
      priceCents: s.priceCents,
      icon: s.icon,
      desc: s.desc,
      category: s.category,
    }),
  update: (id, s) =>
    updateService(id, {
      name: s.name,
      duration: s.duration,
      priceCents: s.priceCents,
      icon: s.icon,
      desc: s.desc,
      category: s.category,
    }),
  remove: (id) => deleteService(id),
};

const PRODUCT_OPS: PersistOps<Product> = {
  create: (p) =>
    createProduct({
      name: p.name,
      sku: p.sku,
      priceCents: p.priceCents,
      costCents: p.costCents,
      stock: p.stock,
      low: p.low,
    }),
  update: (id, p) =>
    updateProduct(id, {
      name: p.name,
      sku: p.sku,
      priceCents: p.priceCents,
      costCents: p.costCents,
      stock: p.stock,
      low: p.low,
    }),
  remove: (id) => deleteProduct(id),
};

export default function ManagerPage() {
  const tenantSession = useTenantOrNull();
  const isRealTenant = tenantSession !== null;
  const router = useRouter();
  const [tab, setTab] = useState('dash');
  const toast = useToast();
  const tTabs = useTranslations('manager.tabs');
  const tCommon = useTranslations('manager.common');
  const tManagerErrors = useTranslations('manager.errors');
  // Construction des onglets à chaque render — libellés traduits, icônes fixes.
  const tabs: TabDef[] = MANAGER_TAB_KEYS.map((k) => ({
    key: k,
    label: tTabs(k),
    icon: MANAGER_TAB_ICONS[k],
  }));

  // Bridge entre la signature i18n-friendly de usePersistedCollection et l'API
  // string-only de toast.error. Le hook reçoit (errorKey, errorValues) — on
  // résout via le catalogue puis on déclenche le toast.
  const handlePersistError = (
    errorKey: string,
    errorValues: Record<string, string | number> | undefined,
  ) => {
    // Le cast type-loose est nécessaire car next-intl exige une clé littérale.
    toast.error(tManagerErrors(errorKey as 'dbError', errorValues));
  };

  // Source initiale : DB (tenant réel) ou mocks Maison Lefèvre (démo publique).
  // usePersistedCollection persiste chaque mutation via Server Actions quand
  // isRealTenant ; en démo c'est un useState pur.
  const initialStaff = isRealTenant ? tenantSession.collections.staff : INITIAL_STAFF;
  const initialServices = isRealTenant ? tenantSession.collections.services : INITIAL_SERVICES;
  const initialProducts = isRealTenant ? tenantSession.collections.products : INITIAL_PRODUCTS;

  const [staff, setStaff] = usePersistedCollection(
    initialStaff,
    isRealTenant,
    STAFF_OPS,
    handlePersistError,
    // Après une création côté serveur, rafraîchir pour remplacer les IDs
    // temporaires (fake) par les vrais UUIDs Supabase. Indispensable pour
    // que les actions suivantes (ex. createCashierAccess) reçoivent un vrai
    // UUID — la validation z.string().uuid() rejette 'st-1234567890'.
    isRealTenant ? () => router.refresh() : undefined,
  );
  const [services, setServices] = usePersistedCollection(
    initialServices,
    isRealTenant,
    SERVICE_OPS,
    handlePersistError,
  );
  const [products, setProducts] = usePersistedCollection(
    initialProducts,
    isRealTenant,
    PRODUCT_OPS,
    handlePersistError,
  );
  const [bookings, setBookings] = useState<Booking[]>(isRealTenant ? [] : INITIAL_BOOKINGS);
  const [sales] = useState<Sale[]>(isRealTenant ? [] : INITIAL_SALES);

  // Charge les réservations réelles du tenant (onglet Réservations).
  // Avant ce chargement le tableau restait vide pour tout vrai salon —
  // l'onglet apparaissait désespérément désert. Cf. reservations-actions.ts.
  const reservationsTenantId = isRealTenant ? (tenantSession?.tenant.id ?? null) : null;
  useEffect(() => {
    if (!reservationsTenantId) return;
    void getManagerReservations(reservationsTenantId).then((r) => {
      if (r.ok) setBookings(r.bookings);
    });
  }, [reservationsTenantId]);

  const barbers = barbersOf(staff);

  return (
    <main className="min-h-screen">
      <AppHeader
        role="manager"
        name={
          tenantSession
            ? (tenantSession.user?.email ?? tCommon('fallbackManagerName'))
            : tCommon('demoOwnerName')
        }
        tabs={tabs}
        active={tab}
        setActive={setTab}
      />
      {tab === 'dash' && (
        <ManagerDashboard
          services={services}
          products={products}
          barbers={barbers}
          bookings={bookings}
          sales={sales}
          isRealTenant={isRealTenant}
          onJumpToClients={() => setTab('clients')}
        />
      )}
      {tab === 'team' && (
        <ManagerTeam staff={staff} setStaff={setStaff} isRealTenant={isRealTenant} />
      )}
      {tab === 'avis' && <ManagerReviews barbers={barbers} />}
      {tab === 'reserv' && (
        <ManagerReservations services={services} barbers={barbers} bookings={bookings} />
      )}
      {tab === 'services' && <ManagerServices services={services} setServices={setServices} />}
      {tab === 'stock' && <ManagerStock products={products} setProducts={setProducts} />}
      {tab === 'clients' && <ManagerClients />}
      {tab === 'settings' && <ManagerSettings />}
    </main>
  );
}

// =============================================================================
// Dashboard
// =============================================================================
interface DashProps {
  services: Service[];
  products: Product[];
  barbers: Barber[];
  bookings: Booking[];
  sales: Sale[];
  /** Tenant réel (DB) → charge les séries via Server Action ; démo → props. */
  isRealTenant: boolean;
  /** Bascule l'onglet Direction vers Clients (utilisé par le widget Anniversaires). */
  onJumpToClients: () => void;
}

/** Période de pilotage du tableau de bord. */
type DashPeriod = 'day' | 'week' | 'month';

/** Mapping clé → durée. Le libellé est résolu via `useTranslations('manager.dashboard.period')`
 *  côté `PeriodToggle` pour rester réactif au changement de langue. */
const PERIOD_DAYS: Record<DashPeriod, number> = {
  day: 1,
  week: 7,
  month: 30,
};
const PERIOD_KEYS: readonly DashPeriod[] = ['day', 'week', 'month'];

/** Libellé court du jour de la semaine pour un index getDay(). */
/** Mapping JS-day-index (0=Dim, 1=Lun, ..., 6=Sam) → clé `days.short.*` du
 *  catalogue i18n. Plus de label en dur — le composant ManagerDashboard
 *  résout chaque short via `useTranslations('days.short')`. */
const DOW_KEYS: readonly DayKey[] = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];

/** Date ISO `YYYY-MM-DD` à `offset` jours d'aujourd'hui (négatif = passé). */
function isoDayOffset(offset: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
  return d.toISOString().split('T')[0]!;
}

/**
 * Liste ordonnée des dates ISO d'une fenêtre de `length` jours se terminant
 * `endOffset` jours après aujourd'hui (0 = se termine aujourd'hui).
 */
function dayRange(length: number, endOffset: number): string[] {
  return Array.from({ length }).map((_, i) => isoDayOffset(endOffset - (length - 1) + i));
}

/** Indicateurs agrégés d'une période (déjà filtrée). */
interface PeriodStats {
  revenue: number;
  bookingCount: number;
  occupancy: number;
  avgTicket: number;
  withRdv: number;
  walkIns: number;
}

/**
 * Calcule les 6 KPI sur un sous-ensemble de RDV / ventes.
 * `dayCount` = nb de jours de la période (pour borner l'occupation).
 */
function computeStats(
  periodBookings: Booking[],
  periodSales: Sale[],
  barberCount: number,
  dayCount: number,
): PeriodStats {
  const active = periodBookings.filter((b) => b.status !== 'cancelled');
  // Les ventes intégralement remboursées sortent du CA, du ticket moyen et
  // du nombre de ventes — la caisse n'a rien encaissé in fine. Les ventes
  // partiellement remboursées restent comptées comme UNE vente mais leur
  // contribution au CA est limitée au net (total − refunded_cents).
  const completed = periodSales.filter((s) => !s.refunded);
  const revenue = completed.reduce(
    (s, x) => s + Math.max(0, x.totalCents - (x.refundedCents ?? 0)),
    0,
  );
  const capacity = barberCount * 8 * Math.max(1, dayCount);
  return {
    revenue,
    bookingCount: active.length,
    occupancy: barberCount > 0 ? Math.min(100, Math.round((active.length / capacity) * 100)) : 0,
    avgTicket: completed.length ? Math.round(revenue / completed.length) : 0,
    withRdv: active.length,
    walkIns: Math.max(0, completed.length - active.filter((b) => b.status === 'done').length),
  };
}

/**
 * Variation en % entre `current` et `previous`.
 * `null` quand la base précédente est 0 (pas de comparaison sensée).
 */
function trendPct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Squelette de chargement du tableau de bord — affiché le temps de charger les séries. */
function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-10 md:px-10">
      <div className="mb-8 space-y-3">
        <div className="border-line bg-surface h-5 w-44 animate-pulse rounded-sm border" />
        <div className="border-line bg-surface h-11 w-80 max-w-full animate-pulse rounded-sm border" />
      </div>
      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="border-line bg-surface h-36 animate-pulse rounded-sm border" />
        ))}
      </div>
      <div className="mb-8 grid gap-3 lg:grid-cols-[2fr_1fr]">
        <div className="border-line bg-surface h-64 animate-pulse rounded-sm border" />
        <div className="border-line bg-surface h-64 animate-pulse rounded-sm border" />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="border-line bg-surface h-48 animate-pulse rounded-sm border" />
        <div className="border-line bg-surface h-48 animate-pulse rounded-sm border" />
      </div>
    </div>
  );
}

function ManagerDashboard({
  services,
  products,
  barbers,
  bookings: propBookings,
  sales: propSales,
  isRealTenant,
  onJumpToClients,
}: DashProps) {
  const t = useTranslations('manager.dashboard');
  const tDayShort = useTranslations('days.short');
  const locale = useLocale();
  const fmt = useFmtMoney();
  const tenantSession = useTenantOrNull();
  const localProfile = useSalonProfile();
  const tenantId = tenantSession?.tenant.id;
  // Nom affiché : responsable (legal_name) si renseigné, sinon l'établissement.
  const managerName = tenantSession
    ? tenantSession.settings.legal_name?.trim() || tenantSession.tenant.name
    : localProfile.managerName.trim() || localProfile.name;

  // Période sélectionnée — défaut « Jour » (comportement historique).
  const [period, setPeriod] = useState<DashPeriod>('day');
  const [dayCloseOpen, setDayCloseOpen] = useState(false);

  // Séries chargées depuis la DB (tenant réel) ou les mocks (démo publique).
  // On charge large (60 j) une seule fois ; le changement de période ne
  // déclenche aucun aller-retour réseau, juste un recalcul client.
  const [series, setSeries] = useState<{ bookings: Booking[]; sales: Sale[] }>({
    bookings: propBookings,
    sales: propSales,
  });
  const [loadingSeries, setLoadingSeries] = useState(isRealTenant);
  const [, startSeriesLoad] = useTransition();

  // Notes moyennes par barbier — alimentent la carte « Performance de l'équipe ».
  const [ratings, setRatings] = useState<Map<string, BarberRating>>(new Map());

  useEffect(() => {
    if (!isRealTenant || !tenantId) return;
    setLoadingSeries(true);
    startSeriesLoad(async () => {
      const res = await getDashboardSeries(tenantId);
      if (res.ok) setSeries(res.series);
      setLoadingSeries(false);
    });
  }, [isRealTenant, tenantId, startSeriesLoad]);

  useEffect(() => {
    if (!isRealTenant || !tenantId) return;
    getBarberRatings(tenantId)
      .then((r) => {
        if (r.ok) setRatings(new Map(r.ratings.map((x) => [x.barberId, x])));
      })
      .catch(() => {});
  }, [isRealTenant, tenantId]);

  const { bookings, sales } = series;

  // ── Découpage des fenêtres temporelles ───────────────────────────────────
  const days = PERIOD_DAYS[period];
  // Période courante : `days` jours se terminant aujourd'hui.
  const currentDays = useMemo(() => dayRange(days, 0), [days]);
  // Période précédente : `days` jours se terminant juste avant la courante.
  const previousDays = useMemo(() => dayRange(days, -days), [days]);
  const currentSet = useMemo(() => new Set(currentDays), [currentDays]);
  const previousSet = useMemo(() => new Set(previousDays), [previousDays]);

  const currentBookings = useMemo(
    () => bookings.filter((b) => currentSet.has(b.date)),
    [bookings, currentSet],
  );
  const currentSales = useMemo(
    () => sales.filter((s) => currentSet.has(s.date)),
    [sales, currentSet],
  );
  const previousBookings = useMemo(
    () => bookings.filter((b) => previousSet.has(b.date)),
    [bookings, previousSet],
  );
  const previousSales = useMemo(
    () => sales.filter((s) => previousSet.has(s.date)),
    [sales, previousSet],
  );

  const stats = useMemo(
    () => computeStats(currentBookings, currentSales, barbers.length, days),
    [currentBookings, currentSales, barbers.length, days],
  );
  const prevStats = useMemo(
    () => computeStats(previousBookings, previousSales, barbers.length, days),
    [previousBookings, previousSales, barbers.length, days],
  );

  // ── Sparklines : la métrique répartie sur ~7 segments de la période ──────
  // Pour « Jour » chaque point = 1 jour des 7 derniers ; pour « Semaine » /
  // « Mois » on regroupe les jours en 7 buckets (semaines ou ~4 j).
  const sparkBuckets = useMemo(() => {
    const points = 7;
    // Fenêtre de référence pour les sparklines : on prend les `days * points`
    // derniers jours quand pertinent, sinon 7 jours.
    const span = period === 'day' ? 7 : days * points;
    const allDays = dayRange(Math.min(span, 60), 0);
    const size = Math.ceil(allDays.length / points);
    const buckets: string[][] = [];
    for (let i = 0; i < allDays.length; i += size) {
      buckets.push(allDays.slice(i, i + size));
    }
    return buckets.slice(-points);
  }, [period, days]);

  const sparkFor = useMemo(() => {
    return (metric: (b: Booking[], s: Sale[]) => number): number[] =>
      sparkBuckets.map((bucket) => {
        const set = new Set(bucket);
        return metric(
          bookings.filter((b) => set.has(b.date) && b.status !== 'cancelled'),
          // Sparklines : on exclut les ventes remboursées pour rester
          // cohérent avec les KPIs computeStats.
          sales.filter((s) => set.has(s.date) && !s.refunded),
        );
      });
  }, [sparkBuckets, bookings, sales]);

  const sparkRevenue = useMemo(
    () =>
      sparkFor((_, s) =>
        s.reduce((acc, x) => acc + Math.max(0, x.totalCents - (x.refundedCents ?? 0)), 0),
      ),
    [sparkFor],
  );
  const sparkBookings = useMemo(() => sparkFor((b) => b.length), [sparkFor]);
  const sparkOccupancy = useMemo(
    () =>
      sparkFor((b) =>
        barbers.length > 0 ? Math.min(100, Math.round((b.length / (barbers.length * 8)) * 100)) : 0,
      ),
    [sparkFor, barbers.length],
  );
  const sparkTicket = useMemo(
    () =>
      sparkFor((_, s) =>
        s.length
          ? Math.round(
              s.reduce((acc, x) => acc + Math.max(0, x.totalCents - (x.refundedCents ?? 0)), 0) /
                s.length,
            )
          : 0,
      ),
    [sparkFor],
  );
  const sparkWalkIns = useMemo(
    () => sparkFor((b, s) => Math.max(0, s.length - b.filter((x) => x.status === 'done').length)),
    [sparkFor],
  );

  // ── Données dérivées (équipe, stock, RDV à venir) ────────────────────────
  const lowStock = products.filter((p) => p.stock <= p.low);
  const rdvDone = currentBookings.filter(
    (b) => b.status === 'done' || b.status === 'in-chair',
  ).length;
  const rdvUpcoming = currentBookings.filter((b) => b.status === 'upcoming').length;

  // Graphe « Chiffre 7 derniers jours » — toujours les 7 derniers jours réels.
  // BCP47 dérivé de la locale courante pour formater la date longue dans la
  // langue active (fr-FR / en-US / ar-EG).
  const bcp47 = locale === 'ar' ? 'ar-EG' : locale === 'en' ? 'en-US' : 'fr-FR';
  const week = useMemo(
    () =>
      dayRange(7, 0).map((iso) => {
        const d = new Date(`${iso}T00:00:00.000Z`);
        return {
          iso,
          dow: tDayShort(DOW_KEYS[d.getUTCDay()]!),
          label: d.toLocaleDateString(bcp47, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            timeZone: 'UTC',
          }),
          r: sales
            .filter((s) => s.date === iso && !s.refunded)
            .reduce((acc, x) => acc + Math.max(0, x.totalCents - (x.refundedCents ?? 0)), 0),
        };
      }),
    [sales, tDayShort, bcp47],
  );
  const maxR = Math.max(1, ...week.map((w) => w.r));

  // Performance par barbier sur la période — CA, RDV, note, occupation —
  // classée par chiffre décroissant (meilleur vendeur en tête).
  const byBarber = barbers
    .map((b) => {
      const rdv = currentBookings.filter(
        (x) => x.barberId === b.id && x.status !== 'cancelled',
      ).length;
      // Performance barbier : on exclut les ventes intégralement remboursées
      // du CA attribué (l'argent n'a finalement pas été perçu) ; pour les
      // refunds partiels on attribue le NET (total − refunded_cents).
      const rev = currentSales
        .filter((x) => x.barberId === b.id && !x.refunded)
        .reduce((s, x) => s + Math.max(0, x.totalCents - (x.refundedCents ?? 0)), 0);
      const r = ratings.get(b.id);
      return {
        ...b,
        rdv,
        rev,
        rating: r?.avg ?? 0,
        reviewCount: r?.count ?? 0,
        // Occupation : RDV rapportés à ~8 créneaux/jour sur la période.
        occupancy: Math.min(100, Math.round((rdv / Math.max(1, days * 8)) * 100)),
      };
    })
    .sort((a, b) => b.rev - a.rev);

  // Prochains RDV : toujours ceux du jour (utile quelle que soit la période).
  const todayIso = todayStr();
  const todaysUpcoming = useMemo(
    () => bookings.filter((b) => b.date === todayIso && b.status === 'upcoming'),
    [bookings, todayIso],
  );

  // Libellés contextuels selon la période.
  const periodWord =
    period === 'day' ? t('period.day') : period === 'week' ? t('period.week') : t('period.month');
  const trendLabel =
    period === 'day'
      ? t('period.trendDay')
      : period === 'week'
        ? t('period.trendWeek')
        : t('period.trendMonth');

  // Export CSV des ventes de la période sélectionnée. Headers traduits via
  // l'espace de noms manager.dayClose qui détient déjà les libellés CSV
  // (réutilisation, pas de doublon). Audit T5.7.
  const barberNameById = (id: string) => barbers.find((b) => b.id === id)?.name ?? '—';
  const exportCurrentCsv = () => {
    downloadCsv(
      `ventes-${period}-${todayIso}.csv`,
      buildSalesCsv(currentSales, barberNameById, {
        date: t('csv.date'),
        time: t('csv.time'),
        barber: t('csv.barber'),
        method: t('csv.method'),
        items: t('csv.items'),
        total: t('csv.total'),
        refunded: t('csv.refunded'),
        net: t('csv.net'),
        methodCard: t('csv.methodCard'),
        methodCash: t('csv.methodCash'),
        methodMobile: t('csv.methodMobile'),
      }),
    );
  };

  if (loadingSeries) return <DashboardSkeleton />;

  return (
    <div className="mx-auto max-w-7xl px-6 py-10 md:px-10">
      {isRealTenant && bookings.length === 0 && sales.length === 0 && (
        <div className="border-brand-primary/20 bg-brand-primary/6 mb-6 flex items-start gap-3 rounded-sm border px-4 py-3">
          <BarChart3
            className="text-brand-primary mt-0.5 h-4 w-4 flex-shrink-0"
            strokeWidth={1.5}
          />
          <div>
            <p className="text-ink text-sm font-semibold">{t('emptyStateTitle')}</p>
            <p className="text-ink-mute mt-0.5 text-xs">{t('emptyStateSubtitle')}</p>
          </div>
        </div>
      )}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Tag tone="copper">
            {t('eyebrow')} ·{' '}
            {new Date().toLocaleDateString(bcp47, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </Tag>
          <h2 className="display mt-3 text-4xl md:text-5xl">
            {t.rich('greeting', {
              name: managerName,
              accent: (chunks) => <span className="display-i text-brand-glow">{chunks}</span>,
            })}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {lowStock.length > 0 && (
            <div className="border-red/30 bg-red/10 text-red flex items-center gap-2 rounded-sm border px-4 py-2 text-sm">
              <AlertTriangle className="animate-pulse-soft h-4 w-4" />{' '}
              {lowStock.length > 1
                ? t('lowStockBadgePlural', { count: lowStock.length })
                : t('lowStockBadge', { count: lowStock.length })}
            </div>
          )}
          <button
            type="button"
            onClick={exportCurrentCsv}
            className="btn-press mono border-line-hi hover:border-brand-primary text-ink-mute hover:text-ink flex items-center gap-1.5 rounded-sm border px-3 py-2 text-[10px] uppercase tracking-wider"
          >
            <Download className="h-3 w-3" strokeWidth={1.5} />
            {t('exportBtn')}
          </button>
          <button
            type="button"
            onClick={() => setDayCloseOpen(true)}
            className="btn-press mono border-line-hi hover:border-brand-primary text-ink-mute hover:text-ink flex items-center gap-1.5 rounded-sm border px-3 py-2 text-[10px] uppercase tracking-wider"
          >
            <Receipt className="h-3 w-3" strokeWidth={1.5} />
            {t('dayCloseBtn')}
          </button>
          <PeriodToggle value={period} onChange={setPeriod} />
        </div>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KPI
          label={t('kpis.revenue', { period: periodWord })}
          value={fmt(stats.revenue)}
          delta={loadingSeries ? t('kpis.loading') : trendLabel}
          trend={trendPct(stats.revenue, prevStats.revenue)}
          spark={sparkRevenue}
          big
        />
        <KPI
          label={t('kpis.bookings', { period: periodWord })}
          value={stats.bookingCount.toString()}
          delta={t('kpis.bookingsPaid', { count: currentBookings.filter((b) => b.paid).length })}
          trend={trendPct(stats.bookingCount, prevStats.bookingCount)}
          spark={sparkBookings}
        />
        <KPI
          label={t('kpis.occupancy')}
          value={`${stats.occupancy}%`}
          delta={
            barbers.length > 1
              ? t('kpis.activeBarbersPlural', { count: barbers.length })
              : t('kpis.activeBarbers', { count: barbers.length })
          }
          trend={trendPct(stats.occupancy, prevStats.occupancy)}
          spark={sparkOccupancy}
        />
        <KPI
          label={t('kpis.avgTicket')}
          value={fmt(stats.avgTicket)}
          delta={t('kpis.avgTicketDelta')}
          trend={trendPct(stats.avgTicket, prevStats.avgTicket)}
          spark={sparkTicket}
        />
        <KPI
          label={t('kpis.withRdvLabel')}
          value={stats.withRdv.toString()}
          delta={
            rdvDone > 0
              ? rdvDone > 1
                ? t('kpis.withRdvDeltaMixedPlural', { arrived: rdvDone, upcoming: rdvUpcoming })
                : t('kpis.withRdvDeltaMixed', { arrived: rdvDone, upcoming: rdvUpcoming })
              : rdvUpcoming > 1
                ? t('kpis.withRdvDeltaExpectedPlural', { count: rdvUpcoming })
                : t('kpis.withRdvDeltaExpected', { count: rdvUpcoming })
          }
          trend={trendPct(stats.withRdv, prevStats.withRdv)}
          spark={sparkBookings}
        />
        <KPI
          label={t('kpis.withoutRdvLabel')}
          value={stats.walkIns.toString()}
          delta={
            stats.walkIns === 0
              ? t('kpis.withoutRdvDeltaZero')
              : stats.walkIns > 1
                ? t('kpis.withoutRdvDeltaPlural')
                : t('kpis.withoutRdvDelta')
          }
          trend={trendPct(stats.walkIns, prevStats.walkIns)}
          spark={sparkWalkIns}
        />
      </div>

      <div className="mb-8 grid gap-3 lg:grid-cols-[2fr_1fr]">
        <Card className="p-6">
          <div className="mb-6 flex items-baseline justify-between">
            <h3 className="display text-2xl">{t('weekChartTitle')}</h3>
          </div>
          <RevenueBarChart week={week} maxR={maxR} fmt={fmt} />
        </Card>
        <Card className="p-6">
          <h3 className="display text-2xl">{t('teamPerf.title')}</h3>
          <p className="text-ink-mute mb-5 mt-1 text-xs">
            {period === 'day'
              ? t('teamPerf.subtitleDay')
              : period === 'week'
                ? t('teamPerf.subtitleWeek')
                : t('teamPerf.subtitleMonth')}
          </p>
          <div className="space-y-4">
            {byBarber.length === 0 && (
              <div className="text-ink-mute py-4 text-center text-sm">{t('teamPerf.empty')}</div>
            )}
            {byBarber.map((b, i) => (
              <div key={b.id}>
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="mono text-ink-soft w-3 shrink-0 text-[10px]">{i + 1}</span>
                    <div
                      className="display flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs"
                      style={{
                        background: `${b.tone}25`,
                        color: b.tone,
                        border: `1px solid ${b.tone}50`,
                      }}
                    >
                      {b.initials}
                    </div>
                    <span className="truncate text-sm font-semibold">{b.name}</span>
                  </div>
                  <span className="mono text-brand-primary shrink-0 text-sm">{fmt(b.rev)}</span>
                </div>
                <div className="bg-surface-elev ms-8 h-1.5 overflow-hidden rounded-full">
                  <div
                    className="h-full transition-all"
                    style={{ width: `${b.occupancy}%`, background: b.tone }}
                  />
                </div>
                <div className="mono text-ink-soft ms-8 mt-1.5 flex items-center gap-3 text-[10px] uppercase tracking-wider">
                  <span>{t('teamRow.rdv', { count: b.rdv })}</span>
                  <span className="flex items-center gap-0.5">
                    <Star
                      className={`h-2.5 w-2.5 fill-current ${
                        b.reviewCount > 0 ? 'text-brand-primary' : 'text-ink-soft'
                      }`}
                      strokeWidth={0}
                    />
                    {b.reviewCount > 0 ? b.rating.toFixed(1) : '—'}
                  </span>
                  <span>{t('teamRow.occupancy', { percent: b.occupancy })}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="p-6">
          <h3 className="display mb-4 text-2xl">{t('todaysUpcoming.title')}</h3>
          <div className="space-y-2">
            {todaysUpcoming.slice(0, 4).map((b) => {
              const s = services.find((x) => x.id === b.serviceId);
              const ba = barbers.find((x) => x.id === b.barberId);
              return (
                <div
                  key={b.id}
                  className="border-line flex items-center gap-3 border-b py-2 last:border-0"
                >
                  <span className="mono text-brand-primary w-12 text-sm">{b.time}</span>
                  <span className="flex-1 text-sm font-semibold">{b.clientName}</span>
                  <span className="text-ink-mute text-xs">{s?.name}</span>
                  <span className="text-xs" style={{ color: ba?.tone }}>
                    · {ba?.name}
                  </span>
                </div>
              );
            })}
            {todaysUpcoming.length === 0 && (
              <div className="text-ink-mute py-4 text-center text-sm">
                {t('todaysUpcoming.empty')}
              </div>
            )}
          </div>
        </Card>
        <Card className="p-6">
          <h3 className="display mb-4 text-2xl">{t('stockAlerts.title')}</h3>
          {lowStock.length === 0 ? (
            <div className="text-green flex items-center gap-2 py-4 text-sm">
              <Check className="h-4 w-4" /> {t('stockAlerts.allOk')}
            </div>
          ) : (
            <div className="space-y-2">
              {lowStock.map((p) => (
                <div
                  key={p.id}
                  className="border-line flex items-center justify-between border-b py-2 last:border-0"
                >
                  <div>
                    <div className="text-sm font-semibold">{p.name}</div>
                    <div className="mono text-ink-soft text-[10px] uppercase tracking-wider">
                      {p.sku}
                    </div>
                  </div>
                  <Tag tone="red">
                    {p.stock > 1
                      ? t('stockAlerts.remainingMany', { count: p.stock })
                      : t('stockAlerts.remainingOne', { count: p.stock })}
                  </Tag>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Widget anniversaires — n'apparaît que s'il y a au moins un client
          qui fête son anniversaire ce mois (sinon le composant rend null). */}
      <div className="mt-3">
        <BirthdayWidget onViewAll={onJumpToClients} />
      </div>

      <DayCloseModal
        open={dayCloseOpen}
        onClose={() => setDayCloseOpen(false)}
        sales={sales}
        bookings={bookings}
        barbers={barbers}
        fmt={fmt}
        dateIso={todayIso}
      />
    </div>
  );
}

// =============================================================================
// Dashboard — sous-composants
// =============================================================================

/** Bascule segmentée Jour / Semaine / Mois (près du titre du tableau de bord). */
function PeriodToggle({
  value,
  onChange,
}: {
  value: DashPeriod;
  onChange: (p: DashPeriod) => void;
}) {
  const t = useTranslations('manager.dashboard.period');
  return (
    <div className="border-line bg-surface inline-flex rounded-sm border p-0.5">
      {PERIOD_KEYS.map((p) => {
        const isActive = p === value;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            aria-pressed={isActive}
            className={`mono rounded-[3px] px-3 py-1.5 text-[10px] uppercase tracking-wider transition-colors ${
              isActive ? 'bg-brand-primary text-white' : 'text-ink-mute hover:text-ink'
            }`}
          >
            {t(p)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Badge de tendance d'un KPI : compare la période courante à la précédente.
 * `pct` à `null` = pas de base de comparaison → état neutre « — ».
 */
function TrendBadge({ pct }: { pct: number | null }) {
  if (pct === null || pct === 0) {
    return (
      <span className="text-ink-soft mono inline-flex items-center gap-0.5 text-[10px] font-semibold">
        <Minus className="h-3 w-3" strokeWidth={2.5} />
        {pct === 0 ? '0 %' : '—'}
      </span>
    );
  }
  const up = pct > 0;
  return (
    <span
      className={`mono inline-flex items-center gap-0.5 text-[10px] font-semibold ${
        up ? 'text-green' : 'text-red'
      }`}
    >
      {up ? (
        <ArrowUpRight className="h-3 w-3" strokeWidth={2.5} />
      ) : (
        <ArrowDownRight className="h-3 w-3" strokeWidth={2.5} />
      )}
      {up ? '+' : '−'}
      {Math.abs(pct)} %
    </span>
  );
}

/**
 * Mini-graphe d'évolution d'une métrique (~7 points), tracé en SVG inline.
 * Aucune librairie : un simple `<polyline>` + une zone de remplissage légère.
 */
function Sparkline({ points }: { points: number[] }) {
  const w = 100;
  const h = 28;
  const pad = 2;
  if (points.length < 2) {
    return <div className="h-7" aria-hidden />;
  }
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const step = (w - pad * 2) / (points.length - 1);
  const coords = points.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (h - pad * 2) * (1 - (v - min) / span);
    return [x, y] as const;
  });
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${pad},${h - pad} ${line} ${(w - pad).toFixed(1)},${h - pad}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-7 w-full" aria-hidden>
      <polygon points={area} fill="var(--color-brand-primary)" opacity={0.1} />
      <polyline
        points={line}
        fill="none"
        stroke="var(--color-brand-primary)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

interface KPIProps {
  label: string;
  value: string;
  delta: string;
  /** Variation vs période précédente, en % (null = pas de comparaison). */
  trend?: number | null;
  /** Série ~7 points pour la sparkline. */
  spark?: number[];
  big?: boolean;
}

function KPI({ label, value, delta, trend, spark, big }: KPIProps) {
  return (
    <Card className="relative overflow-hidden p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="mono text-ink-soft text-[9px] uppercase tracking-[0.25em]">{label}</div>
        {trend !== undefined && <TrendBadge pct={trend} />}
      </div>
      <div className={`display text-ink mono leading-none ${big ? 'text-4xl' : 'text-3xl'}`}>
        {value}
      </div>
      {spark && spark.length > 1 && (
        <div className="mt-3">
          <Sparkline points={spark} />
        </div>
      )}
      <div className="mono text-brand-primary mt-2 text-[10px] uppercase tracking-wider">
        {delta}
      </div>
      {big && !spark && (
        <TrendingUp
          className="text-brand-primary absolute bottom-3 end-3 h-5 w-5 opacity-50"
          strokeWidth={1.5}
        />
      )}
    </Card>
  );
}

/** Une barre du graphe « Chiffre 7 derniers jours ». */
interface WeekBar {
  iso: string;
  dow: string;
  label: string;
  r: number;
}

/**
 * Graphe en barres du chiffre des 7 derniers jours.
 * Survol d'une barre → infobulle CSS/React avec le montant exact + le jour.
 */
function RevenueBarChart({
  week,
  maxR,
  fmt,
}: {
  week: WeekBar[];
  maxR: number;
  fmt: (cents: number) => string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <div className="flex h-48 items-end gap-2">
      {week.map((w, i) => (
        <div
          key={w.iso}
          className="group relative flex flex-1 cursor-default flex-col items-center gap-2"
          onMouseEnter={() => setHovered(i)}
          onMouseLeave={() => setHovered((c) => (c === i ? null : c))}
        >
          {/* Infobulle — montant exact + jour, au survol de la barre. */}
          {hovered === i && (
            <div className="pointer-events-none absolute -top-2 start-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap">
              <div className="border-line bg-surface-elev text-ink rounded-sm border px-3 py-1.5 text-center shadow-lg">
                <div className="mono text-brand-primary text-sm font-semibold">{fmt(w.r)}</div>
                <div className="text-ink-mute text-[10px] capitalize">{w.label}</div>
              </div>
              <div className="border-line bg-surface-elev mx-auto -mt-[5px] h-2 w-2 rotate-45 border-b border-e" />
            </div>
          )}
          <div className="mono text-ink-mute text-xs">{Math.round(w.r / 100)} €</div>
          <div
            className="bg-surface-elev relative w-full overflow-hidden rounded-sm transition-all"
            style={{ height: `${(w.r / maxR) * 100}%`, minHeight: 8 }}
          >
            <div
              className="from-brand-deep to-brand-primary absolute inset-0 bg-gradient-to-t transition-opacity"
              style={{ opacity: hovered === i ? 1 : i === 6 ? 0.95 : 0.7 }}
            />
          </div>
          <div className="mono text-ink-soft text-[10px] uppercase tracking-wider">{w.dow}</div>
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// Équipe — 2 sections : Barbiers + Caissier(ère)s
// =============================================================================
interface TeamProps {
  /** Liste unifiée des membres du salon — un humain = un Staff. Cf. D-021. */
  staff: Staff[];
  setStaff: (next: Staff[] | ((prev: Staff[]) => Staff[])) => void;
  /** Tenant réel (DB) vs démo publique — pilote l'affichage des accès Caisse. */
  isRealTenant: boolean;
}

function ManagerTeam({ staff, setStaff, isRealTenant }: TeamProps) {
  const t = useTranslations('manager.team');
  const activeCashierId = useActiveCashierId();
  const designateCashier = (id: string | null) => writeActiveCashierId(id);

  // Sections personnalisées top-level (aucune valeur par défaut — l'utilisateur crée les siennes).
  const [customSections, setCustomSections] = useLocalSections('systema:team-sections');
  const [creatingSection, setCreatingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');

  const addSection = () => {
    const name = newSectionName.trim();
    if (!name || customSections.includes(name)) return;
    setCustomSections((prev) => [...prev, name]);
    setNewSectionName('');
    setCreatingSection(false);
  };

  const deleteCustomSection = (name: string) => {
    setCustomSections((prev) => prev.filter((s) => s !== name));
    setStaff((prev) =>
      prev.map((s) => (s.category?.trim() === name ? { ...s, category: undefined } : s)),
    );
  };

  // Membres appartenant à une section personnalisée — exclus des sections structurelles.
  const inCustom = useMemo(
    () =>
      new Set(
        staff.filter((s) => s.category && customSections.includes(s.category)).map((s) => s.id),
      ),
    [staff, customSections],
  );
  const staffForStructural = useMemo(
    () => staff.filter((s) => !inCustom.has(s.id)),
    [staff, inCustom],
  );

  // Dérivés depuis staffForStructural uniquement.
  const barbers = barbersOf(staffForStructural);
  const cashiers = cashiersOf(staffForStructural);
  const activeBarbers = barbers.filter((b) => b.isActive);
  const inactiveBarbers = barbers.filter((b) => !b.isActive);
  const activeCashiers = cashiers.filter((c) => c.isActive);
  const inactiveCashiers = cashiers.filter((c) => !c.isActive);
  const activeCashier = activeCashiers.find((c) => c.id === activeCashierId);

  return (
    <div className="mx-auto max-w-7xl px-6 py-10 md:px-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Tag tone="copper">{t('eyebrow')}</Tag>
          <h2 className="display mt-3 text-4xl">{t('title')}</h2>
          <p className="text-ink-mute mt-2 text-sm">
            {activeBarbers.length > 1
              ? t('headerCountsBarberMany', { count: activeBarbers.length })
              : t('headerCountsBarberOne', { count: activeBarbers.length })}
            {' · '}
            {activeCashiers.length > 1
              ? t('headerCountsCashierMany', { count: activeCashiers.length })
              : t('headerCountsCashierOne', { count: activeCashiers.length })}
            {inactiveBarbers.length + inactiveCashiers.length > 0 && (
              <>
                {' '}
                {t('headerCountsPaused', {
                  count: inactiveBarbers.length + inactiveCashiers.length,
                })}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {creatingSection ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={newSectionName}
                onChange={(e) => setNewSectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addSection();
                  if (e.key === 'Escape') {
                    setCreatingSection(false);
                    setNewSectionName('');
                  }
                }}
                placeholder={t('sectionNamePlaceholder')}
                className="border-line focus:border-brand-primary bg-bg w-44 rounded-sm border px-3 py-2 text-sm outline-none"
              />
              <Btn onClick={addSection}>{t('createSectionBtn')}</Btn>
              <button
                type="button"
                onClick={() => {
                  setCreatingSection(false);
                  setNewSectionName('');
                }}
                className="btn-press text-ink-mute hover:text-ink p-1 text-lg leading-none"
                aria-label={t('cancelSectionAria')}
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreatingSection(true)}
              className="btn-press mono border-line hover:border-brand-primary hover:text-brand-primary text-ink-mute rounded-sm border px-3 py-2 text-[10px] uppercase tracking-wider"
            >
              {t('addSectionBtn')}
            </button>
          )}
        </div>
      </div>

      {/* Bandeau « caissier du jour » — concept démo (localStorage). Masqué
          pour un tenant réel : la caisse affiche le caissier connecté, et
          l'accès se gère par fiche (cf. section Caissier(ère)s ci-dessous). */}
      {!isRealTenant && (
        <Card className="copper-glow mb-12 overflow-hidden p-0">
          <div className="border-line bg-bg-soft flex flex-wrap items-center gap-4 border-b px-6 py-4">
            <Wallet className="text-brand-primary h-5 w-5" strokeWidth={1.5} />
            <div className="flex-1">
              <div className="mono text-ink-soft text-[10px] uppercase tracking-[0.3em]">
                {t('todaysCashier.label')}
              </div>
              <div className="display mt-1 text-xl">
                {activeCashier ? (
                  <>
                    <span style={{ color: activeCashier.tone }}>{activeCashier.name}</span>
                    <span className="text-ink-mute"> · {activeCashier.shift}</span>
                  </>
                ) : (
                  <span className="text-ink-mute italic">{t('todaysCashier.noneAssigned')}</span>
                )}
              </div>
            </div>
            {activeCashier && (
              <button
                type="button"
                onClick={() => designateCashier(null)}
                className="mono text-red btn-press text-[10px] uppercase tracking-wider hover:underline"
              >
                {t('todaysCashier.removeBtn')}
              </button>
            )}
          </div>
          <div className="text-ink-mute px-6 py-3 text-xs">
            {t('todaysCashier.hintBefore')}
            <code className="mono text-brand-glow">/cashier</code>
            {t('todaysCashier.hintAfter')}
          </div>
        </Card>
      )}

      <TeamBarbersSection
        staff={staffForStructural}
        setStaff={setStaff}
        activeBarbers={activeBarbers}
        inactiveBarbers={inactiveBarbers}
        customSections={customSections}
      />

      <TeamCashiersSection
        staff={staffForStructural}
        setStaff={setStaff}
        activeCashiers={activeCashiers}
        inactiveCashiers={inactiveCashiers}
        activeCashierId={activeCashierId}
        designateCashier={designateCashier}
        isRealTenant={isRealTenant}
        customSections={customSections}
      />

      {customSections.map((sectionName) => (
        <CustomTeamSection
          key={sectionName}
          name={sectionName}
          sectionStaff={staff.filter((s) => s.category?.trim() === sectionName)}
          setStaff={setStaff}
          customSections={customSections}
          isRealTenant={isRealTenant}
          activeCashierId={activeCashierId}
          designateCashier={designateCashier}
          onDelete={() => deleteCustomSection(sectionName)}
        />
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Section Barbiers
// -----------------------------------------------------------------------------
interface BarbersSectionProps {
  staff: Staff[];
  setStaff: TeamProps['setStaff'];
  activeBarbers: Barber[];
  inactiveBarbers: Barber[];
  customSections: string[];
}

function TeamBarbersSection({
  staff,
  setStaff,
  activeBarbers,
  inactiveBarbers,
  customSections,
}: BarbersSectionProps) {
  const t = useTranslations('manager.team.barbersSection');
  const tTeam = useTranslations('manager.team');
  const tenantSession = useTenantOrNull();
  const [editing, setEditing] = useState<Staff | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Staff | null>(null);
  const [ratings, setRatings] = useState<Map<string, BarberRating>>(new Map());

  useEffect(() => {
    const tenantId = tenantSession?.tenant.id;
    if (!tenantId) return;
    getBarberRatings(tenantId)
      .then((r) => {
        if (r.ok) {
          setRatings(new Map(r.ratings.map((x) => [x.barberId, x])));
        }
      })
      .catch(() => {});
  }, [tenantSession?.tenant.id]);

  const blank: Staff = {
    id: '',
    name: '',
    initials: '',
    tone: STAFF_TONES[0]!.value,
    isActive: true,
    phone: '',
    email: '',
    roles: ['barber'],
  };

  const toggleActive = (id: string) =>
    setStaff((prev) => prev.map((s) => (s.id === id ? { ...s, isActive: !s.isActive } : s)));

  /**
   * Suppression "soft" : retire le rôle barbier. Si la personne est polyvalente,
   * elle reste dans la section Caissier. Si c'était son seul rôle, suppression complète.
   */
  const remove = (id: string) => {
    setStaff((prev) =>
      prev.flatMap((s) => {
        if (s.id !== id) return [s];
        const remaining = s.roles.filter((r) => r !== 'barber');
        if (remaining.length === 0) return []; // plus aucun rôle → on supprime
        return [{ ...s, roles: remaining }];
      }),
    );
    setConfirmDelete(null);
  };

  /** Récupère le Staff complet (avec tous les rôles) à partir d'un Barber vue. */
  const findStaff = (id: string): Staff | undefined => staff.find((s) => s.id === id);

  return (
    <section className="mb-16">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mono text-brand-primary mb-3 text-[10px] uppercase tracking-[0.3em]">
            {t('header')}
          </div>
          <p className="text-ink-mute mt-2 text-sm">
            {activeBarbers.length > 1
              ? t('subtitleBeforePlural', { count: activeBarbers.length })
              : t('subtitleBefore', { count: activeBarbers.length })}
            {t('subtitleMid')}
            {inactiveBarbers.length > 0 && (
              <> {tTeam('headerCountsPaused', { count: inactiveBarbers.length })}</>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn icon={Plus as LucideIcon} onClick={() => setEditing({ ...blank })}>
            {t('addBtn')}
          </Btn>
        </div>
      </div>

      {/* Grille plate */}
      <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {activeBarbers.map((b, i) => {
            const isPolyvalent = b.roles.includes('cashier');
            return (
              <Card
                key={b.id}
                className={`fade-up group delay-${(i % 6) + 1} relative overflow-hidden p-6 transition`}
              >
                {/* Number marker */}
                <div className="display text-brand-primary/10 mono absolute end-4 top-3 text-5xl leading-none">
                  {String(i + 1).padStart(2, '0')}
                </div>

                {isPolyvalent && (
                  <div className="mb-3">
                    <Tag tone="copper">{t('addToCashierTag')}</Tag>
                  </div>
                )}

                <div className="mb-5 flex items-start gap-4">
                  <StaffPhoto
                    photoUrl={b.photoUrl}
                    initials={b.initials}
                    tone={b.tone}
                    className="display h-14 w-14 text-2xl"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="display text-2xl leading-tight">{b.name}</div>
                    {isPolyvalent && b.shift && (
                      <div className="mono text-ink-soft mt-1 text-[10px] uppercase tracking-wider">
                        {b.shift}
                      </div>
                    )}
                  </div>
                </div>

                {/* Rating badge — toujours visible */}
                {(() => {
                  const r = ratings.get(b.id);
                  const avg = r?.avg ?? 0;
                  const count = r?.count ?? 0;
                  return (
                    <div className="mb-4 flex items-center gap-1.5">
                      <Star
                        className={`h-4 w-4 ${
                          count > 0 ? 'fill-brand-primary text-brand-primary' : 'text-ink-soft'
                        }`}
                        strokeWidth={1.5}
                      />
                      <span className="mono text-ink-soft text-[11px]">
                        {count > 0
                          ? t('reviewsCount', { avg: avg.toFixed(1), count })
                          : t('noReviews')}
                      </span>
                    </div>
                  );
                })()}

                {(b.phone || b.email) && (
                  <div className="border-line text-ink-mute mb-4 space-y-1.5 border-t pt-4 text-xs">
                    {b.phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="text-ink-soft h-3 w-3" strokeWidth={1.5} />
                        <span className="mono">{b.phone}</span>
                      </div>
                    )}
                    {b.email && (
                      <div className="flex items-center gap-2">
                        <Mail className="text-ink-soft h-3 w-3" strokeWidth={1.5} />
                        <span>{b.email}</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(findStaff(b.id) ?? null)}
                    className="btn-press mono border-line-hi hover:border-brand-primary text-ink-mute hover:text-ink flex-1 rounded-sm border px-3 py-2 text-[10px] uppercase tracking-wider"
                  >
                    {t('editBtn')}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleActive(b.id)}
                    className="btn-press bg-surface-elev hover:bg-surface-hi text-ink-mute mono rounded-sm px-3 py-2 text-[10px] uppercase tracking-wider"
                    title={tTeam('pauseTitle')}
                  >
                    {tTeam('pauseBtn')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(findStaff(b.id) ?? null)}
                    aria-label={isPolyvalent ? t('removeRoleAria') : t('removeAria')}
                    className="btn-press bg-surface-elev hover:bg-red/20 hover:text-red rounded-sm p-2"
                    title={isPolyvalent ? tTeam('removeRoleTitle') : t('removeTitleFull')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
        {activeBarbers.length === 0 && inactiveBarbers.length === 0 && (
          <div className="border-line mt-4 rounded-sm border border-dashed p-12 text-center">
            <Users className="text-ink-soft mx-auto mb-4 h-10 w-10" strokeWidth={1} />
            <div className="display mb-2 text-xl">{t('emptyTitle')}</div>
            <div className="text-ink-mute mb-6 text-sm">{t('emptySubtitle')}</div>
            <Btn icon={Plus as LucideIcon} onClick={() => setEditing({ ...blank })}>
              {t('emptyAddBtn')}
            </Btn>
          </div>
        )}
      </>

      {/* Barbiers inactifs (collapsed) */}
      {inactiveBarbers.length > 0 && (
        <div className="mt-10">
          <div className="mono text-ink-soft mb-3 text-[10px] uppercase tracking-[0.3em]">
            {t('inactiveHeader', { count: inactiveBarbers.length })}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {inactiveBarbers.map((b) => (
              <Card key={b.id} className="flex items-center gap-3 p-4 opacity-60">
                <div
                  className="display flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm"
                  style={{
                    background: `${b.tone}25`,
                    color: b.tone,
                    border: `1px solid ${b.tone}50`,
                  }}
                >
                  {b.initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{b.name}</div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleActive(b.id)}
                  className="btn-press mono text-brand-primary text-[10px] uppercase tracking-wider hover:underline"
                >
                  {t('reactivateBtn')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(findStaff(b.id) ?? null)}
                  aria-label={t('removeAria')}
                  className="btn-press text-ink-soft hover:text-red"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Modal édition Staff (depuis section Barbiers) */}
      <StaffEditModal
        open={!!editing}
        draft={editing}
        defaultRole="barber"
        categories={customSections}
        onClose={() => setEditing(null)}
        onSave={(updated) => {
          if (updated.id) {
            setStaff((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
          } else {
            setStaff((prev) => [...prev, { ...updated, id: 'st-' + Date.now() }]);
          }
          setEditing(null);
        }}
      />

      {/* Modal confirmation suppression */}
      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title={tTeam('confirmDelete.title')}
      >
        {confirmDelete && (
          <div>
            {confirmDelete.roles.includes('cashier') ? (
              <>
                <p className="text-ink-mute mb-2">
                  {tTeam('confirmDelete.barberRemoveBefore')}
                  <span className="text-ink font-semibold">{confirmDelete.name}</span>
                  {tTeam('confirmDelete.barberRemoveAfter')}
                </p>
                <p className="text-ink-soft mb-6 text-xs">
                  {tTeam('confirmDelete.barberAlsoCashierHint', {
                    firstName: confirmDelete.name.split(' ')[0] ?? confirmDelete.name,
                  })}
                </p>
              </>
            ) : (
              <>
                <p className="text-ink-mute mb-2">
                  {tTeam('confirmDelete.deleteBefore')}
                  <span className="text-ink font-semibold">{confirmDelete.name}</span>
                  {tTeam('confirmDelete.deleteAfter')}
                </p>
                <p className="text-ink-soft mb-6 text-xs">{tTeam('confirmDelete.pauseHint')}</p>
              </>
            )}
            <div className="flex gap-2">
              <Btn variant="secondary" onClick={() => setConfirmDelete(null)} full>
                {tTeam('confirmDelete.cancelBtn')}
              </Btn>
              <Btn variant="danger" full onClick={() => remove(confirmDelete.id)}>
                {confirmDelete.roles.includes('cashier') ? t('removeBtnRole') : t('removeBtnFull')}
              </Btn>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Section Caissier(ère)s
// -----------------------------------------------------------------------------
interface CashiersSectionProps {
  staff: Staff[];
  setStaff: TeamProps['setStaff'];
  activeCashiers: Cashier[];
  inactiveCashiers: Cashier[];
  activeCashierId: string | null;
  designateCashier: (id: string | null) => void;
  isRealTenant: boolean;
  customSections: string[];
}

function TeamCashiersSection({
  staff,
  setStaff,
  activeCashiers,
  inactiveCashiers,
  activeCashierId,
  designateCashier,
  isRealTenant,
  customSections,
}: CashiersSectionProps) {
  const t = useTranslations('manager.team.cashiersSection');
  const tTeam = useTranslations('manager.team');
  const [editing, setEditing] = useState<Staff | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Staff | null>(null);
  // Fiche dont on gère l'accès Caisse (modal). On stocke l'id et on dérive la
  // fiche depuis `staff` : elle reste fraîche après un router.refresh().
  const [accessStaffId, setAccessStaffId] = useState<string | null>(null);
  const accessStaff = staff.find((s) => s.id === accessStaffId) ?? null;

  const blank: Staff = {
    id: '',
    name: '',
    initials: '',
    tone: STAFF_TONES[0]!.value,
    isActive: true,
    phone: '',
    email: '',
    roles: ['cashier'],
    shift: CASHIER_SHIFTS[0]!,
  };

  const toggleActive = (id: string) =>
    setStaff((prev) => prev.map((s) => (s.id === id ? { ...s, isActive: !s.isActive } : s)));

  /**
   * Suppression "soft" symétrique : retire le rôle caissier. Polyvalent reste barbier.
   * Si dernier rôle, suppression complète.
   */
  const remove = (id: string) => {
    if (activeCashierId === id) designateCashier(null);
    setStaff((prev) =>
      prev.flatMap((s) => {
        if (s.id !== id) return [s];
        const remaining = s.roles.filter((r) => r !== 'cashier');
        if (remaining.length === 0) return [];
        return [{ ...s, roles: remaining, shift: undefined }];
      }),
    );
    setConfirmDelete(null);
  };

  const findStaff = (id: string): Staff | undefined => staff.find((s) => s.id === id);
  const cashiersCount = activeCashiers.length + inactiveCashiers.length;

  // Helper de rendu pour une carte caissier — utilisé dans les vues plate et sectionée.
  const renderCashierCard = (c: Cashier, i: number) => {
    const isOnDuty = !isRealTenant && c.id === activeCashierId;
    const isPolyvalent = c.roles.includes('barber');
    return (
      <Card
        key={c.id}
        className={`fade-up group delay-${(i % 6) + 1} relative overflow-hidden p-6 transition ${isOnDuty ? 'border-brand-primary copper-glow' : ''}`}
      >
        <div className="display text-brand-primary/10 mono absolute end-4 top-3 text-5xl leading-none">
          {String(i + 1).padStart(2, '0')}
        </div>
        {(isOnDuty || isPolyvalent) && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {isOnDuty && <Tag tone="copper">{t('onDutyTag')}</Tag>}
            {isPolyvalent && <Tag tone="copper">{t('addToBarberTag')}</Tag>}
          </div>
        )}
        <div className="mb-5 flex items-start gap-4">
          <StaffPhoto
            photoUrl={c.photoUrl}
            initials={c.initials}
            tone={c.tone}
            className="display h-14 w-14 text-2xl"
          />
          <div className="min-w-0 flex-1">
            <div className="display text-2xl leading-tight">{c.name}</div>
            <div className="mono text-ink-soft mt-1 text-[10px] uppercase tracking-wider">
              {c.shift}
            </div>
          </div>
        </div>
        {isRealTenant && (
          <div className="border-line bg-bg-soft mb-4 rounded-sm border p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="mono text-ink-soft flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em]">
                <KeyRound className="h-3 w-3" strokeWidth={1.5} /> {t('accessSection')}
              </span>
              {c.cashierUserId ? (
                <span className="mono text-green flex items-center gap-1.5 text-[10px] uppercase tracking-wider">
                  <span className="bg-green h-1.5 w-1.5 rounded-full" />
                  {t('accessActive')}
                </span>
              ) : (
                <span className="mono text-ink-soft text-[10px] uppercase tracking-wider">
                  {t('accessNotConfigured')}
                </span>
              )}
            </div>
            <div className="text-ink-mute mb-2.5 truncate text-xs">
              {c.cashierUserId
                ? (c.email ?? t('accessHintConfigured'))
                : t('accessHintNotConfigured')}
            </div>
            <button
              type="button"
              onClick={() => setAccessStaffId(c.id)}
              className="btn-press mono border-line-hi hover:border-brand-primary hover:text-brand-primary text-ink-mute w-full rounded-sm border px-3 py-2 text-[10px] uppercase tracking-wider"
            >
              {c.cashierUserId ? t('manageAccessBtn') : t('setAccessBtn')}
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {isRealTenant ? (
            <button
              type="button"
              onClick={() => setEditing(findStaff(c.id) ?? null)}
              className="btn-press mono border-line-hi hover:border-brand-primary text-ink-mute hover:text-ink flex-1 rounded-sm border px-3 py-2 text-[10px] uppercase tracking-wider"
            >
              {t('editBtn')}
            </button>
          ) : (
            <>
              {!isOnDuty ? (
                <button
                  type="button"
                  onClick={() => designateCashier(c.id)}
                  className="btn-press mono border-line-hi hover:border-brand-primary hover:text-brand-primary text-ink-mute flex-1 rounded-sm border px-3 py-2 text-[10px] uppercase tracking-wider"
                >
                  {t('designateBtn')}
                </button>
              ) : (
                <span className="mono text-brand-primary flex-1 px-1 text-[10px] uppercase tracking-wider">
                  {t('onDutyToday')}
                </span>
              )}
              <button
                type="button"
                onClick={() => setEditing(findStaff(c.id) ?? null)}
                aria-label={t('editAria')}
                className="btn-press bg-surface-elev hover:bg-surface-hi rounded-sm p-2"
              >
                <Edit3 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => toggleActive(c.id)}
            className="btn-press bg-surface-elev hover:bg-surface-hi text-ink-mute mono rounded-sm px-3 py-2 text-[10px] uppercase tracking-wider"
            title={tTeam('pauseTitle')}
          >
            {tTeam('pauseBtn')}
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(findStaff(c.id) ?? null)}
            aria-label={isPolyvalent ? t('removeRoleAria') : t('removeAria')}
            className="btn-press bg-surface-elev hover:bg-red/20 hover:text-red rounded-sm p-2"
            title={isPolyvalent ? tTeam('removeRoleTitleCashier') : t('removeTitleFull')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </Card>
    );
  };

  return (
    <section className="border-line border-t pt-12">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mono text-brand-primary mb-3 text-[10px] uppercase tracking-[0.3em]">
            {t('header')}
          </div>
          <p className="text-ink-mute mt-2 text-sm">
            {activeCashiers.length > 1
              ? t('subtitleBeforePlural', { count: activeCashiers.length })
              : t('subtitleBefore', { count: activeCashiers.length })}
            {t('subtitleMid')}
            {inactiveCashiers.length > 0 && (
              <> {tTeam('headerCountsPaused', { count: inactiveCashiers.length })}</>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn icon={Plus as LucideIcon} onClick={() => setEditing({ ...blank })}>
            {t('addBtn')}
          </Btn>
        </div>
      </div>

      {cashiersCount === 0 ? (
        <Card className="p-12 text-center">
          <Wallet className="text-ink-soft mx-auto mb-4 h-10 w-10" strokeWidth={1} />
          <div className="display mb-2 text-xl">{t('emptyTitle')}</div>
          <div className="text-ink-mute mb-6 text-sm">{t('emptySubtitle')}</div>
          <Btn icon={Plus as LucideIcon} onClick={() => setEditing({ ...blank })}>
            {t('emptyAddBtn')}
          </Btn>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {activeCashiers.map((c, i) => renderCashierCard(c, i))}
        </div>
      )}

      {/* Caissiers inactifs (collapsed) */}
      {inactiveCashiers.length > 0 && (
        <div className="mt-10">
          <div className="mono text-ink-soft mb-3 text-[10px] uppercase tracking-[0.3em]">
            {t('inactiveHeader', { count: inactiveCashiers.length })}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {inactiveCashiers.map((c) => (
              <Card key={c.id} className="flex items-center gap-3 p-4 opacity-60">
                <div
                  className="display flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm"
                  style={{
                    background: `${c.tone}25`,
                    color: c.tone,
                    border: `1px solid ${c.tone}50`,
                  }}
                >
                  {c.initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{c.name}</div>
                  <div className="mono text-ink-soft text-[10px] uppercase tracking-wider">
                    {c.shift}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleActive(c.id)}
                  className="btn-press mono text-brand-primary text-[10px] uppercase tracking-wider hover:underline"
                >
                  {t('reactivateBtn')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(findStaff(c.id) ?? null)}
                  aria-label={t('removeAria')}
                  className="btn-press text-ink-soft hover:text-red"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Modal édition Staff (depuis section Caissiers) */}
      <StaffEditModal
        open={!!editing}
        draft={editing}
        defaultRole="cashier"
        categories={customSections}
        onClose={() => setEditing(null)}
        onSave={(updated) => {
          if (updated.id) {
            setStaff((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
          } else {
            setStaff((prev) => [...prev, { ...updated, id: 'st-' + Date.now() }]);
          }
          setEditing(null);
        }}
      />

      {/* Modal confirmation suppression caissier */}
      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title={tTeam('confirmDelete.title')}
      >
        {confirmDelete && (
          <div>
            {confirmDelete.roles.includes('barber') ? (
              <>
                <p className="text-ink-mute mb-2">
                  {tTeam('confirmDelete.cashierRemoveBefore')}
                  <span className="text-ink font-semibold">{confirmDelete.name}</span>
                  {tTeam('confirmDelete.cashierRemoveAfter')}
                </p>
                <p className="text-ink-soft mb-6 text-xs">
                  {tTeam('confirmDelete.cashierAlsoBarberHint', {
                    firstName: confirmDelete.name.split(' ')[0] ?? confirmDelete.name,
                  })}
                </p>
              </>
            ) : (
              <>
                <p className="text-ink-mute mb-2">
                  {tTeam('confirmDelete.deleteBefore')}
                  <span className="text-ink font-semibold">{confirmDelete.name}</span>
                  {tTeam('confirmDelete.deleteAfter')}
                </p>
                <p className="text-ink-soft mb-6 text-xs">{tTeam('confirmDelete.pauseHint')}</p>
              </>
            )}
            <div className="flex gap-2">
              <Btn variant="secondary" onClick={() => setConfirmDelete(null)} full>
                {tTeam('confirmDelete.cancelBtn')}
              </Btn>
              <Btn variant="danger" full onClick={() => remove(confirmDelete.id)}>
                {confirmDelete.roles.includes('barber') ? t('removeBtnRole') : t('removeBtnFull')}
              </Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal gestion de l'accès Caisse (création / réinitialisation / révocation).
          `key` = fiche ciblée → changer de fiche remonte le modal (état frais). */}
      <CashierAccessModal
        key={accessStaffId ?? 'none'}
        staff={accessStaff}
        onClose={() => setAccessStaffId(null)}
      />
    </section>
  );
}

// -----------------------------------------------------------------------------
// Section personnalisée (top-level, créée par l'utilisateur)
// -----------------------------------------------------------------------------
interface CustomSectionProps {
  name: string;
  sectionStaff: Staff[];
  setStaff: TeamProps['setStaff'];
  customSections: string[];
  isRealTenant: boolean;
  activeCashierId: string | null;
  designateCashier: (id: string | null) => void;
  onDelete: () => void;
}

function CustomTeamSection({
  name,
  sectionStaff,
  setStaff,
  customSections,
  isRealTenant,
  activeCashierId,
  designateCashier,
  onDelete,
}: CustomSectionProps) {
  const t = useTranslations('manager.team.customSection');
  const tTeam = useTranslations('manager.team');
  const tCashiers = useTranslations('manager.team.cashiersSection');
  const [editing, setEditing] = useState<Staff | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Staff | null>(null);
  const [accessStaffId, setAccessStaffId] = useState<string | null>(null);
  const accessStaff = sectionStaff.find((s) => s.id === accessStaffId) ?? null;

  const activeMembers = sectionStaff.filter((s) => s.isActive);
  const inactiveMembers = sectionStaff.filter((s) => !s.isActive);

  const blank: Staff = {
    id: '',
    name: '',
    initials: '',
    tone: STAFF_TONES[0]!.value,
    isActive: true,
    phone: '',
    email: '',
    roles: ['barber'],
    category: name,
  };

  const toggleActive = (id: string) =>
    setStaff((prev) => prev.map((s) => (s.id === id ? { ...s, isActive: !s.isActive } : s)));

  const remove = (id: string) => {
    setStaff((prev) => prev.filter((s) => s.id !== id));
    setConfirmDelete(null);
  };

  return (
    <section className="border-line mb-16 border-t pt-12">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mono text-brand-primary mb-3 text-[10px] uppercase tracking-[0.3em]">
            {t('header', { name })}
          </div>
          <p className="text-ink-mute mt-2 text-sm">
            {activeMembers.length !== 1
              ? t('subtitleMany', { count: activeMembers.length })
              : t('subtitleOne', { count: activeMembers.length })}
            {inactiveMembers.length > 0 && (
              <> {tTeam('headerCountsPaused', { count: inactiveMembers.length })}</>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activeMembers.length === 0 && inactiveMembers.length === 0 && (
            <button
              type="button"
              onClick={onDelete}
              className="btn-press mono text-ink-soft hover:text-red text-[10px] uppercase tracking-wider"
            >
              {t('deleteSectionBtn')}
            </button>
          )}
          <Btn icon={Plus as LucideIcon} onClick={() => setEditing({ ...blank })}>
            {t('addMemberBtn')}
          </Btn>
        </div>
      </div>

      {activeMembers.length === 0 && inactiveMembers.length === 0 ? (
        <div className="border-line rounded-sm border border-dashed p-12 text-center">
          <Users className="text-ink-soft mx-auto mb-4 h-10 w-10" strokeWidth={1} />
          <div className="display mb-2 text-xl">{t('emptyTitle')}</div>
          <div className="text-ink-mute mb-6 text-sm">{t('emptySubtitle')}</div>
          <Btn icon={Plus as LucideIcon} onClick={() => setEditing({ ...blank })}>
            {t('emptyAddBtn')}
          </Btn>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {activeMembers.map((s, i) => {
            const isBarber = s.roles.includes('barber');
            const isCashier = s.roles.includes('cashier');
            const isOnDuty = !isRealTenant && s.id === activeCashierId;
            return (
              <Card
                key={s.id}
                className={`fade-up group delay-${(i % 6) + 1} relative overflow-hidden p-6 transition ${isOnDuty ? 'border-brand-primary copper-glow' : ''}`}
              >
                <div className="display text-brand-primary/10 mono absolute end-4 top-3 text-5xl leading-none">
                  {String(i + 1).padStart(2, '0')}
                </div>
                {(isBarber || isCashier || isOnDuty) && (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {isBarber && <Tag tone="copper">{t('barberTag')}</Tag>}
                    {isCashier && <Tag tone="copper">{t('cashierTag')}</Tag>}
                    {isOnDuty && <Tag tone="copper">{t('onDutyTag')}</Tag>}
                  </div>
                )}
                <div className="mb-5 flex items-start gap-4">
                  <StaffPhoto
                    photoUrl={s.photoUrl}
                    initials={s.initials}
                    tone={s.tone}
                    className="display h-14 w-14 text-2xl"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="display text-2xl leading-tight">{s.name}</div>
                    <div className="mono text-ink-soft mt-1 text-[10px] uppercase tracking-wider">
                      {s.shift ?? (isBarber ? t('barberRole') : t('cashierRole'))}
                    </div>
                  </div>
                </div>
                {isRealTenant && isCashier && (
                  <div className="border-line bg-bg-soft mb-4 rounded-sm border p-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="mono text-ink-soft flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em]">
                        <KeyRound className="h-3 w-3" strokeWidth={1.5} />{' '}
                        {tCashiers('accessSection')}
                      </span>
                      {s.cashierUserId ? (
                        <span className="mono text-green flex items-center gap-1.5 text-[10px] uppercase tracking-wider">
                          <span className="bg-green h-1.5 w-1.5 rounded-full" />{' '}
                          {tCashiers('accessActive')}
                        </span>
                      ) : (
                        <span className="mono text-ink-soft text-[10px] uppercase tracking-wider">
                          {tCashiers('accessNotConfigured')}
                        </span>
                      )}
                    </div>
                    <div className="text-ink-mute mb-2.5 truncate text-xs">
                      {s.cashierUserId
                        ? (s.email ?? tCashiers('accessHintConfigured'))
                        : tCashiers('accessHintNotConfigured')}
                    </div>
                    <button
                      type="button"
                      onClick={() => setAccessStaffId(s.id)}
                      className="btn-press mono border-line-hi hover:border-brand-primary hover:text-brand-primary text-ink-mute w-full rounded-sm border px-3 py-2 text-[10px] uppercase tracking-wider"
                    >
                      {s.cashierUserId ? tCashiers('manageAccessBtn') : tCashiers('setAccessBtn')}
                    </button>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {!isRealTenant && isCashier && (
                    <>
                      {!isOnDuty ? (
                        <button
                          type="button"
                          onClick={() => designateCashier(s.id)}
                          className="btn-press mono border-line-hi hover:border-brand-primary hover:text-brand-primary text-ink-mute flex-1 rounded-sm border px-3 py-2 text-[10px] uppercase tracking-wider"
                        >
                          {tCashiers('designateBtn')}
                        </button>
                      ) : (
                        <span className="mono text-brand-primary flex-1 px-1 text-[10px] uppercase tracking-wider">
                          {tCashiers('onDutyToday')}
                        </span>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditing(s)}
                    className="btn-press mono border-line-hi hover:border-brand-primary text-ink-mute hover:text-ink flex-1 rounded-sm border px-3 py-2 text-[10px] uppercase tracking-wider"
                  >
                    {t('editBtn')}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleActive(s.id)}
                    className="btn-press bg-surface-elev hover:bg-surface-hi text-ink-mute mono rounded-sm px-3 py-2 text-[10px] uppercase tracking-wider"
                    title={tTeam('pauseTitle')}
                  >
                    {tTeam('pauseBtn')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(s)}
                    aria-label={t('removeAria')}
                    className="btn-press bg-surface-elev hover:bg-red/20 hover:text-red rounded-sm p-2"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {inactiveMembers.length > 0 && (
        <div className="mt-10">
          <div className="mono text-ink-soft mb-3 text-[10px] uppercase tracking-[0.3em]">
            {t('inactiveHeader', { count: inactiveMembers.length })}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {inactiveMembers.map((s) => (
              <Card key={s.id} className="flex items-center gap-3 p-4 opacity-60">
                <div
                  className="display flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm"
                  style={{
                    background: `${s.tone}25`,
                    color: s.tone,
                    border: `1px solid ${s.tone}50`,
                  }}
                >
                  {s.initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{s.name}</div>
                  <div className="mono text-ink-soft text-[10px] uppercase tracking-wider">
                    {s.roles.includes('barber') ? t('barberRole') : t('cashierRole')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleActive(s.id)}
                  className="btn-press mono text-brand-primary text-[10px] uppercase tracking-wider hover:underline"
                >
                  {t('reactivateBtn')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(s)}
                  aria-label={t('removeAria')}
                  className="btn-press text-ink-soft hover:text-red"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </Card>
            ))}
          </div>
        </div>
      )}

      <StaffEditModal
        open={!!editing}
        draft={editing}
        defaultRole="barber"
        categories={customSections}
        onClose={() => setEditing(null)}
        onSave={(updated) => {
          if (updated.id) {
            setStaff((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
          } else {
            setStaff((prev) => [...prev, { ...updated, id: 'st-' + Date.now() }]);
          }
          setEditing(null);
        }}
      />

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title={tTeam('confirmDelete.title')}
      >
        {confirmDelete && (
          <div>
            <p className="text-ink-mute mb-6">
              {t('confirmDeletePrefix')}
              <span className="text-ink font-semibold">{confirmDelete.name}</span>
              {t('confirmDeleteSuffix')}
            </p>
            <div className="flex gap-2">
              <Btn variant="secondary" onClick={() => setConfirmDelete(null)} full>
                {t('confirmCancelBtn')}
              </Btn>
              <Btn variant="danger" full onClick={() => remove(confirmDelete.id)}>
                {t('confirmDeleteBtn')}
              </Btn>
            </div>
          </div>
        )}
      </Modal>

      <CashierAccessModal
        key={accessStaffId ?? 'none'}
        staff={accessStaff}
        onClose={() => setAccessStaffId(null)}
      />
    </section>
  );
}

// -----------------------------------------------------------------------------
// StaffEditModal — modal unifié édition/création
//
// Une seule UI gère barbier pur, caissier pur, et polyvalent. Les deux toggles
// `Barbier`/`Caissier` pilotent l'affichage conditionnel des champs métier
// (plage horaire). Au moins un rôle doit rester coché — sinon la
// personne devrait être supprimée explicitement.
// -----------------------------------------------------------------------------
interface StaffEditModalProps {
  open: boolean;
  draft: Staff | null;
  /** Rôle pré-coché si on crée depuis l'une des 2 sections. */
  defaultRole: StaffRole;
  /** Sections existantes (pour datalist autocomplete). */
  categories: string[];
  onClose: () => void;
  onSave: (next: Staff) => void;
}

function StaffEditModal({
  open,
  draft,
  defaultRole,
  categories,
  onClose,
  onSave,
}: StaffEditModalProps) {
  const t = useTranslations('manager.team.editModal');
  const [d, setD] = useState<Staff | null>(draft);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Resynchroniser le brouillon local quand le parent ouvre une nouvelle fiche.
  // On compare l'identité (id) plutôt qu'une égalité profonde : ça évite
  // d'écraser les modifs locales si le parent re-render avec le même draft.
  useEffect(() => {
    setD(draft);
  }, [draft?.id, draft]);

  // Lecture d'une photo de profil → data URL (même logique que le logo salon).
  const onPickPhoto = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 1_200_000) {
      alert(t('photoTooLarge', { size: Math.round(file.size / 1024) }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setD((curr) => (curr ? { ...curr, photoUrl: dataUrl } : curr));
    };
    reader.readAsDataURL(file);
  };

  if (!d) return null;

  const hasBarber = d.roles.includes('barber');
  const hasCashier = d.roles.includes('cashier');
  const canSave = d.name.trim() !== '' && d.initials.trim() !== '' && d.roles.length > 0;

  const toggleRole = (role: StaffRole) => {
    setD((curr) => {
      if (!curr) return curr;
      const has = curr.roles.includes(role);
      // Au moins un rôle requis : si on tente de retirer le dernier, on bloque.
      if (has && curr.roles.length === 1) return curr;
      const nextRoles: StaffRole[] = has
        ? curr.roles.filter((r) => r !== role)
        : [...curr.roles, role];
      // Réinitialiser les champs orphelins
      const next: Staff = {
        ...curr,
        roles: nextRoles,
        shift: nextRoles.includes('cashier') ? (curr.shift ?? CASHIER_SHIFTS[0]!) : undefined,
      };
      return next;
    });
  };

  const title = d.id
    ? `${t('titlePrefix')}${d.name || t('titleFallback')}`
    : defaultRole === 'barber'
      ? t('newBarber')
      : t('newCashier');

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        {/* Avatar preview + upload photo */}
        <div className="flex items-center gap-4">
          <StaffPhoto
            photoUrl={d.photoUrl}
            initials={d.initials || '·'}
            tone={d.tone}
            className="display h-16 w-16 text-3xl"
          />
          <div className="min-w-0 flex-1">
            <div className="text-ink-mute text-xs">
              {d.photoUrl ? t('photoHintConfigured') : t('photoHintEmpty')}
            </div>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPickPhoto(f);
                e.target.value = '';
              }}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="btn-press mono border-line-hi hover:border-brand-primary text-ink-mute hover:text-ink flex items-center gap-1.5 rounded-sm border px-3 py-2 text-[10px] uppercase tracking-wider"
              >
                <Upload className="h-3 w-3" strokeWidth={1.5} />
                {d.photoUrl ? t('changePhoto') : t('addPhoto')}
              </button>
              {d.photoUrl && (
                <button
                  type="button"
                  onClick={() => setD({ ...d, photoUrl: null })}
                  className="mono text-red btn-press text-[10px] uppercase tracking-wider hover:underline"
                >
                  {t('removePhotoBtn')}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Identité */}
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <Input
            label={t('fullNameLabel')}
            value={d.name}
            onChange={(e) =>
              setD({
                ...d,
                name: e.target.value,
                initials: d.initials || (e.target.value[0]?.toUpperCase() ?? ''),
              })
            }
            placeholder={t('fullNamePlaceholder')}
          />
          <Input
            label={t('initialsLabel')}
            value={d.initials}
            onChange={(e) => setD({ ...d, initials: e.target.value.slice(0, 3).toUpperCase() })}
            maxLength={3}
            placeholder={t('initialsPlaceholder')}
          />
        </div>

        {/* Rôles — toggle row */}
        <div>
          <span className="mono text-ink-soft mb-2 block text-[10px] uppercase tracking-[0.2em]">
            {d.roles.length > 1 ? t('rolesLabelMulti') : t('rolesLabel')}
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => toggleRole('barber')}
              aria-pressed={hasBarber}
              className={`btn-press flex items-center justify-center gap-2 rounded-sm border px-3 py-3 text-sm font-semibold transition ${
                hasBarber
                  ? 'border-brand-primary bg-brand-primary/10 text-ink'
                  : 'border-line text-ink-mute hover:border-line-hi'
              }`}
            >
              <Scissors className="h-3.5 w-3.5" strokeWidth={2} />
              {t('roleBarber')}
            </button>
            <button
              type="button"
              onClick={() => toggleRole('cashier')}
              aria-pressed={hasCashier}
              className={`btn-press flex items-center justify-center gap-2 rounded-sm border px-3 py-3 text-sm font-semibold transition ${
                hasCashier
                  ? 'border-brand-primary bg-brand-primary/10 text-ink'
                  : 'border-line text-ink-mute hover:border-line-hi'
              }`}
            >
              <Wallet className="h-3.5 w-3.5" strokeWidth={2} />
              {t('roleCashier')}
            </button>
          </div>
          <p className="text-ink-soft mt-2 text-[11px]">
            {d.roles.length === 2 ? t('rolesHintBoth') : t('rolesHintSingle')}
          </p>
        </div>

        {/* Plage horaire caisse — conditionnelle */}
        {hasCashier && (
          <div>
            <span className="mono text-ink-soft mb-2 block text-[10px] uppercase tracking-[0.2em]">
              {t('shiftLabel')}
            </span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {CASHIER_SHIFTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setD({ ...d, shift: s })}
                  className={`btn-press rounded-sm border px-3 py-2 text-xs ${
                    d.shift === s
                      ? 'border-brand-primary text-ink bg-surface'
                      : 'border-line text-ink-mute'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Couleur */}
        <div>
          <span className="mono text-ink-soft mb-2 block text-[10px] uppercase tracking-[0.2em]">
            {t('toneLabel')}
          </span>
          <div className="flex flex-wrap gap-2">
            {STAFF_TONES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setD({ ...d, tone: t.value })}
                aria-label={t.label}
                title={t.label}
                className={`btn-press h-9 w-9 rounded-full border-2 transition ${
                  d.tone === t.value ? 'border-ink scale-110' : 'border-transparent hover:scale-105'
                }`}
                style={{ background: t.value }}
              />
            ))}
          </div>
        </div>

        {/* Section — boutons de sélection (visible seulement si des sections ont été créées) */}
        {categories.length > 0 && (
          <div>
            <span className="mono text-ink-soft mb-2 block text-[10px] uppercase tracking-[0.2em]">
              {t('categoryLabel')}
            </span>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setD({ ...d, category: d.category === c ? undefined : c })}
                  className={`btn-press rounded-sm border px-3 py-2 text-xs ${
                    d.category === c
                      ? 'border-brand-primary bg-surface text-ink'
                      : 'border-line text-ink-mute hover:border-line-hi'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <p className="text-ink-soft mt-1.5 text-[11px]">{t('categoryHint')}</p>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Btn variant="secondary" onClick={onClose} full>
            {t('cancelBtn')}
          </Btn>
          <Btn full onClick={() => canSave && onSave(d)}>
            {t('saveBtn')}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

// =============================================================================
// Réservations
// =============================================================================
interface ReservProps {
  services: Service[];
  barbers: Barber[];
  bookings: Booking[];
}

function ManagerReservations({ services, barbers, bookings }: ReservProps) {
  const t = useTranslations('manager.reservations');
  const locale = useLocale();
  const bcp47 = locale === 'ar' ? 'ar-EG' : locale === 'en' ? 'en-US' : 'fr-FR';
  const fmt = useFmtMoney();
  const [filter, setFilter] = useState<'all' | 'today' | 'upcoming'>('all');
  const filtered = bookings
    .filter((b) => {
      if (filter === 'today') return b.date === todayStr();
      if (filter === 'upcoming') return b.date >= todayStr() && b.status !== 'cancelled';
      return true;
    })
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  const filterOpts: Array<['all' | 'today' | 'upcoming', string]> = [
    ['all', t('filterAll')],
    ['today', t('filterToday')],
    ['upcoming', t('filterUpcoming')],
  ];

  return (
    <div className="mx-auto max-w-7xl px-6 py-10 md:px-10">
      <Tag tone="copper">{t('eyebrow')}</Tag>
      <h2 className="display mb-8 mt-3 text-4xl">{t('title')}</h2>

      <div className="mb-6 flex gap-2">
        {filterOpts.map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={`btn-press rounded-sm border px-4 py-2 text-xs font-semibold ${
              filter === k
                ? 'border-brand-primary text-ink bg-surface'
                : 'border-line text-ink-mute'
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      <Card>
        <div className="border-line mono text-ink-soft hidden grid-cols-[100px_1fr_140px_120px_100px_120px] gap-3 border-b px-5 py-3 text-[9px] uppercase tracking-[0.25em] sm:grid">
          <div>{t('colDateTime')}</div>
          <div>{t('colClient')}</div>
          <div>{t('colService')}</div>
          <div>{t('colBarber')}</div>
          <div>{t('colStatus')}</div>
          <div className="text-end">{t('colAmount')}</div>
        </div>
        {filtered.map((b) => {
          const s = services.find((x) => x.id === b.serviceId);
          const ba = barbers.find((x) => x.id === b.barberId);
          return (
            <div
              key={b.id}
              className="border-line flex flex-wrap gap-2 border-b px-5 py-4 text-sm last:border-0 sm:grid sm:grid-cols-[100px_1fr_140px_120px_100px_120px] sm:items-center sm:gap-3"
            >
              <div>
                <div className="mono text-ink-mute text-xs">
                  {new Date(b.date).toLocaleDateString(bcp47, {
                    day: '2-digit',
                    month: '2-digit',
                  })}
                </div>
                <div className="mono text-brand-primary font-semibold">{b.time}</div>
              </div>
              <div className="w-full font-semibold sm:w-auto">{b.clientName}</div>
              <div className="text-ink-mute">{s?.name}</div>
              <div style={{ color: ba?.tone }}>{ba?.name}</div>
              <div>
                {b.status === 'done' && <Tag tone="green">{t('statusDone')}</Tag>}
                {b.status === 'in-chair' && <Tag tone="copper">{t('statusInChair')}</Tag>}
                {b.status === 'upcoming' && <Tag>{t('statusUpcoming')}</Tag>}
                {b.status === 'cancelled' && <Tag tone="red">{t('statusCancelled')}</Tag>}
              </div>
              <div className="sm:text-end">
                <div className="mono font-semibold">{fmt(b.amountCents)}</div>
                <div className="mono text-ink-soft text-[10px] uppercase tracking-wider">
                  {b.paid ? t('paidYes') : t('paidNo')}
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-ink-mute p-10 text-center">{t('empty')}</div>
        )}
      </Card>
    </div>
  );
}

// =============================================================================
// Prestations (CRUD)
// =============================================================================
interface ServicesProps {
  services: Service[];
  setServices: (next: Service[] | ((prev: Service[]) => Service[])) => void;
}

function ManagerServices({ services, setServices }: ServicesProps) {
  const t = useTranslations('manager.services');
  const fmt = useFmtMoney();
  const tenantSession = useTenantOrNull();
  const localProfile = useSalonProfile();
  const currency = tenantSession?.tenant.currency ?? localProfile.currency;
  const [editing, setEditing] = useState<Service | null>(null);
  const blank: Service = {
    id: '',
    name: '',
    duration: 30,
    priceCents: 2500,
    icon: 'scissors',
    desc: '',
  };

  const iconKeys: Service['icon'][] = ['scissors', 'razor', 'crown', 'shield', 'star', 'sparkle'];

  // Aucune section par défaut : toutes les prestations s'affichent en vue
  // plate. L'utilisateur crée ses sections quand il en a besoin. Évite le
  // problème "Prestations vide + toutes les prestations sous Sans section".
  const [sections, setSections] = useLocalSections('systema:service-sections');
  const [creatingSection, setCreatingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');

  const grouped = useMemo(() => {
    const bySection = new Map<string, Service[]>(sections.map((s) => [s, []]));
    const unassigned: Service[] = [];
    for (const s of services) {
      const cat = s.category?.trim() ?? '';
      if (cat && sections.includes(cat)) bySection.get(cat)!.push(s);
      else unassigned.push(s);
    }
    return { bySection, unassigned };
  }, [services, sections]);

  const addSection = () => {
    const name = newSectionName.trim();
    if (!name || sections.includes(name)) return;
    setSections((prev) => [...prev, name]);
    setNewSectionName('');
    setCreatingSection(false);
  };

  const deleteSection = (name: string) => {
    setSections((prev) => prev.filter((s) => s !== name));
    setServices((prev) =>
      prev.map((s) => (s.category?.trim() === name ? { ...s, category: undefined } : s)),
    );
  };

  const renderServiceCard = (s: Service) => (
    <Card key={s.id} className="group p-5">
      <div className="mb-3 flex items-start justify-between">
        <div className="text-brand-primary">
          <ServiceIcon iconKey={s.icon} className="h-6 w-6" />
        </div>
        <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
          <button
            type="button"
            onClick={() => setEditing(s)}
            className="btn-press bg-surface-elev hover:bg-surface-hi rounded-sm p-2"
          >
            <Edit3 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setServices((prev) => prev.filter((x) => x.id !== s.id))}
            className="btn-press bg-surface-elev hover:bg-red/20 hover:text-red rounded-sm p-2"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="display mb-1 text-xl">{s.name}</div>
      <div className="text-ink-mute mb-4 line-clamp-2 text-xs">{s.desc}</div>
      <div className="flex items-baseline justify-between">
        <span className="mono text-ink-soft text-xs">
          <Clock className="me-1 inline h-3 w-3" />
          {s.duration} min
        </span>
        <span className="display text-brand-primary mono text-xl">{fmt(s.priceCents)}</span>
      </div>
    </Card>
  );

  return (
    <div className="mx-auto max-w-7xl px-6 py-10 md:px-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Tag tone="copper">{t('eyebrow')}</Tag>
          <h2 className="display mt-3 text-4xl">{t('title')}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {creatingSection ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={newSectionName}
                onChange={(e) => setNewSectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addSection();
                  if (e.key === 'Escape') {
                    setCreatingSection(false);
                    setNewSectionName('');
                  }
                }}
                placeholder={t('sectionNamePlaceholder')}
                className="border-line focus:border-brand-primary bg-bg w-44 rounded-sm border px-3 py-2 text-sm outline-none"
              />
              <Btn onClick={addSection}>{t('createSectionBtn')}</Btn>
              <button
                type="button"
                onClick={() => {
                  setCreatingSection(false);
                  setNewSectionName('');
                }}
                className="btn-press text-ink-mute hover:text-ink p-1 text-lg leading-none"
                aria-label={t('cancelSectionAria')}
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreatingSection(true)}
              className="btn-press mono border-line hover:border-brand-primary hover:text-brand-primary text-ink-mute rounded-sm border px-3 py-2 text-[10px] uppercase tracking-wider"
            >
              {t('addSectionBtn')}
            </button>
          )}
          <Btn icon={Plus as LucideIcon} onClick={() => setEditing({ ...blank })}>
            {t('newServiceBtn')}
          </Btn>
        </div>
      </div>

      {/* Vue plate — aucune section */}
      {sections.length === 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((s) => renderServiceCard(s))}
        </div>
      )}

      {/* Vue sectionée */}
      {sections.length > 0 && (
        <>
          {sections.map((sectionName) => {
            const items = grouped.bySection.get(sectionName) ?? [];
            return (
              <div key={sectionName} className="mb-10 last:mb-0">
                <div className="border-line/60 mb-4 flex items-center justify-between border-b pb-2">
                  <span className="mono text-brand-primary text-[10px] uppercase tracking-[0.3em]">
                    {sectionName}
                  </span>
                  {items.length === 0 && (
                    <button
                      type="button"
                      onClick={() => deleteSection(sectionName)}
                      className="btn-press mono text-ink-soft hover:text-red text-[10px] uppercase tracking-wider"
                    >
                      {t('deleteSectionBtn')}
                    </button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((s) => renderServiceCard(s))}
                  <button
                    type="button"
                    onClick={() => setEditing({ ...blank, category: sectionName })}
                    className="btn-press border-line hover:border-brand-primary group flex min-h-[120px] items-center justify-center rounded-sm border-2 border-dashed transition"
                  >
                    <div className="text-center">
                      <Plus
                        className="text-ink-soft group-hover:text-brand-primary mx-auto mb-1 h-5 w-5"
                        strokeWidth={1.5}
                      />
                      <span className="mono text-ink-soft group-hover:text-brand-primary text-[10px] uppercase tracking-wider">
                        {t('addInSectionBtn')}
                      </span>
                    </div>
                  </button>
                </div>
              </div>
            );
          })}
          {grouped.unassigned.length > 0 && (
            <div className="mb-10">
              <div className="mono text-ink-soft border-line/60 mb-4 border-b pb-2 text-[10px] uppercase tracking-[0.3em]">
                {t('noSection')}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {grouped.unassigned.map((s) => renderServiceCard(s))}
              </div>
            </div>
          )}
        </>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? t('editModal.editTitle') : t('editModal.newTitle')}
      >
        {editing && (
          <div className="space-y-4">
            <Input
              label={t('editModal.nameLabel')}
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
            <Input
              label={t('editModal.descLabel')}
              value={editing.desc}
              onChange={(e) => setEditing({ ...editing, desc: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label={t('editModal.durationLabel')}
                type="number"
                value={editing.duration}
                onChange={(e) => setEditing({ ...editing, duration: +e.target.value })}
              />
              <Input
                label={t('editModal.priceLabel', { currency })}
                type="number"
                value={(editing.priceCents / 100).toString()}
                onChange={(e) =>
                  setEditing({ ...editing, priceCents: Math.round(+e.target.value * 100) })
                }
              />
            </div>
            <div>
              <span className="mono text-ink-soft mb-2 block text-[10px] uppercase tracking-[0.2em]">
                {t('editModal.iconLabel')}
              </span>
              <div className="flex gap-2">
                {iconKeys.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setEditing({ ...editing, icon: k })}
                    className={`btn-press flex h-12 w-12 items-center justify-center rounded-sm border ${
                      editing.icon === k
                        ? 'border-brand-primary text-brand-primary'
                        : 'border-line text-ink-mute'
                    }`}
                  >
                    <ServiceIcon iconKey={k} />
                  </button>
                ))}
              </div>
            </div>
            {sections.length > 0 && (
              <div>
                <span className="mono text-ink-soft mb-2 block text-[10px] uppercase tracking-[0.2em]">
                  {t('editModal.sectionLabel')}
                </span>
                <div className="flex flex-wrap gap-2">
                  {sections.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() =>
                        setEditing({ ...editing, category: editing.category === c ? undefined : c })
                      }
                      className={`btn-press rounded-sm border px-3 py-2 text-xs ${editing.category === c ? 'border-brand-primary bg-surface text-ink' : 'border-line text-ink-mute hover:border-line-hi'}`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Btn variant="secondary" onClick={() => setEditing(null)} full>
                {t('editModal.cancelBtn')}
              </Btn>
              <Btn
                full
                onClick={() => {
                  if (!editing.name) return;
                  if (editing.id) {
                    setServices((prev) => prev.map((s) => (s.id === editing.id ? editing : s)));
                  } else {
                    setServices((prev) => [...prev, { ...editing, id: 's' + Date.now() }]);
                  }
                  setEditing(null);
                }}
              >
                {t('editModal.saveBtn')}
              </Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// =============================================================================
// Stock (CRUD)
// =============================================================================
interface StockProps {
  products: Product[];
  setProducts: (next: Product[] | ((prev: Product[]) => Product[])) => void;
}

function ManagerStock({ products, setProducts }: StockProps) {
  const t = useTranslations('manager.stock');
  const fmt = useFmtMoney();
  const tenantSession = useTenantOrNull();
  const localProfile = useSalonProfile();
  const currency = tenantSession?.tenant.currency ?? localProfile.currency;
  const [editing, setEditing] = useState<Product | null>(null);
  const blank: Product = {
    id: '',
    name: '',
    priceCents: 0,
    costCents: 0,
    stock: 0,
    low: 5,
    sku: '',
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-10 md:px-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Tag tone="copper">{t('eyebrow')}</Tag>
          <h2 className="display mt-3 text-4xl">{t('title')}</h2>
        </div>
        <Btn icon={Plus as LucideIcon} onClick={() => setEditing({ ...blank })}>
          {t('addBtn')}
        </Btn>
      </div>

      <Card className="overflow-hidden">
        {/* Table à défilement horizontal sur mobile — les colonnes gardent leur gabarit. */}
        <div className="scrollbar overflow-x-auto">
          <div className="border-line mono text-ink-soft grid min-w-[720px] grid-cols-[1fr_100px_100px_100px_100px_140px] gap-3 border-b px-5 py-3 text-[9px] uppercase tracking-[0.25em]">
            <div>{t('colProduct')}</div>
            <div>{t('colCost')}</div>
            <div>{t('colPrice')}</div>
            <div>{t('colStock')}</div>
            <div>{t('colThreshold')}</div>
            <div className="text-end">{t('colActions')}</div>
          </div>
          {products.map((p) => {
            const marginPct =
              p.costCents > 0
                ? Math.round(((p.priceCents - p.costCents) / p.priceCents) * 100)
                : null;
            return (
              <div
                key={p.id}
                className="border-line grid min-w-[720px] grid-cols-[1fr_100px_100px_100px_100px_140px] items-center gap-3 border-b px-5 py-4 last:border-0"
              >
                <div>
                  <div className="flex items-center gap-2 font-semibold">
                    {p.name}
                    {p.stock <= p.low && <AlertTriangle className="text-red h-3.5 w-3.5" />}
                  </div>
                  <div className="mono text-ink-soft text-[10px] uppercase tracking-wider">
                    {p.sku}
                  </div>
                </div>
                <div className="mono text-ink-mute">
                  {p.costCents > 0 ? fmt(p.costCents) : <span className="text-ink-faint">—</span>}
                </div>
                <div className="mono">
                  {fmt(p.priceCents)}
                  {marginPct !== null && (
                    <span className="text-brand-primary/70 mono ms-1 text-[9px]">
                      +{marginPct}%
                    </span>
                  )}
                </div>
                <div
                  className={`mono font-semibold ${
                    p.stock <= p.low ? 'text-red' : p.stock === 0 ? 'text-ink-soft' : ''
                  }`}
                >
                  {p.stock}
                </div>
                <div className="mono text-ink-mute">{p.low}</div>
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setProducts((prev) =>
                        prev.map((x) => (x.id === p.id ? { ...x, stock: x.stock + 10 } : x)),
                      )
                    }
                    className="btn-press bg-surface-elev hover:bg-surface-hi mono rounded-sm px-3 py-1.5 text-xs"
                  >
                    +10
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(p)}
                    className="btn-press bg-surface-elev hover:bg-surface-hi rounded-sm p-2"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setProducts((prev) => prev.filter((x) => x.id !== p.id))}
                    className="btn-press bg-surface-elev hover:bg-red/20 hover:text-red rounded-sm p-2"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
          {products.length === 0 && (
            <div className="text-ink-mute px-5 py-14 text-center text-sm">{t('empty')}</div>
          )}
        </div>
      </Card>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? t('editModal.editTitle') : t('editModal.newTitle')}
      >
        {editing && (
          <div className="space-y-4">
            <Input
              label={t('editModal.nameLabel')}
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
            <Input
              label={t('editModal.skuLabel')}
              value={editing.sku}
              onChange={(e) => setEditing({ ...editing, sku: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label={t('editModal.costLabel', { currency })}
                type="number"
                value={(editing.costCents / 100).toString()}
                onChange={(e) =>
                  setEditing({ ...editing, costCents: Math.round(+e.target.value * 100) })
                }
              />
              <Input
                label={t('editModal.priceLabel', { currency })}
                type="number"
                value={(editing.priceCents / 100).toString()}
                onChange={(e) =>
                  setEditing({ ...editing, priceCents: Math.round(+e.target.value * 100) })
                }
              />
            </div>
            {editing.costCents > 0 && editing.priceCents > 0 && (
              <p className="mono text-ink-soft text-[10px]">
                {t('editModal.marginLabel')} :{' '}
                <span className="text-brand-primary font-semibold">
                  {Math.round(
                    ((editing.priceCents - editing.costCents) / editing.priceCents) * 100,
                  )}
                  %
                </span>{' '}
                · {t('editModal.profitLabel')} :{' '}
                <span className="text-brand-primary font-semibold">
                  {((editing.priceCents - editing.costCents) / 100).toFixed(2)} {currency}
                </span>
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Input
                label={t('editModal.stockLabel')}
                type="number"
                value={editing.stock.toString()}
                onChange={(e) => setEditing({ ...editing, stock: +e.target.value })}
              />
              <Input
                label={t('editModal.thresholdLabel')}
                type="number"
                value={editing.low.toString()}
                onChange={(e) => setEditing({ ...editing, low: +e.target.value })}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Btn variant="secondary" onClick={() => setEditing(null)} full>
                {t('editModal.cancelBtn')}
              </Btn>
              <Btn
                full
                onClick={() => {
                  if (!editing.name) return;
                  if (editing.id) {
                    setProducts((prev) => prev.map((p) => (p.id === editing.id ? editing : p)));
                  } else {
                    setProducts((prev) => [...prev, { ...editing, id: 'p' + Date.now() }]);
                  }
                  setEditing(null);
                }}
              >
                {t('editModal.saveBtn')}
              </Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* Performance produits — visible uniquement en tenant réel */}
      <ProductStatsCard periodDays={30} />
    </div>
  );
}

// =============================================================================
// Paramètres — profil salon (logo, nom, contact, branding)
// =============================================================================
function ManagerSettings() {
  const t = useTranslations('manager.settings');
  const tAudit = useTranslations('manager.auditLog');
  const tErrors = useTranslations('manager.errors');
  const dayLabels = useDayLabels();
  const tenantSession = useTenantOrNull();
  const localProfile = useSalonProfile();
  const [, startTransition] = useTransition();
  const [auditModalOpen, setAuditModalOpen] = useState(false);

  // Source de vérité : DB si tenant connecté, sinon localStorage (mode démo publique).
  // Au jalon 3+, on retirera complètement le fallback localStorage de ManagerSettings.
  const stored: SalonProfile = useMemo(
    () =>
      tenantSession
        ? {
            name: tenantSession.tenant.name,
            managerName: tenantSession.settings.legal_name ?? '',
            tagline: tenantSession.settings.tagline ?? '',
            logoDataUrl: tenantSession.branding.logo_url,
            brandPrimary: tenantSession.branding.brand_primary,
            currency: tenantSession.tenant.currency,
            address: tenantSession.settings.address_street ?? '',
            city: tenantSession.settings.address_city ?? '',
            zip: tenantSession.settings.address_zip ?? '',
            branch: tenantSession.settings.branch ?? '',
            phone: tenantSession.settings.contact_phone ?? '',
            email: tenantSession.settings.contact_email ?? '',
            website: tenantSession.settings.contact_website ?? '',
            instagram: tenantSession.settings.contact_instagram ?? '',
            // Défaut = planning par défaut SÉRIALISÉ (pas '') : le planning
            // AFFICHÉ par l'éditeur devient aussi celui ENREGISTRÉ au save.
            // (Avant : '' → l'éditeur montrait un défaut jamais capturé dans le
            // draft → "Enregistrer" sans toucher les horaires persistait null.)
            hours: tenantSession.settings.hours_text ?? JSON.stringify(DEFAULT_WEEK_SCHEDULE),
            mapsUrl: tenantSession.settings.maps_url ?? '',
            cashbackRateBp: tenantSession.settings.cashback_rate_bp ?? 250,
            taxRateBp: tenantSession.settings.tax_rate_bp ?? 0,
            emailFromAddress: tenantSession.settings.email_from_address ?? '',
          }
        : localProfile,
    [tenantSession, localProfile],
  );

  const [draft, setDraft] = useState<SalonProfile>(stored);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Resync quand le contexte serveur change (après revalidatePath).
  // `stored` est mémoïsé → identité stable tant que tenantSession/localProfile ne bougent pas.
  useEffect(() => {
    setDraft(stored);
  }, [stored]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(stored);

  const onPickLogo = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 800_000) {
      alert(t('identity.logoTooLarge', { size: Math.round(file.size / 1024) }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setDraft({ ...draft, logoDataUrl: dataUrl });
    };
    reader.readAsDataURL(file);
  };

  const save = () => {
    setSaveError(null);
    // Toujours sauvegarder en localStorage pour le mode démo et le cache UI.
    writeSalonProfile(draft);

    if (tenantSession) {
      // Mode tenant authentifié : persiste en DB via Server Action.
      setSaving(true);
      startTransition(async () => {
        const result = await updateSalonProfile({
          name: draft.name,
          legal_name: draft.managerName || null,
          currency: draft.currency,
          brand_primary: draft.brandPrimary,
          tagline: draft.tagline || null,
          logo_url: draft.logoDataUrl,
          address_street: draft.address || null,
          address_city: draft.city || null,
          address_zip: draft.zip || null,
          branch: draft.branch || null,
          contact_phone: draft.phone || null,
          contact_email: draft.email || null,
          contact_website: draft.website || null,
          contact_instagram: draft.instagram || null,
          hours_text: draft.hours || null,
          maps_url: draft.mapsUrl || null,
          cashback_rate_bp: draft.cashbackRateBp,
          tax_rate_bp: draft.taxRateBp,
          email_from_address: draft.emailFromAddress || null,
        });
        setSaving(false);
        if (result.ok) {
          setSaved(true);
          setTimeout(() => setSaved(false), 2500);
        } else {
          setSaveError(tErrors(result.errorKey, result.errorValues));
        }
      });
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  };

  const reset = () => setDraft(stored);

  // Lien espace booking client — sous-domaine dédié (single-tenant, plus de slug).
  const [bookingUrl, setBookingUrl] = useState(SALON.spaces.book);
  const [urlCopied, setUrlCopied] = useState(false);
  useEffect(() => {
    setBookingUrl(SALON.spaces.book);
  }, []);
  const copyBookingUrl = () => {
    void navigator.clipboard.writeText(bookingUrl);
    setUrlCopied(true);
    setTimeout(() => setUrlCopied(false), 2000);
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 md:px-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Tag tone="copper">{t('eyebrow')}</Tag>
          <h2 className="display mt-3 text-4xl">
            {t('titleBefore')}
            <span className="display-i text-brand-glow">{t('titleAccent')}</span>
          </h2>
          <p className="text-ink-mute mt-2 max-w-xl text-sm">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          {dirty && !saving && (
            <button
              type="button"
              onClick={reset}
              className="mono text-ink-mute btn-press hover:text-ink text-[10px] uppercase tracking-[0.25em]"
            >
              {t('cancelBtn')}
            </button>
          )}
          {saved && (
            <span className="mono text-green animate-fade-up flex items-center gap-2 text-[10px] uppercase tracking-wider">
              <Check className="h-3 w-3" /> {t('savedBtn')}
            </span>
          )}
          {saveError && (
            <span className="mono text-red flex items-center gap-2 text-[10px] uppercase tracking-wider">
              ⚠ {saveError}
            </span>
          )}
          <Btn onClick={save} disabled={!dirty || saving} icon={Check as LucideIcon}>
            {saving ? t('savingBtn') : t('saveBtn')}
          </Btn>
        </div>
      </div>

      {/* ── Lien espace réservation client ─────────────────────────────── */}
      <div className="border-brand-primary/25 bg-brand-primary/6 mb-8 flex flex-wrap items-center justify-between gap-4 rounded-sm border px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="bg-brand-primary/15 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
            <ExternalLink className="text-brand-primary h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <div className="mono text-ink-soft mb-0.5 text-[9px] uppercase tracking-[0.25em]">
              {t('bookingUrl.label')}
            </div>
            <div className="mono text-brand-primary truncate text-sm font-medium">{bookingUrl}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={copyBookingUrl}
            className={`mono btn-press border-line flex items-center gap-1.5 rounded-sm border px-4 py-2 text-[9px] uppercase tracking-wider transition-colors ${
              urlCopied
                ? 'border-green/40 text-green'
                : 'text-ink-mute hover:border-line-hi hover:text-ink'
            }`}
          >
            <Copy className="h-3 w-3" />
            {urlCopied ? t('bookingUrl.copiedBtn') : t('bookingUrl.copyBtn')}
          </button>
          <a
            href={bookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mono btn-press bg-brand-primary/12 border-brand-primary/30 text-brand-primary flex items-center gap-1.5 rounded-sm border px-4 py-2 text-[9px] uppercase tracking-wider transition-opacity hover:opacity-80"
          >
            <ExternalLink className="h-3 w-3" />
            {t('bookingUrl.openBtn')}
          </a>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Aperçu live */}
        <div className="lg:sticky lg:top-32 lg:self-start">
          <div className="mono text-ink-soft mb-3 text-[10px] uppercase tracking-[0.3em]">
            {t('preview.header')}
          </div>
          <Card className="overflow-hidden p-0">
            <div className="border-line bg-bg-soft flex items-center gap-3 border-b p-4">
              {draft.logoDataUrl ? (
                <img
                  src={draft.logoDataUrl}
                  alt={draft.name}
                  className="border-line h-10 w-10 rounded-full border object-cover"
                />
              ) : (
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full border"
                  style={{ borderColor: draft.brandPrimary }}
                >
                  <Scissors
                    className="h-4 w-4"
                    style={{ color: draft.brandPrimary }}
                    strokeWidth={2}
                  />
                </div>
              )}
              <div className="min-w-0">
                <div className="display truncate text-base leading-none">{draft.name}</div>
                <div className="mono text-ink-soft mt-1 truncate text-[9px] uppercase tracking-[0.25em]">
                  {draft.tagline}
                </div>
              </div>
            </div>
            <div className="text-ink-mute space-y-2 p-4 text-xs">
              <div className="flex items-start gap-2">
                <Building2 className="text-ink-soft mt-0.5 h-3 w-3" strokeWidth={1.5} />
                <div>
                  <div className="text-ink">{draft.address}</div>
                  <div>
                    {draft.zip} {draft.city}
                    {draft.branch && ` · ${draft.branch}`}
                  </div>
                </div>
              </div>
              {draft.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="text-ink-soft h-3 w-3" strokeWidth={1.5} />
                  <span className="mono">{draft.phone}</span>
                </div>
              )}
              {draft.email && (
                <div className="flex items-center gap-2">
                  <Mail className="text-ink-soft h-3 w-3" strokeWidth={1.5} />
                  <span>{draft.email}</span>
                </div>
              )}
              {(() => {
                const s = parseWeekSchedule(draft.hours);
                if (!s) return null;
                const sum = generateHoursSummary(s, dayLabels);
                if (!sum || sum === dayLabels.closed) return null;
                return (
                  <div className="flex items-start gap-2">
                    <Clock className="text-ink-soft mt-0.5 h-3 w-3 shrink-0" strokeWidth={1.5} />
                    <span className="text-[10px] leading-relaxed">{sum}</span>
                  </div>
                );
              })()}
            </div>
          </Card>
        </div>

        {/* Form */}
        <div className="space-y-8">
          {/* Identité */}
          <section>
            <div className="mono text-ink-soft mb-4 text-[10px] uppercase tracking-[0.3em]">
              {t('identity.section')}
            </div>

            <div className="mb-5 flex items-center gap-5">
              <div className="border-line bg-surface-elev relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-sm border">
                {draft.logoDataUrl ? (
                  <img
                    src={draft.logoDataUrl}
                    alt={t('identity.logoAlt')}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ImageIcon className="text-ink-soft h-8 w-8" strokeWidth={1.2} />
                )}
              </div>
              <div className="flex-1">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onPickLogo(f);
                  }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Btn
                    variant="secondary"
                    size="sm"
                    icon={Upload as LucideIcon}
                    onClick={() => fileRef.current?.click()}
                  >
                    {draft.logoDataUrl ? t('identity.replaceLogoBtn') : t('identity.uploadLogoBtn')}
                  </Btn>
                  {draft.logoDataUrl && (
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, logoDataUrl: null })}
                      className="mono text-red btn-press text-[10px] uppercase tracking-wider hover:underline"
                    >
                      {t('identity.removeBtn')}
                    </button>
                  )}
                </div>
                <p className="mono text-ink-soft mt-2 text-[10px] uppercase tracking-wider">
                  {t('identity.logoHint')}
                </p>
              </div>
            </div>

            <div className="mb-4">
              <Input
                label={t('identity.managerNameLabel')}
                value={draft.managerName}
                onChange={(e) => setDraft({ ...draft, managerName: e.target.value })}
                placeholder={t('identity.managerNamePlaceholder')}
                maxLength={80}
              />
            </div>

            {/* Couleur d'accent : fonctionnalité retirée (inutile pour un salon
                unique). L'accent est désormais un gris neutre fixe, défini dans
                `src/config/salon.ts` + `globals.css`. */}
            <Input
              label={t('identity.salonNameLabel')}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder={t('identity.salonNamePlaceholder')}
              maxLength={64}
            />

            <div className="mt-4">
              <Input
                label={t('identity.taglineLabel')}
                value={draft.tagline}
                onChange={(e) => setDraft({ ...draft, tagline: e.target.value })}
                placeholder={t('identity.taglinePlaceholder')}
                maxLength={64}
              />
            </div>
          </section>

          {/* Programme cashback — configuration du taux par tenant */}
          <section>
            <div className="mono text-ink-soft mb-4 text-[10px] uppercase tracking-[0.3em]">
              {t('cashback.section')}
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <div>
                <Input
                  label={t('cashback.rateLabel')}
                  type="number"
                  step="0.1"
                  min={0}
                  max={15}
                  // L'input expose un POURCENTAGE lisible (2.5) mais on stocke
                  // en basis points en DB (250). Conversion à la volée.
                  value={(draft.cashbackRateBp / 100).toString()}
                  onChange={(e) => {
                    const pct = parseFloat(e.target.value);
                    if (Number.isNaN(pct)) {
                      setDraft({ ...draft, cashbackRateBp: 0 });
                      return;
                    }
                    // Borne [0, 15] % côté UI ; serveur revalide [0, 1500] bp
                    const clamped = Math.max(0, Math.min(15, pct));
                    setDraft({
                      ...draft,
                      cashbackRateBp: Math.round(clamped * 100),
                    });
                  }}
                  placeholder="2.5"
                />
                <p className="mono text-ink-soft mt-1.5 text-[10px] uppercase tracking-wider">
                  {t('cashback.rateHint')}
                </p>
              </div>
              <div
                className="border-line bg-surface-elev rounded-sm border px-4 py-3 text-center"
                style={{ minWidth: 140 }}
              >
                <div className="mono text-ink-soft text-[9px] uppercase tracking-wider">
                  {t('cashback.previewLabel')}
                </div>
                <div className="display text-ink mt-1 text-lg">
                  {(draft.cashbackRateBp / 100).toFixed(2)}
                  {' EGP'}
                </div>
                <div className="text-ink-soft text-[10px]">{t('cashback.previewSubtitle')}</div>
              </div>
            </div>

            {/* TVA — affichee sur les recus uniquement si > 0. Cas par defaut
                pour un petit salon non-assujetti (EG/FR) = 0, donc aucune
                ligne TVA n'apparait sur les recus. Audit T5.25. */}
            <div className="mt-5">
              <Input
                label={t('tax.rateLabel')}
                type="number"
                step="0.5"
                min={0}
                max={30}
                value={(draft.taxRateBp / 100).toString()}
                onChange={(e) => {
                  const pct = parseFloat(e.target.value);
                  if (Number.isNaN(pct)) {
                    setDraft({ ...draft, taxRateBp: 0 });
                    return;
                  }
                  const clamped = Math.max(0, Math.min(30, pct));
                  setDraft({ ...draft, taxRateBp: Math.round(clamped * 100) });
                }}
                placeholder="0"
              />
              <p className="mono text-ink-soft mt-1.5 text-[10px] uppercase tracking-wider">
                {t('tax.rateHint')}
              </p>
            </div>

            {/* Email sender custom — branding white-label. Sans config,
                les emails partent de noreply@system-aone.com. Avec config,
                ex. noreply@aboodhairsalon.com. Pre-requis : DNS verifie
                dans Resend (DKIM + SPF + DMARC). */}
            <div className="mt-5">
              <Input
                label={t('emailSender.label')}
                type="email"
                value={draft.emailFromAddress}
                onChange={(e) => setDraft({ ...draft, emailFromAddress: e.target.value })}
                placeholder="noreply@votresalon.com"
                maxLength={120}
              />
              <p className="mono text-ink-soft mt-1.5 text-[10px] uppercase tracking-wider">
                {t('emailSender.hint')}
              </p>
            </div>
          </section>

          {/* Adresse */}
          <section>
            <div className="mono text-ink-soft mb-4 text-[10px] uppercase tracking-[0.3em]">
              {t('address.section')}
            </div>
            <div className="space-y-4">
              <Input
                label={t('address.streetLabel')}
                value={draft.address}
                onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                placeholder={t('address.streetPlaceholder')}
              />
              <div className="grid grid-cols-[120px_1fr] gap-3">
                <Input
                  label={t('address.zipLabel')}
                  value={draft.zip}
                  onChange={(e) => setDraft({ ...draft, zip: e.target.value })}
                  placeholder={t('address.zipPlaceholder')}
                />
                <Input
                  label={t('address.cityLabel')}
                  value={draft.city}
                  onChange={(e) => setDraft({ ...draft, city: e.target.value })}
                  placeholder={t('address.cityPlaceholder')}
                />
              </div>
              <Input
                label={t('address.branchLabel')}
                value={draft.branch}
                onChange={(e) => setDraft({ ...draft, branch: e.target.value })}
                placeholder={t('address.branchPlaceholder')}
                maxLength={80}
              />
              <div>
                <Input
                  label={t('address.mapsUrlLabel')}
                  type="url"
                  value={draft.mapsUrl}
                  onChange={(e) => setDraft({ ...draft, mapsUrl: e.target.value })}
                  placeholder={t('address.mapsUrlPlaceholder')}
                  maxLength={500}
                />
                <p className="mono text-ink-soft mt-1.5 text-[10px] uppercase tracking-wider">
                  {t('address.mapsUrlHint')}
                </p>
              </div>
            </div>
          </section>

          {/* Contact */}
          <section>
            <div className="mono text-ink-soft mb-4 text-[10px] uppercase tracking-[0.3em]">
              {t('contact.section')}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label={t('contact.phoneLabel')}
                type="tel"
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                placeholder={t('contact.phonePlaceholder')}
              />
              <Input
                label={t('contact.emailLabel')}
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                placeholder={t('contact.emailPlaceholder')}
              />
              <Input
                label={t('contact.websiteLabel')}
                value={draft.website}
                onChange={(e) => setDraft({ ...draft, website: e.target.value })}
                placeholder={t('contact.websitePlaceholder')}
              />
              <Input
                label={t('contact.instagramLabel')}
                value={draft.instagram}
                onChange={(e) => setDraft({ ...draft, instagram: e.target.value })}
                placeholder={t('contact.instagramPlaceholder')}
              />
            </div>
          </section>

          {/* Horaires */}
          <section>
            <div className="mono text-ink-soft mb-4 text-[10px] uppercase tracking-[0.3em]">
              {t('hours.section')}
            </div>
            <OpeningHoursEditor
              value={parseWeekSchedule(draft.hours) ?? DEFAULT_WEEK_SCHEDULE}
              onChange={(schedule) => setDraft({ ...draft, hours: JSON.stringify(schedule) })}
            />
          </section>

          {/* Galerie photos — vitrine affichée côté /client. Visible uniquement
              en tenant réel : les server actions exigent requireTenant(). */}
          {tenantSession && <GalleryEditor />}

          {/* Notifications push — visible uniquement en tenant réel (le hook
              countPushSubscriptions exige une session + tenant_id) */}
          {tenantSession && <PushNotificationsCard />}

          {/* Journal d'audit — bouton qui ouvre une modale read-only avec
              les 50 dernieres modifications tracees. Visible uniquement si
              le manager est connecte (mode tenant reel). Audit T5.28. */}
          {tenantSession && (
            <div className="border-line mt-6 border-t pt-6">
              <div className="mono text-ink-soft mb-2 text-[10px] uppercase tracking-[0.3em]">
                {tAudit('section')}
              </div>
              <p className="text-ink-mute mb-3 text-xs">{tAudit('sectionHint')}</p>
              <button
                type="button"
                onClick={() => setAuditModalOpen(true)}
                className="btn-press border-line hover:border-brand-primary inline-flex items-center gap-2 rounded-sm border px-3 py-2 text-xs"
              >
                <History className="h-4 w-4" strokeWidth={1.5} />
                <span className="mono uppercase tracking-wider">{tAudit('openBtn')}</span>
              </button>
            </div>
          )}

          {/* Save bar mobile */}
          <div className="border-line flex items-center justify-between gap-3 border-t pt-6">
            <div className="mono text-ink-soft text-[10px] uppercase tracking-wider">
              {dirty ? t('dirtyHint') : t('cleanHint')}
            </div>
            <Btn onClick={save} disabled={!dirty} icon={Check as LucideIcon}>
              {t('saveBtn')}
            </Btn>
          </div>
        </div>
      </div>

      {/* Modale du journal d'audit (T5.28) */}
      <AuditLogModal open={auditModalOpen} onClose={() => setAuditModalOpen(false)} />
    </div>
  );
}
