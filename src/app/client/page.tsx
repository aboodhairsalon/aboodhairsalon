'use client';

import Image from 'next/image';
import {
  AtSign,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  Gift,
  Globe,
  Home,
  LogOut,
  Mail,
  MapPin,
  MapPinHouse,
  Phone,
  Plus,
  Receipt,
  ReceiptText,
  Share2,
  Sparkles,
  Star,
  Store,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Btn } from '@/components';

import { LocaleSwitcher } from '../_components/LocaleSwitcher';
import { ServiceIcon } from '../_components/ServiceIcon';
import { StaffPhoto } from '../_components/StaffPhoto';
import { useTenantOrNull } from '../_components/TenantProvider';
import { useToast } from '../_components/Toast';
import { useFmtMoney } from '../_data/local-state';
import {
  INITIAL_BOOKINGS,
  INITIAL_SERVICES,
  INITIAL_STAFF,
  barbersOf,
  todayStr,
  type Barber,
  type Booking,
  type Service,
} from '../_data/mock';
import { createBookingPublic } from './booking-public-action';
import {
  getClientBookings,
  cancelClientBooking,
  getTakenSlots,
  type ClientBookingRow,
} from './bookings-actions';
import { DAYS_FR, parseWeekSchedule, type DayKey } from '../manager/OpeningHoursEditor';
import {
  checkClientPhoneAvailable,
  deleteClientAccount,
  getClientProfile,
  upsertClientProfile,
} from './profile-actions';
import {
  getBarberRatings,
  getBarberReviews,
  getReviewableVisits,
  submitReview,
  type BarberRating,
  type BarberReview,
  type ReviewableVisit,
} from './review-actions';
import { getClientSales, type ClientSaleItem } from './profile-actions';
import { loginClient, requestClientPasswordReset, logoutClient } from './auth-actions';
import { InstallPwaButton } from './InstallPwaButton';
import { ShareSalonModal } from './ShareSalonModal';
import { verifyClientTokenAction } from './token-verify-action';
import { downloadReceiptPdfServer } from './receipt-pdf-action';

const DOW = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'] as const;

// Palette light — partagée avec tous les composants client
const LC = {
  bg: '#F4F3F0',
  card: '#FFFFFF',
  cardBorder: '#E4E2DC',
  cardShadow: '0 4px 32px rgba(40,35,28,0.09), 0 1px 4px rgba(40,35,28,0.06)',
  title: '#18160F',
  subtitle: '#8A8478',
  inputBg: '#EEECEA',
  inputBorder: '#DEDAD3',
  inputBorderFocus: '#3A3630',
  btn: '#1A1714',
  btnText: '#FFFFFF',
  back: '#A8A49C',
  separator: '#E4E2DC',
};

/**
 * Initiales pour un placeholder de logo — extrait les 2 premiers caractères
 * VISIBLES (graphèmes Unicode) du nom du salon. `.slice(0, 2)` sur une
 * chaîne arabe ou émoji renvoie des fragments UTF-16 corrompus (les
 * caractères arabes occupent 1 unité chacun mais les diacritiques peuvent
 * être combinés, et un emoji est un surrogate pair = 2 unités → slice
 * coupe au milieu). `Array.from` itère par code points, ce qui marche
 * pour quasi tous les cas réels. Audit T5.5.
 *
 * @example salonInitials('Abood Hair Salon') // 'AB'
 * @example salonInitials('أبود لاند') // 'أب'
 * @example salonInitials('💈 Carmine') // '💈C' (l'emoji compte pour 1)
 */
function salonInitials(name: string): string {
  return Array.from(name).slice(0, 2).join('').toUpperCase();
}

/**
 * InstagramIcon — SVG inline (lucide-react@1.16 ne l'expose pas, et on évite
 * d'upgrader la dep juste pour une icône). Strokes identiques aux autres
 * Lucide icons : 24×24 viewBox, stroke-width paramétrable, currentColor pour
 * hériter de la couleur parent.
 */
function InstagramIcon({
  className = '',
  strokeWidth = 1.5,
}: {
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

// ─── ClientNav — navigation légère light ─────────────────────────────────────

/** Définition des onglets : clé + icône uniquement. Le libellé est résolu
 *  à l'affichage via `t(`tabs.${key}`)` pour rester réactif au changement
 *  de langue sans avoir à dupliquer la structure. */
const CLIENT_TABS = [
  { key: 'home', icon: Home },
  { key: 'book', icon: Calendar },
  { key: 'mine', icon: ReceiptText },
  { key: 'info', icon: MapPinHouse },
  { key: 'profile', icon: UserRound },
] as const;

/** Ordre d'affichage dans la bottom nav mobile — Réserver est isolé au centre
 *  en FAB, les 4 autres tabs encadrent 2+2. */
const MOBILE_NAV_SIDE_TABS = [
  { key: 'home' as const, icon: Home },
  { key: 'mine' as const, icon: ReceiptText },
  { key: 'info' as const, icon: MapPinHouse },
  { key: 'profile' as const, icon: UserRound },
];

function ClientNav({
  salonName,
  logoUrl,
  tab,
  setTab,
}: {
  salonName: string;
  logoUrl: string | null;
  tab: string;
  setTab: (t: string) => void;
}) {
  const t = useTranslations('client.tabs');
  return (
    <header
      className="sticky top-0 z-30"
      style={{
        background: 'rgba(244,243,240,0.94)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: `1px solid ${LC.separator}`,
      }}
    >
      {/* Desktop row */}
      <div className="mx-auto hidden max-w-3xl items-center justify-between gap-4 px-6 py-3 sm:flex">
        {/* Logo + nom */}
        <div className="flex items-center gap-2.5">
          {logoUrl ? (
            <Image
              src={logoUrl}
              alt={salonName}
              width={32}
              height={32}
              className="h-8 w-8 rounded-xl object-cover"
              style={{ border: `1px solid ${LC.cardBorder}` }}
              unoptimized
            />
          ) : (
            <div
              className="flex h-8 w-8 items-center justify-center rounded-xl text-xs font-bold"
              style={{ background: LC.btn, color: LC.btnText }}
            >
              {salonInitials(salonName)}
            </div>
          )}
          <span className="display text-sm" style={{ color: LC.title }}>
            {salonName}
          </span>
        </div>
        {/* Onglets */}
        <nav className="flex items-center gap-1">
          {CLIENT_TABS.map((td) => (
            <button
              key={td.key}
              type="button"
              onClick={() => setTab(td.key)}
              className="btn-press flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all"
              style={{
                background: tab === td.key ? LC.btn : 'transparent',
                color: tab === td.key ? LC.btnText : LC.back,
              }}
            >
              <td.icon className="h-3.5 w-3.5" strokeWidth={2} />
              {t(td.key)}
            </button>
          ))}
        </nav>
        {/* Sélecteur de langue — coin droit, n'apparaît qu'en desktop
            (sur mobile, accessible via la barre du bas + accueil). */}
        <div className="hidden sm:block">
          <LocaleSwitcher variant="auth" />
        </div>
      </div>
    </header>
  );
}

// ─── Stars — affichage d'une note /5 en lecture seule ────────────────────────

const STAR_GOLD = '#E0A23D';

function Stars({ value, className = 'h-3.5 w-3.5' }: { value: number; className?: string }) {
  const tReviews = useTranslations('client.reviewsModal');
  const rounded = Math.round(value);
  return (
    <span
      className="inline-flex items-center gap-0.5"
      aria-label={tReviews('ratingAria', { value })}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={className}
          strokeWidth={1.5}
          style={
            n <= rounded
              ? { color: STAR_GOLD, fill: STAR_GOLD }
              : { color: LC.cardBorder, fill: 'none' }
          }
        />
      ))}
    </span>
  );
}

// ─── BarberReviewsModal — avis consultables d'un barbier ─────────────────────

function BarberReviewsModal({
  tenantId,
  barber,
  onClose,
}: {
  tenantId: string;
  barber: Barber;
  onClose: () => void;
}) {
  const t = useTranslations('client.reviewsModal');
  const tErrors = useTranslations('client.errors');
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<BarberReview[]>([]);
  const [avg, setAvg] = useState(0);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Chargement des avis
  useEffect(() => {
    let alive = true;
    getBarberReviews(tenantId, barber.id)
      .then((r) => {
        if (!alive) return;
        if (r.ok) {
          setReviews(r.reviews);
          setAvg(r.avg);
          setCount(r.count);
        } else {
          setError(tErrors(r.errorKey as 'dbError', r.errorValues));
        }
      })
      .catch(() => {
        if (alive) setError(t('errorLoad'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tenantId, barber.id, t, tErrors]);

  // Fermeture au clavier (Échap) + verrou du scroll de l'arrière-plan
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50">
      {/* Voile cliquable */}
      <button
        type="button"
        aria-label={t('closeAria')}
        onClick={onClose}
        className="absolute inset-0"
        style={{
          background: 'rgba(24,22,15,0.5)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
        }}
      />
      {/* Conteneur du panneau */}
      <div className="pointer-events-none absolute inset-0 flex items-end justify-center sm:items-center">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('modalAria', { name: barber.name })}
          className="pointer-events-auto flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-3xl sm:max-w-md sm:rounded-3xl"
          style={{
            background: LC.bg,
            border: `1px solid ${LC.cardBorder}`,
            boxShadow: '0 -8px 48px rgba(40,35,28,0.22)',
          }}
        >
          {/* Poignée (mobile) */}
          <div className="flex justify-center pt-2.5 sm:hidden">
            <div className="h-1 w-9 rounded-full" style={{ background: LC.cardBorder }} />
          </div>

          {/* En-tête */}
          <div
            className="flex items-center gap-3 px-5 py-4"
            style={{ borderBottom: `1px solid ${LC.separator}` }}
          >
            <StaffPhoto
              photoUrl={barber.photoUrl}
              initials={barber.initials}
              tone={barber.tone}
              className="display h-11 w-11 text-lg"
            />
            <div className="min-w-0 flex-1">
              <div className="display text-lg leading-tight" style={{ color: LC.title }}>
                {barber.name}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <Stars value={avg} className="h-3 w-3" />
                <span className="mono text-[10px]" style={{ color: LC.subtitle }}>
                  {count > 0
                    ? t('averageWithCount', { avg: avg.toFixed(1), count })
                    : t('noReviews')}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('closeBtnAria')}
              className="btn-press flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
              style={{ background: LC.inputBg, color: LC.back }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Corps */}
          <div className="scrollbar flex-1 overflow-y-auto px-5 py-4">
            {loading && (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="animate-pulse rounded-2xl"
                    style={{ background: LC.inputBg, height: 92 }}
                  />
                ))}
              </div>
            )}

            {error && !loading && (
              <p
                className="rounded-xl border px-3 py-2 text-sm"
                style={{
                  color: '#B91C1C',
                  borderColor: 'rgba(185,28,28,0.3)',
                  background: 'rgba(185,28,28,0.07)',
                }}
              >
                {error}
              </p>
            )}

            {!loading && !error && reviews.length === 0 && (
              <div className="py-12 text-center">
                <Star className="mx-auto mb-3 h-9 w-9" strokeWidth={1} style={{ color: LC.back }} />
                <div className="display text-lg" style={{ color: LC.title }}>
                  {t('emptyTitle')}
                </div>
                <p className="mt-1 text-sm" style={{ color: LC.subtitle }}>
                  {t('emptySubtitleNamed', { name: barber.name })}
                </p>
              </div>
            )}

            {!loading && !error && reviews.length > 0 && (
              <div className="space-y-3">
                {reviews.map((rev) => (
                  <div
                    key={rev.id}
                    className="rounded-2xl p-4"
                    style={{
                      background: LC.card,
                      border: `1px solid ${LC.cardBorder}`,
                      boxShadow: LC.cardShadow,
                    }}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <Stars value={rev.rating} className="h-3.5 w-3.5" />
                      <span
                        className="mono text-[9px] uppercase tracking-[0.15em]"
                        style={{ color: LC.back }}
                      >
                        {new Date(rev.date).toLocaleDateString('fr-FR', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                    {rev.comment && (
                      <p className="text-sm leading-relaxed" style={{ color: LC.title }}>
                        {rev.comment}
                      </p>
                    )}
                    <div className="mt-2 text-xs font-medium" style={{ color: LC.subtitle }}>
                      — {rev.clientName}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ClientPage() {
  const tenantSession = useTenantOrNull();
  const tTabs = useTranslations('client.tabs');
  const tClientErrors = useTranslations('client.errors');
  const toast = useToast();

  // Données réelles si tenant connecté, mocks Maison Lefèvre sinon (démo publique).
  const services = tenantSession ? tenantSession.collections.services : INITIAL_SERVICES;
  const barbers = barbersOf(tenantSession ? tenantSession.collections.staff : INITIAL_STAFF);
  // Galerie photos — vide en mode démo (pas de mock).
  const gallery = tenantSession?.collections.gallery ?? [];
  // Nom affiché dans le flow : tagline ou nom du salon.
  const salonName = tenantSession?.tenant.name ?? 'Maison Lefèvre';
  // Slug du tenant — vide en mode démo (la modale de partage gère ce cas).
  const slug = tenantSession?.tenant.slug ?? '';

  const [tab, setTab] = useState('home');
  const [shareOpen, setShareOpen] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>(tenantSession ? [] : INITIAL_BOOKINGS);
  // Lightbox galerie — `null` = fermée, sinon index de la photo affichée.
  const [galleryLightboxIdx, setGalleryLightboxIdx] = useState<number | null>(null);

  // Téléphone du client — persisté dans localStorage pour la fidélité.
  const [phone, setPhone] = useState('');
  useEffect(() => {
    // Priorité 1 : paramètre `?t={token}` signé — extrait du QR caisse ou
    // d'un email reçu. Le token HMAC contient {tenant, phone, exp 90j} et est
    // vérifié serveur-side via verifyClientTokenAction. Si valide, on hydrate
    // le state + localStorage avec le phone et on retire le token de l'URL.
    //
    // Fallback `?p={phone}` (ancien format en clair) : accepté pendant une
    // période de compat pour les QR déjà imprimés en boutique. À retirer
    // d'ici quelques mois quand le stock de QR aura tourné.
    const params = (() => {
      try {
        return new URLSearchParams(window.location.search);
      } catch {
        return null;
      }
    })();
    const token = params?.get('t')?.trim();
    const legacyPhone = params?.get('p')?.trim();

    const cleanUrl = () => {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('t');
        url.searchParams.delete('p');
        window.history.replaceState({}, '', url.toString());
      } catch {
        // Pas critique si l'API History n'est pas dispo.
      }
    };

    if (token) {
      // Vérif côté serveur (signature HMAC + expiration + match tenant).
      void verifyClientTokenAction(token).then((res) => {
        if (res.ok) {
          setPhone(res.phone);
          localStorage.setItem('sysA_client_phone', res.phone);
          setTab('profile');
        } else {
          // Audit T5.18 : avant, échec silencieux → client tappait sur le
          // QR/lien depuis un vieil email, le token avait expiré (90j) et
          // rien n'indiquait pourquoi il atterrissait sur l'accueil sans
          // être connecté. On expose désormais un toast explicite.
          toast.error(tClientErrors('tokenInvalid'));
        }
        cleanUrl();
      });
      return;
    }
    if (legacyPhone) {
      setPhone(legacyPhone);
      localStorage.setItem('sysA_client_phone', legacyPhone);
      setTab('profile');
      cleanUrl();
      return;
    }
    // Priorité 3 : localStorage (sessions précédentes).
    const stored = localStorage.getItem('sysA_client_phone');
    if (stored) setPhone(stored);
  }, []);

  const savePhone = (p: string) => {
    setPhone(p);
    if (p) {
      localStorage.setItem('sysA_client_phone', p);
    } else {
      localStorage.removeItem('sysA_client_phone');
    }
  };

  const addBooking = (b: Booking) => setBookings((prev) => [...prev, b]);

  // ─── FETCH RDV depuis la DB (audit pre-launch 2026-05-23) ─────────────────
  // AVANT : `bookings` était initialisé à `[]` pour tenant connecté et JAMAIS
  // rafraîchi. Un client qui réservait, fermait l'app, puis revenait voyait
  // « Aucun RDV » alors que son RDV existait en DB. UX cassée à ~80% des
  // visiteurs marketing (qui ne restent pas en session continue).
  //
  // FIX : à chaque changement de phone OU tenantId, on re-fetch la liste
  // serveur (rate-limit Upstash 10/min phone + 30/min IP couvre l'abus).
  // Mapping du shape DB → shape `Booking` local consommé par les onglets.
  useEffect(() => {
    if (!tenantSession || !phone) return;
    let alive = true;
    void getClientBookings(tenantSession.tenant.id, phone).then((r) => {
      if (!alive || !r.ok) return;
      const mapped: Booking[] = r.bookings.map((row: ClientBookingRow) => ({
        id: row.id,
        clientName: row.clientName || phone,
        serviceId: row.serviceId ?? '',
        barberId: row.barberId ?? '',
        date: row.date,
        time: row.time,
        // Map DB status → UI status. Les 5 statuts DB se mappent sur 3 UI :
        // upcoming|in_chair → 'upcoming' (RDV vivant)
        // done             → 'done'
        // cancelled|no_show → 'cancelled' (slot libéré)
        // On préserve `noShow` à part pour différencier le libellé Mes RDV
        // (« Manqué » vs « Annulé ») — l'utilisateur sait ce qui s'est passé.
        status:
          row.status === 'upcoming' || row.status === 'in_chair'
            ? 'upcoming'
            : row.status === 'done'
              ? 'done'
              : 'cancelled',
        noShow: row.status === 'no_show',
        paid: row.paid,
        amountCents: row.amountCents,
      }));
      setBookings(mapped);
    });
    return () => {
      alive = false;
    };
  }, [tenantSession, phone]);

  /** Annulation d'un RDV — server action atomique avec garde tenant + phone.
   *  Met à jour l'état local optimistement, puis rollback si l'action échoue.
   *  AVANT : la fonction ne faisait QUE du local state (mensonge total). */
  const cancelBooking = useCallback(
    async (id: string) => {
      if (!tenantSession || !phone) {
        // Mode démo / pas authentifié : on garde l'ancien comportement local.
        setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, status: 'cancelled' } : b)));
        return;
      }
      // Optimistic UI : on flip à 'cancelled' immédiatement.
      setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, status: 'cancelled' } : b)));
      const res = await cancelClientBooking(tenantSession.tenant.id, phone, id);
      if (!res.ok) {
        // Rollback + re-fetch pour re-sync la vérité serveur.
        void getClientBookings(tenantSession.tenant.id, phone).then((r) => {
          if (r.ok) {
            const mapped: Booking[] = r.bookings.map((row: ClientBookingRow) => ({
              id: row.id,
              clientName: row.clientName || phone,
              serviceId: row.serviceId ?? '',
              barberId: row.barberId ?? '',
              date: row.date,
              time: row.time,
              status:
                row.status === 'upcoming' || row.status === 'in_chair'
                  ? 'upcoming'
                  : row.status === 'done'
                    ? 'done'
                    : 'cancelled',
              noShow: row.status === 'no_show',
              paid: row.paid,
              amountCents: row.amountCents,
            }));
            setBookings(mapped);
          }
        });
        // Erreur traduite via le système de toasts (cf. ToastProvider posé
        // dans client/layout.tsx) — fini le window.alert() français hardcodé
        // qui cassait en EN/AR. La clé i18n correspond directement au code
        // d'erreur server (bookingTooSoonToCancel, bookingNotCancellable,
        // rateLimited, etc. — toutes ajoutées à client.errors.*).
        toast.error(tClientErrors(res.errorKey as 'dbError', res.errorValues));
      }
    },
    [tenantSession, phone],
  );

  // Note: on a SUPPRIMÉ l'ancien early-return "tab === 'profile' && !phone"
  // qui rendait le ProfileTab en plein écran sans nav. Le user perdait alors
  // l'accès aux autres onglets sans se loguer — friction inutile. Maintenant
  // l'écran login s'affiche AVEC la nav du bas, donc on peut toujours revenir
  // à Accueil / Réserver / Mes RDV / Le Salon sans authentification.

  return (
    <main className="min-h-screen pb-20 sm:pb-0" style={{ background: LC.bg }}>
      <ClientNav
        salonName={salonName}
        logoUrl={tenantSession?.branding.logo_url ?? null}
        tab={tab}
        setTab={setTab}
      />
      {tab === 'home' && (
        <ClientHome
          phone={phone}
          services={services}
          bookings={bookings}
          gallery={gallery}
          setTab={setTab}
          onOpenShare={() => setShareOpen(true)}
          onOpenGalleryPhoto={(idx) => setGalleryLightboxIdx(idx)}
        />
      )}
      {tab === 'book' && (
        <ClientBookingFlow
          services={services}
          barbers={barbers}
          bookings={bookings}
          addBooking={addBooking}
          salonName={salonName}
          phone={phone}
          onPhoneSaved={savePhone}
        />
      )}
      {tab === 'mine' && (
        <ClientMyBookings
          bookings={bookings}
          services={services}
          barbers={barbers}
          cancelBooking={cancelBooking}
        />
      )}
      {tab === 'info' && <SalonInfoTab />}
      {tab === 'profile' && <ProfileTab phone={phone} onPhoneChange={savePhone} />}

      {/* ── Barre de navigation mobile — design pro avec FAB central ──────
          Layout : [Accueil] [Mes RDV] [ FAB + ] [Le Salon] [Profil]
          Le bouton Réserver est un FAB circulaire surélevé qui flotte au
          centre de la nav — pattern Instagram/Snap/Twitter. Plus visible,
          plus tactile, et il signale l'action primaire du salon (réserver). */}
      <nav
        className="fixed bottom-0 end-0 start-0 z-30 sm:hidden"
        style={{
          background: 'rgba(244,243,240,0.96)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderTop: `1px solid ${LC.separator}`,
          // Padding safe-area pour les iPhones avec home indicator
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div className="relative grid grid-cols-5 items-end">
          {/* 2 tabs à gauche du FAB */}
          {MOBILE_NAV_SIDE_TABS.slice(0, 2).map((td) => (
            <button
              key={td.key}
              type="button"
              onClick={() => setTab(td.key)}
              className="btn-press flex flex-col items-center gap-1 py-3 text-[10px] font-semibold transition-colors"
              style={{ color: tab === td.key ? LC.btn : LC.back }}
              aria-label={tTabs(td.key)}
            >
              <td.icon className="h-6 w-6" strokeWidth={tab === td.key ? 2.2 : 1.7} />
              <span className="leading-none">{tTabs(td.key)}</span>
            </button>
          ))}

          {/* FAB central — Réserver (surélevé au-dessus de la nav) */}
          <div className="relative flex items-end justify-center">
            <button
              type="button"
              onClick={() => setTab('book')}
              aria-label={tTabs('book')}
              className="btn-press absolute -top-7 flex h-[60px] w-[60px] items-center justify-center rounded-full transition-all"
              style={{
                background: tab === 'book' ? LC.btn : LC.btn,
                color: LC.btnText,
                boxShadow:
                  tab === 'book'
                    ? '0 8px 24px rgba(26,23,20,0.45), 0 0 0 4px rgba(244,243,240,0.96)'
                    : '0 6px 18px rgba(26,23,20,0.32), 0 0 0 4px rgba(244,243,240,0.96)',
              }}
            >
              <Plus className="h-7 w-7" strokeWidth={2.4} style={{ color: LC.btnText }} />
            </button>
            {/* Spacer + label sous le FAB pour aligner les autres tabs */}
            <span
              className="pb-3 pt-9 text-[10px] font-semibold leading-none"
              style={{ color: tab === 'book' ? LC.btn : LC.back }}
            >
              {tTabs('book')}
            </span>
          </div>

          {/* 2 tabs à droite du FAB */}
          {MOBILE_NAV_SIDE_TABS.slice(2).map((td) => (
            <button
              key={td.key}
              type="button"
              onClick={() => setTab(td.key)}
              className="btn-press flex flex-col items-center gap-1 py-3 text-[10px] font-semibold transition-colors"
              style={{ color: tab === td.key ? LC.btn : LC.back }}
              aria-label={tTabs(td.key)}
            >
              <td.icon className="h-6 w-6" strokeWidth={tab === td.key ? 2.2 : 1.7} />
              <span className="leading-none">{tTabs(td.key)}</span>
            </button>
          ))}
        </div>
      </nav>

      <ShareSalonModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        salonName={salonName}
        slug={slug}
      />

      {/* Lightbox galerie — modale plein écran avec navigation prev/next.
          Composant inline car couplé à `gallery` + `galleryLightboxIdx` qui
          vivent ici. Pas la peine d'extraire un fichier. */}
      {galleryLightboxIdx !== null && gallery[galleryLightboxIdx] && (
        <GalleryLightbox
          photos={gallery}
          index={galleryLightboxIdx}
          onClose={() => setGalleryLightboxIdx(null)}
          onNavigate={(newIdx) => setGalleryLightboxIdx(newIdx)}
        />
      )}
    </main>
  );
}

/**
 * Lightbox galerie — overlay sombre plein écran avec une photo centrée,
 * la légende en bas et des boutons prev/next sur les côtés.
 * - Clavier : Escape pour fermer, flèches gauche/droite pour naviguer.
 * - Pas d'animation lourde : le simple fade-in du conteneur suffit.
 */
function GalleryLightbox({
  photos,
  index,
  onClose,
  onNavigate,
}: {
  photos: { id: string; photoUrl: string; caption: string | null }[];
  index: number;
  onClose: () => void;
  onNavigate: (newIdx: number) => void;
}) {
  const t = useTranslations('client.home');
  const photo = photos[index];
  // Garde-fou — si l'index est out-of-range (rare), on ferme.
  useEffect(() => {
    if (!photo) onClose();
  }, [photo, onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0) onNavigate(index - 1);
      if (e.key === 'ArrowRight' && index < photos.length - 1) onNavigate(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, photos.length, onClose, onNavigate]);

  if (!photo) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(15, 13, 10, 0.92)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('galleryEyebrow')}
    >
      {/* Close */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="btn-press tap-target absolute end-4 top-4 z-10 inline-flex items-center justify-center rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        aria-label={t('galleryClose')}
      >
        <X className="h-5 w-5" strokeWidth={1.7} />
      </button>

      {/* Prev */}
      {index > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(index - 1);
          }}
          className="btn-press tap-target absolute start-4 z-10 inline-flex items-center justify-center rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          aria-label={t('galleryPrev')}
        >
          <ChevronLeft className="h-6 w-6 rtl:-scale-x-100" strokeWidth={1.7} />
        </button>
      )}

      {/* Next */}
      {index < photos.length - 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(index + 1);
          }}
          className="btn-press tap-target absolute end-4 z-10 inline-flex items-center justify-center rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          aria-label={t('galleryNext')}
        >
          <ChevronRight className="h-6 w-6 rtl:-scale-x-100" strokeWidth={1.7} />
        </button>
      )}

      {/* Photo — Next/Image avec sizes adapté lightbox plein écran pour
          AVIF/WebP + responsive. Le conteneur impose le ratio max via
          object-contain, on laisse Next gérer le srcset/format. Audit T5.4. */}
      <div className="relative max-h-[88vh] max-w-[92vw]" onClick={(e) => e.stopPropagation()}>
        <Image
          src={photo.photoUrl}
          alt={photo.caption ?? t('galleryPhotoAlt', { index: index + 1 })}
          width={1600}
          height={1200}
          sizes="92vw"
          className="max-h-[88vh] max-w-[92vw] rounded-2xl object-contain"
          priority
          unoptimized={photo.photoUrl.startsWith('data:')}
        />
        {photo.caption && (
          <div
            className="absolute inset-x-0 bottom-0 rounded-b-2xl px-5 py-4 text-center text-sm text-white"
            style={{
              background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.65) 100%)',
            }}
          >
            {photo.caption}
          </div>
        )}
        {/* Compteur en haut-gauche, discret */}
        <div className="mono absolute start-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-semibold tracking-wider text-white">
          {index + 1} / {photos.length}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Accueil — écran de landing (salutation, accès rapides, fidélité, vitrine)
// =============================================================================

function ClientHome({
  phone,
  services,
  bookings,
  gallery: galleryProp,
  setTab,
  onOpenShare,
  onOpenGalleryPhoto,
}: {
  phone: string;
  services: Service[];
  bookings: Booking[];
  /** Galerie photos — peut être absente si la table n'existe pas encore en DB
   *  (migration 0026 non appliquée) ou si le tenant n'a pas configuré. */
  gallery?: { id: string; photoUrl: string; caption: string | null }[];
  setTab: (t: string) => void;
  onOpenShare: () => void;
  onOpenGalleryPhoto: (index: number) => void;
}) {
  // Garde défensive — si la table tenant_gallery n'existe pas encore côté DB,
  // certains paths peuvent passer `undefined`. On normalise ici.
  const gallery = galleryProp ?? [];
  const tenantSession = useTenantOrNull();
  const t = useTranslations('client.home');
  const fmt = useFmtMoney();
  const salonName = tenantSession?.tenant.name ?? 'Maison Lefèvre';
  const logoUrl = tenantSession?.branding.logo_url ?? null;
  const tenantId = tenantSession?.tenant.id ?? null;
  const s = tenantSession?.settings;
  const locationLabel = [s?.branch, s?.address_city].filter(Boolean).join(' · ');

  // Profil client — prénom (salutation) + cashback wallet (= 2,5% du montant
  // dépensé). On garde `points` pour l'affichage secondaire en mono ("125 pts").
  const [firstName, setFirstName] = useState<string | null>(null);
  const [points, setPoints] = useState(0);
  const [cashbackCents, setCashbackCents] = useState(0);
  useEffect(() => {
    if (!phone || !tenantId) return;
    let alive = true;
    getClientProfile(tenantId, phone)
      .then((r) => {
        if (alive && r.ok) {
          setFirstName(r.profile.firstName);
          setPoints(r.points);
          setCashbackCents(r.cashbackCents);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [phone, tenantId]);

  // Statut ouvert / fermé d'après les horaires du salon
  const schedule = parseWeekSchedule(s?.hours_text);
  const today = schedule?.[TODAY_KEY];
  const openNow = (() => {
    if (!today?.open || today.slots.length === 0) return false;
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(
      2,
      '0',
    )}`;
    return today.slots.some((sl) => sl.from <= hhmm && hhmm < sl.to);
  })();

  const upcomingCount = bookings.filter((b) => b.status === 'upcoming').length;

  return (
    <div
      className="min-h-screen"
      style={{
        background: `radial-gradient(ellipse 120% 50% at 50% 0%, #ECEAE4 0%, ${LC.bg} 40%, #EDECEA 100%)`,
      }}
    >
      <div className="mx-auto max-w-2xl px-6 py-9">
        {/* ── Header mobile : logo salon + sélecteur de langue ─────────────
            Logo à gauche (présence de marque immédiate), langue à droite.
            Sur desktop, le ClientNav header les affiche déjà → sm:hidden. */}
        <div className="fade-up mb-6 flex items-center justify-between sm:hidden">
          {logoUrl ? (
            <Image
              src={logoUrl}
              alt={salonName}
              width={56}
              height={56}
              className="h-14 w-14 rounded-2xl object-cover"
              style={{
                border: `1px solid ${LC.cardBorder}`,
                boxShadow: '0 4px 16px rgba(40,35,28,0.12)',
              }}
              unoptimized
              priority
            />
          ) : (
            <div
              className="flex h-14 w-14 items-center justify-center rounded-2xl text-base font-bold"
              style={{ background: LC.btn, color: LC.btnText }}
            >
              {salonInitials(salonName)}
            </div>
          )}
          <LocaleSwitcher variant="auth" />
        </div>

        {/* ── Salutation ───────────────────────────────────────────────────── */}
        <div className="fade-up mb-7">
          <div className="mono text-[9px] uppercase tracking-[0.4em]" style={{ color: LC.back }}>
            {salonName}
          </div>
          <h2 className="display mt-2 text-3xl md:text-4xl" style={{ color: LC.title }}>
            {firstName ? t('greetingWithName', { name: firstName }) : t('greeting')}
          </h2>
          <p className="mt-1 text-sm" style={{ color: LC.subtitle }}>
            {t('askToday')}
          </p>
        </div>

        {/* Bouton « Ajouter à l'écran d'accueil » — n'apparaît que si la PWA
            est installable (Chrome/Android via beforeinstallprompt) ou sur
            iOS Safari (tutoriel manuel). Caché si déjà installé. */}
        <InstallPwaButton salonName={salonName} />

        <div className="mb-6">
          <Btn variant="secondary" icon={Share2} onClick={onOpenShare}>
            {t('shareBtn')}
          </Btn>
        </div>

        {/* ── Accès rapides ────────────────────────────────────────────────── */}
        <div className="fade-up delay-1 mb-7 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setTab('book')}
            className="btn-press flex flex-col justify-between rounded-2xl p-5 text-start"
            style={{ background: LC.btn, minHeight: 150, boxShadow: LC.cardShadow }}
          >
            <div
              className="flex h-11 w-11 items-center justify-center rounded-xl"
              style={{ background: 'rgba(255,255,255,0.12)' }}
            >
              <Calendar className="h-5 w-5" strokeWidth={1.5} style={{ color: LC.btnText }} />
            </div>
            <div>
              <div className="display text-lg" style={{ color: LC.btnText }}>
                {t('bookCardTitle')}
              </div>
              <div className="text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
                {t('bookCardSubtitle')}
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setTab('mine')}
            className="btn-press relative flex flex-col justify-between rounded-2xl p-5 text-start"
            style={{
              background: LC.card,
              border: `1px solid ${LC.cardBorder}`,
              minHeight: 150,
              boxShadow: LC.cardShadow,
            }}
          >
            <div
              className="flex h-11 w-11 items-center justify-center rounded-xl"
              style={{ background: LC.inputBg }}
            >
              <Receipt className="h-5 w-5" strokeWidth={1.5} style={{ color: LC.btn }} />
            </div>
            <div>
              <div className="display text-lg" style={{ color: LC.title }}>
                {t('mineCardTitle')}
              </div>
              <div className="text-xs" style={{ color: LC.subtitle }}>
                {upcomingCount > 0
                  ? t('mineCardSubtitleUpcoming', { count: upcomingCount })
                  : t('mineCardSubtitleEmpty')}
              </div>
            </div>
            {upcomingCount > 0 && (
              <span
                className="absolute end-4 top-4 rounded-full px-2 py-0.5 text-xs font-bold"
                style={{ background: LC.btn, color: LC.btnText }}
              >
                {upcomingCount}
              </span>
            )}
          </button>
        </div>

        {/* ── Programme fidélité ───────────────────────────────────────────── */}
        <button
          type="button"
          onClick={() => setTab('profile')}
          className="btn-press fade-up delay-2 mb-7 w-full rounded-2xl p-5 text-start"
          style={{
            // Forçage display:flex en inline pour contourner un cas où la
            // classe Tailwind `flex` n'est pas appliquée au <button> (display
            // par défaut inline-block du navigateur a une spécificité égale
            // sous Tailwind v4 et la classe perd sans !important).
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.875rem',
            background: LC.card,
            border: `1px solid ${LC.cardBorder}`,
            boxShadow: LC.cardShadow,
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="mono text-[9px] uppercase tracking-[0.25em]" style={{ color: LC.back }}>
              {t('loyaltyEyebrow')}
            </div>
            {phone ? (
              // Client connecté → affiche le wallet cashback (montant en monnaie)
              // + les points en sous-titre (granularité fine pour le client qui
              // veut comprendre la mécanique).
              <>
                <div className="mt-1.5 flex items-baseline gap-1.5">
                  <span className="display mono text-3xl leading-none" style={{ color: LC.title }}>
                    {fmt(cashbackCents)}
                  </span>
                </div>
                <div className="mt-1.5 text-xs" style={{ color: LC.subtitle }}>
                  {t('cashbackSubtitle', { points })}
                </div>
              </>
            ) : (
              // Client non connecté → CTA propre (plus de "— point" disgracieux)
              <>
                <div className="display mt-1.5 text-lg leading-tight" style={{ color: LC.title }}>
                  {t('loyaltyCtaTitle')}
                </div>
                <div className="mt-0.5 text-xs" style={{ color: LC.subtitle }}>
                  {t('loyaltyLogin')}
                </div>
              </>
            )}
          </div>
          <div
            className="shrink-0 rounded-full"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 48,
              height: 48,
              background: 'rgba(224,162,61,0.14)',
            }}
          >
            <Gift className="h-5 w-5" strokeWidth={1.5} style={{ color: STAR_GOLD }} />
          </div>
        </button>

        {/* ── Vitrine du salon ─────────────────────────────────────────────── */}
        <button
          type="button"
          onClick={() => setTab('info')}
          className="btn-press fade-up delay-3 mb-7 flex w-full items-center gap-3 rounded-2xl p-4 text-start"
          style={{
            background: LC.card,
            border: `1px solid ${LC.cardBorder}`,
            boxShadow: LC.cardShadow,
          }}
        >
          {logoUrl ? (
            <Image
              src={logoUrl}
              alt={salonName}
              width={48}
              height={48}
              className="h-12 w-12 shrink-0 rounded-xl object-cover"
              style={{ border: `1px solid ${LC.cardBorder}` }}
              unoptimized
            />
          ) : (
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-base font-bold"
              style={{
                background: LC.inputBg,
                color: LC.btn,
                border: `1px solid ${LC.cardBorder}`,
              }}
            >
              {salonInitials(salonName)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="display truncate text-base" style={{ color: LC.title }}>
              {salonName}
            </div>
            {locationLabel && (
              <div
                className="mt-0.5 flex items-center gap-1 truncate text-xs"
                style={{ color: LC.subtitle }}
              >
                <MapPin className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                {locationLabel}
              </div>
            )}
          </div>
          {schedule && (
            <span
              className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold"
              style={
                openNow
                  ? { background: '#E8F5E9', color: '#2E7D32' }
                  : { background: '#FEECEC', color: '#B91C1C' }
              }
            >
              {openNow ? t('openNow') : t('closedNow')}
            </span>
          )}
          <ChevronRight className="h-4 w-4 shrink-0 rtl:-scale-x-100" strokeWidth={1.5} style={{ color: LC.back }} />
        </button>

        {/* ── Prestations en avant ─────────────────────────────────────────── */}
        {services.length > 0 && (
          <div className="fade-up delay-4">
            <div className="mb-3 flex items-center justify-between">
              <span
                className="mono text-[10px] uppercase tracking-[0.3em]"
                style={{ color: LC.back }}
              >
                {t('servicesEyebrow')}
              </span>
              <button
                type="button"
                onClick={() => setTab('book')}
                className="btn-press mono text-[10px] uppercase tracking-wider"
                style={{ color: LC.btn }}
              >
                {t('viewAll')}
              </button>
            </div>
            <div className="scrollbar -mx-6 flex gap-3 overflow-x-auto px-6 pb-1">
              {services.map((sv) => (
                <button
                  key={sv.id}
                  type="button"
                  onClick={() => setTab('book')}
                  className="btn-press flex w-36 shrink-0 flex-col rounded-2xl p-4 text-start"
                  style={{
                    background: LC.card,
                    border: `1px solid ${LC.cardBorder}`,
                    boxShadow: LC.cardShadow,
                  }}
                >
                  <div style={{ color: LC.btn }}>
                    <ServiceIcon iconKey={sv.icon} className="h-6 w-6" />
                  </div>
                  <div className="display mt-3 text-sm leading-tight" style={{ color: LC.title }}>
                    {sv.name}
                  </div>
                  <div className="mono mt-1 text-xs font-semibold" style={{ color: LC.btn }}>
                    {fmt(sv.priceCents)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Galerie photos du salon ──────────────────────────────────────── */}
        {gallery.length > 0 && (
          <div className="fade-up delay-5 mt-7">
            <div className="mb-3 flex items-center justify-between">
              <span
                className="mono text-[10px] uppercase tracking-[0.3em]"
                style={{ color: LC.back }}
              >
                {t('galleryEyebrow')}
              </span>
              {gallery.length > 3 && (
                <span
                  className="mono text-[10px] uppercase tracking-wider"
                  style={{ color: LC.back }}
                >
                  {t('galleryCount', { count: gallery.length })}
                </span>
              )}
            </div>
            <div className="scrollbar -mx-6 flex gap-3 overflow-x-auto px-6 pb-1">
              {gallery.map((photo, idx) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => onOpenGalleryPhoto(idx)}
                  className="btn-press relative w-36 shrink-0 overflow-hidden rounded-2xl"
                  style={{
                    border: `1px solid ${LC.cardBorder}`,
                    boxShadow: LC.cardShadow,
                    aspectRatio: '4 / 5',
                  }}
                  aria-label={photo.caption ?? t('galleryPhotoAlt', { index: idx + 1 })}
                >
                  <img
                    src={photo.photoUrl}
                    alt={photo.caption ?? t('galleryPhotoAlt', { index: idx + 1 })}
                    className="absolute inset-0 h-full w-full object-cover"
                    loading="lazy"
                  />
                  {photo.caption && (
                    <div
                      className="absolute inset-x-0 bottom-0 px-3 pb-2 pt-6 text-start text-[11px] font-medium leading-snug text-white"
                      style={{
                        background:
                          'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 100%)',
                      }}
                    >
                      {photo.caption}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Booking flow — 4 étapes
// =============================================================================
interface BookingFlowProps {
  services: Service[];
  barbers: Barber[];
  bookings: Booking[];
  addBooking: (b: Booking) => void;
  salonName: string;
  /** Téléphone du profil client (issu de localStorage) — lié en silencieux aux RDV. */
  phone: string;
  /** Callback parent qui synchronise simultanément le state `phone` ET le
   *  localStorage. À appeler après création d'un RDV réussie pour que l'onglet
   *  « Mes RDV » trouve immédiatement le RDV via le useEffect [phone].
   *  AVANT, on n'écrivait que dans localStorage → le state restait vide →
   *  `getClientBookings` n'était jamais déclenché → My bookings disait
   *  « Aucun RDV » jusqu'au rafraîchissement de la page. */
  onPhoneSaved: (phone: string) => void;
}

function ClientBookingFlow({
  services,
  barbers,
  bookings,
  addBooking,
  salonName,
  phone,
  onPhoneSaved,
}: BookingFlowProps) {
  const t = useTranslations('client.booking');
  const tCashierErrors = useTranslations('cashier.errors');
  const fmt = useFmtMoney();
  const tenantSession = useTenantOrNull();
  const tagline = tenantSession?.settings.tagline ?? null;
  const city = tenantSession?.settings.address_city ?? null;
  const branch = tenantSession?.settings.branch ?? null;

  const [step, setStep] = useState(1);
  const [clientName, setClientName] = useState('');
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [barberId, setBarberId] = useState<string | null>(null);
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  /** UUID du booking côté DB après création — utilisé pour générer le
   *  lien .ics « Ajouter au calendrier ». Null en mode démo (pas de DB). */
  const [lastBookingId, setLastBookingId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Inscription obligatoire — téléphone + email REQUIS pour confirmer.
  // Pré-rempli depuis le profil DB si le client a déjà un compte (matching
  // via téléphone en localStorage). `profileLoaded` discrimine « inscrit »
  // (firstName + email présents) de « pas inscrit » (mode invité).
  const [regFirstName, setRegFirstName] = useState('');
  const [regLastName, setRegLastName] = useState('');
  const [regPhone, setRegPhone] = useState(phone);
  const [regEmail, setRegEmail] = useState('');
  // Date de naissance OBLIGATOIRE — utilisée pour l'envoi automatique d'un
  // cadeau anniversaire (widget Anniversaires côté Direction). Format YYYY-MM-DD.
  const [regDob, setRegDob] = useState('');
  const [profileLoaded, setProfileLoaded] = useState<boolean | null>(null);

  // Notes moyennes des barbiers + barbier dont les avis sont affichés
  const [ratings, setRatings] = useState<Map<string, BarberRating>>(new Map());
  const [reviewsBarber, setReviewsBarber] = useState<Barber | null>(null);
  const closeReviews = useCallback(() => setReviewsBarber(null), []);

  const service = services.find((s) => s.id === serviceId);
  const barber = barbers.find((b) => b.id === barberId);

  const days = useMemo(
    () =>
      Array.from({ length: 14 }).map((_, i) => {
        const d = new Date();
        d.setDate(d.getDate() + i);
        return {
          iso: d.toISOString().split('T')[0]!,
          dow: DOW[d.getDay()]!,
          dom: d.getDate(),
        };
      }),
    [],
  );

  // ─── allSlots dérivé des HORAIRES RÉELS du salon (audit pre-launch) ─────
  // AVANT : hardcoded 9h-19h, ignorait `tenant_settings.hours_text`.
  // Aboodhairsalon ouvre 09:00→22:00 (et un jour fermé) → tous les créneaux
  // 19h-22h disparaissaient + jours fermés affichés ouverts.
  //
  // Pas 30min entre les sous-créneaux ouverts (ex. "09:00→13:00 + 16:00→22:00"
  // génère 09:00, 09:30, ..., 12:30, puis 16:00, 16:30, ..., 21:30).
  const weekSchedule = useMemo(
    () => parseWeekSchedule(tenantSession?.settings?.hours_text),
    [tenantSession?.settings?.hours_text],
  );
  // Convertit la date ISO YYYY-MM-DD → DayKey (lun..dim).
  const dateDayKey: DayKey | null = useMemo(() => {
    if (!date) return null;
    const jsDay = new Date(date + 'T00:00:00').getDay(); // 0=dim … 6=sam
    const map: DayKey[] = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
    return map[jsDay] ?? null;
  }, [date]);
  const allSlots = useMemo(() => {
    // Plage par défaut 09:00→19:00 (pas de 30 min) — utilisée tant que le gérant
    // n'a pas renseigné ses horaires (Manager → Paramètres → Horaires).
    const defaultSlots = (): string[] => {
      const out: string[] = [];
      for (let h = 9; h < 19; h++) {
        out.push(`${String(h).padStart(2, '0')}:00`);
        out.push(`${String(h).padStart(2, '0')}:30`);
      }
      return out;
    };
    // AUCUN horaire configuré (hours_text vide) → on NE bloque PAS la réservation
    // avec une grille vide : on propose la plage par défaut. (Avant : un tenant
    // connecté sans horaires renvoyait [] → impossible de réserver tant que les
    // horaires n'étaient pas saisis — bug bloquant.)
    if (!weekSchedule) return defaultSlots();
    // Horaires configurés : on respecte le jour sélectionné.
    const day = dateDayKey ? weekSchedule[dateDayKey] : null;
    // Jour explicitement fermé → liste vide (UX claire « pas de créneau »).
    if (!day || !day.open || day.slots.length === 0) return [];
    const out: string[] = [];
    for (const range of day.slots) {
      // Parse "HH:mm" → minutes since midnight pour générer les pas de 30min.
      const [fromH, fromM] = range.from.split(':').map(Number);
      const [toH, toM] = range.to.split(':').map(Number);
      if (fromH === undefined || fromM === undefined || toH === undefined || toM === undefined)
        continue;
      let cursor = fromH * 60 + fromM;
      // `to: "00:00"` (= minuit / fin de journée) → traité comme 24:00 (1440 min).
      // Sinon end=0 < cursor → la boucle ne s'exécute jamais → 0 créneau, et la
      // grille reste vide alors que le gérant a configuré « ouvert jusqu'à minuit ».
      // Bug réel : ré-encodage d'horaires 10:00–00:00 côté manager → 0 créneau client.
      let end = toH * 60 + toM;
      if (end === 0) end = 24 * 60;
      while (cursor < end) {
        const h = Math.floor(cursor / 60);
        const m = cursor % 60;
        out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
        cursor += 30;
      }
    }
    return out;
  }, [dateDayKey, weekSchedule, tenantSession]);

  // Créneaux RÉELLEMENT proposables : on retire ceux déjà passés quand la date
  // sélectionnée est aujourd'hui (sinon le client choisit un horaire écoulé,
  // remplit tout le formulaire, et le serveur le rejette à la toute fin —
  // `dateOutOfRange`). Marge de 15 min pour ne pas proposer un créneau imminent.
  // Hypothèse TZ : client en Égypte (= salon) — même base que le no_show caisse.
  const visibleSlots = useMemo(() => {
    if (!date) return allSlots;
    const now = new Date();
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (date !== todayIso) return allSlots;
    const cutoff = now.getHours() * 60 + now.getMinutes() + 15;
    return allSlots.filter((slot) => {
      const [h, m] = slot.split(':').map(Number);
      return (h ?? 0) * 60 + (m ?? 0) >= cutoff;
    });
  }, [allSlots, date]);

  // ─── takenSlots fetched depuis la DB (audit pre-launch) ────────────────────
  // AVANT : computed depuis `bookings` local qui est vide pour tenant connecté
  // (jamais fetched) → tous les slots affichés disponibles → DOUBLE-BOOKING
  // SYSTÉMATIQUE dès 2 clients concurrents.
  //
  // FIX : à chaque changement de date OU barbier, on appelle getTakenSlots
  // côté serveur (RPC propre, mute la liste réelle des HH:mm pris).
  const [takenSlots, setTakenSlots] = useState<Set<string>>(new Set());
  useEffect(() => {
    const tid = tenantSession?.tenant.id;
    if (!tid || !barberId || !date) {
      // Mode démo / step pas encore atteint : fallback sur bookings locaux.
      setTakenSlots(
        new Set(
          bookings
            .filter((b) => b.date === date && b.barberId === barberId && b.status !== 'cancelled')
            .map((b) => b.time),
        ),
      );
      return;
    }
    let alive = true;
    void getTakenSlots(tid, barberId, date).then((r) => {
      if (!alive || !r.ok) return;
      setTakenSlots(new Set(r.takenTimes));
    });
    return () => {
      alive = false;
    };
  }, [tenantSession, barberId, date, bookings]);

  // Pré-remplit le formulaire d'inscription si le client a déjà un profil
  // pour ce tenant (matching via téléphone localStorage). `profileLoaded` est :
  //   - null  → en cours / pas encore tenté (mode démo)
  //   - true  → profil DB chargé (email présent → considéré « inscrit »)
  //   - false → pas de profil OU profil incomplet (email manquant)
  useEffect(() => {
    const tid = tenantSession?.tenant.id;
    if (!tid) {
      setProfileLoaded(false); // mode démo : pas de profil possible
      return;
    }
    if (!phone) {
      setProfileLoaded(false); // nouveau visiteur : doit s'inscrire
      return;
    }
    let alive = true;
    getClientProfile(tid, phone)
      .then((r) => {
        if (!alive) return;
        if (r.ok) {
          setRegFirstName(r.profile.firstName ?? '');
          setRegLastName(r.profile.lastName ?? '');
          setRegEmail(r.profile.email ?? '');
          setRegPhone(phone);
          setRegDob(r.profile.dateOfBirth ?? '');
          // Considéré inscrit si email présent (le téléphone est garanti)
          setProfileLoaded(Boolean(r.profile.email));
          // Si firstName en DB, pré-remplit aussi le clientName affiché sur
          // le RDV. Pas de guard `!clientName` — le seul cas où ce useEffect
          // re-fire est un changement de tenantId/phone (changement d'identité),
          // donc écraser le clientName courant est le bon comportement.
          if (r.profile.firstName) {
            setClientName(
              [r.profile.firstName, r.profile.lastName].filter(Boolean).join(' ').trim(),
            );
          }
        } else {
          setProfileLoaded(false);
        }
      })
      .catch(() => {
        if (alive) setProfileLoaded(false);
      });
    return () => {
      alive = false;
    };
    // Volontairement on n'inclut PAS `clientName` en deps : on ne veut
    // hydrater le formulaire qu'au mount initial (ou changement de tenant/
    // phone). Re-fire à chaque édition du nom écraserait la saisie en cours.
  }, [tenantSession?.tenant.id, phone]);

  // Charge les notes moyennes des barbiers (tenant réel uniquement).
  useEffect(() => {
    const tid = tenantSession?.tenant.id;
    if (!tid) return;
    let alive = true;
    getBarberRatings(tid)
      .then((r) => {
        if (alive && r.ok) setRatings(new Map(r.ratings.map((x) => [x.barberId, x])));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [tenantSession?.tenant.id]);

  const reset = () => {
    setStep(1);
    setServiceId(null);
    setBarberId(null);
    setTime(null);
    setConfirmed(false);
    setLastBookingId(null);
    // Garde le clientName pour ne pas ressaisir.
  };

  // useRef synchrone pour bloquer le double-clic : `isPending` (useTransition)
  // ne devient true qu'APRÈS un microtask, laissant une fenêtre ~50ms où un
  // mashed-click déclenche 2 createBookingPublic concurrents (race conditions
  // côté slot + duplicate booking). Le rate-limit IP serveur couvre, mais
  // l'UX du 2e click reste mauvaise (« slot pris » message). Bloqué ici en
  // setImmediate-style synchrone.
  const submittingRef = useRef(false);
  const submit = () => {
    if (!service || !barber || !time) return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitError(null);
    startTransition(async () => {
      try {
        // Si le tenant est connecté, persiste en DB
        if (tenantSession) {
          // Validation côté client — duplique la garde serveur pour UX rapide
          // (pas d'aller-retour réseau si manifestement invalide).
          const phoneTrim = regPhone.trim();
          const emailTrim = regEmail.trim();
          const firstNameTrim = regFirstName.trim();
          const dobTrim = regDob.trim();
          if (!phoneTrim || phoneTrim.length < 6) {
            setSubmitError(t('errors.phoneRequired'));
            return;
          }
          if (!emailTrim || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
            setSubmitError(t('errors.emailRequired'));
            return;
          }
          if (!firstNameTrim) {
            setSubmitError(t('errors.firstNameRequired'));
            return;
          }
          if (!dobTrim || !/^\d{4}-\d{2}-\d{2}$/.test(dobTrim)) {
            setSubmitError(t('errors.dobRequired'));
            return;
          }
          // Vérif bornes : pas dans le futur, après 1900
          const dobDate = new Date(dobTrim);
          if (
            Number.isNaN(dobDate.getTime()) ||
            dobDate > new Date() ||
            dobDate.getFullYear() < 1900
          ) {
            setSubmitError(t('errors.dobInvalid'));
            return;
          }
          // Compose le clientName affiché sur le ticket — priorité au prénom/nom
          // du formulaire d'inscription, fallback sur l'ancien champ clientName.
          const composedName =
            [regFirstName.trim(), regLastName.trim()].filter(Boolean).join(' ').trim() ||
            clientName.trim() ||
            t('defaultClientName');
          const result = await createBookingPublic({
            clientName: composedName,
            serviceId: service.id,
            barberId: barber.id,
            date,
            time,
            durationMin: service.duration,
            amountCents: service.priceCents,
            clientPhone: phoneTrim,
            clientEmail: emailTrim,
            clientDateOfBirth: dobTrim,
            clientFirstName: regFirstName.trim() || undefined,
            clientLastName: regLastName.trim() || undefined,
          });
          if (!result.ok) {
            setSubmitError(tCashierErrors(result.errorKey as 'unknownError', result.errorValues));
            return;
          }
          // Sync le téléphone EN MEMOIRE + localStorage. Sans le sync mémoire,
          // le useEffect [phone] qui charge « Mes RDV » ne se redéclenche pas
          // → l'utilisateur voit « Aucun RDV » alors que la DB en a un.
          // `onPhoneSaved` fait setState + localStorage en une passe.
          onPhoneSaved(phoneTrim);
          // Track le booking ID pour le téléchargement .ics « Ajouter au
          // calendrier » sur l'écran de confirmation. Null en mode démo.
          setLastBookingId(result.id ?? null);
          // Mise à jour locale pour affichage immédiat dans "Mes RDV"
          addBooking({
            id: result.id ?? 'r' + Date.now(),
            clientName: clientName.trim() || t('defaultClientName'),
            serviceId: service.id,
            barberId: barber.id,
            date,
            time,
            status: 'upcoming',
            paid: false,
            amountCents: service.priceCents,
          });
        } else {
          // Mode démo : pas de DB, juste l'état local
          addBooking({
            id: 'r' + Date.now(),
            clientName: clientName.trim() || t('defaultClientName'),
            serviceId: service.id,
            barberId: barber.id,
            date,
            time,
            status: 'upcoming',
            paid: false,
            amountCents: service.priceCents,
          });
        }
        setConfirmed(true);
      } finally {
        // Reset toujours, même sur early returns / exceptions — sinon le
        // bouton reste lock-out après une erreur de validation.
        submittingRef.current = false;
      }
    });
  };

  // ── Confirmation ──────────────────────────────────────────────────────────
  if (confirmed && service && barber && time) {
    return (
      <div
        className="min-h-screen"
        style={{
          background: `radial-gradient(ellipse 120% 50% at 50% 0%, #ECEAE4 0%, ${LC.bg} 40%, #EDECEA 100%)`,
        }}
      >
        <div className="fade-up mx-auto max-w-xl px-6 py-16 text-center">
          <div
            className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full"
            style={{ background: LC.inputBg, border: `2px solid ${LC.btn}` }}
          >
            <Check className="h-10 w-10" strokeWidth={1.5} style={{ color: LC.btn }} />
          </div>
          <div
            className="mono mb-4 text-[9px] uppercase tracking-[0.4em]"
            style={{ color: LC.back }}
          >
            {t('confirmedEyebrow')}
          </div>
          <h2 className="display mb-3 text-4xl" style={{ color: LC.title }}>
            {t('confirmedTitle')}
          </h2>
          <p className="mb-8 text-sm" style={{ color: LC.subtitle }}>
            {t('confirmedSubtitle')}
          </p>
          <div
            className="mb-6 p-6 text-start"
            style={{
              background: LC.card,
              border: `1px solid ${LC.cardBorder}`,
              boxShadow: LC.cardShadow,
              borderRadius: '1rem',
            }}
          >
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div
                  className="mono mb-1 text-[9px] uppercase tracking-[0.2em]"
                  style={{ color: LC.back }}
                >
                  {t('confirmedService')}
                </div>
                <div className="font-semibold" style={{ color: LC.title }}>
                  {service.name}
                </div>
              </div>
              <div>
                <div
                  className="mono mb-1 text-[9px] uppercase tracking-[0.2em]"
                  style={{ color: LC.back }}
                >
                  {t('summaryWith')}
                </div>
                <div className="font-semibold" style={{ color: LC.title }}>
                  {barber.name}
                </div>
              </div>
              <div>
                <div
                  className="mono mb-1 text-[9px] uppercase tracking-[0.2em]"
                  style={{ color: LC.back }}
                >
                  {t('summaryDate')}
                </div>
                <div className="font-semibold capitalize" style={{ color: LC.title }}>
                  {new Date(date).toLocaleDateString('fr-FR', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                </div>
              </div>
              <div>
                <div
                  className="mono mb-1 text-[9px] uppercase tracking-[0.2em]"
                  style={{ color: LC.back }}
                >
                  {t('summaryTime')}
                </div>
                <div className="mono font-semibold" style={{ color: LC.title }}>
                  {time}
                </div>
              </div>
            </div>
            <div className="my-4 border-t" style={{ borderColor: LC.separator }} />
            <div className="flex items-baseline justify-between">
              <span className="text-sm" style={{ color: LC.subtitle }}>
                {t('confirmedAmount')}
              </span>
              <span className="display mono text-3xl" style={{ color: LC.title }}>
                {fmt(service.priceCents)}
              </span>
            </div>
          </div>
          {/* Bouton « Ajouter au calendrier » — visible uniquement quand
              on a un vrai bookingId (mode tenant, pas démo). Télécharge un
              fichier .ics qui ouvre directement Apple Calendar / Google
              Calendar / Outlook avec un rappel 1h avant le RDV pré-armé. */}
          {lastBookingId && (
            <a
              // Path tenant-aware : on dérive le préfixe depuis le pathname
              // courant (avant `/client`). Couvre les 3 modes de résolution
              // tenant :
              //   - custom_domain (aboodhairsalon.com/client/...) → préfixe ''
              //   - subdomain (aboodhairsalon.system-a.com/client/...) → ''
              //   - path-based (app.system-a.com/aboodhairsalon/client/...) → '/aboodhairsalon'
              // Sans ça, le path-based renvoyait 404 sur la route ICS car
              // l'URL résultait à `/client/booking/{id}/ics` sans contexte
              // tenant → middleware ne pouvait pas résoudre (audit T2.7).
              href={(() => {
                if (typeof window === 'undefined') return `/client/booking/${lastBookingId}/ics`;
                const path = window.location.pathname;
                const idx = path.indexOf('/client');
                const prefix = idx > 0 ? path.slice(0, idx) : '';
                return `${prefix}/client/booking/${lastBookingId}/ics`;
              })()}
              download
              className="btn-press mb-3 block w-full rounded-xl py-3.5 text-center text-sm font-semibold"
              style={{
                background: LC.card,
                color: LC.title,
                border: `1px solid ${LC.btn}`,
              }}
            >
              {t('addToCalendar')}
            </a>
          )}
          <button
            type="button"
            onClick={reset}
            className="btn-press w-full rounded-xl py-3.5 text-sm font-semibold"
            style={{ background: LC.btn, color: LC.btnText }}
          >
            {t('bookAgain')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen"
      style={{
        background: `radial-gradient(ellipse 120% 50% at 50% 0%, #ECEAE4 0%, ${LC.bg} 40%, #EDECEA 100%)`,
      }}
    >
      <div className="mx-auto max-w-3xl px-6 py-10">
        {/* Hero salon */}
        <div className="mb-8">
          <div
            className="mono mb-2 text-[9px] uppercase tracking-[0.4em]"
            style={{ color: LC.back }}
          >
            {t('heroEyebrow')}
          </div>
          <h2 className="display mt-1 text-4xl md:text-5xl" style={{ color: LC.title }}>
            {salonName}
          </h2>
          {(tagline || city || branch) && (
            <p className="mt-2 flex items-center gap-1.5 text-sm" style={{ color: LC.subtitle }}>
              {(city || branch) && <MapPin className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />}
              {tagline ? (
                <span>{tagline}</span>
              ) : (
                <>
                  {city && <span>{city}</span>}
                  {city && branch && <span style={{ color: LC.cardBorder }}>·</span>}
                  {branch && (
                    <span className="font-medium" style={{ color: LC.title }}>
                      {branch}
                    </span>
                  )}
                </>
              )}
            </p>
          )}
        </div>

        {/* Barre de progression */}
        <div className="mb-8 flex gap-2">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className="h-1 flex-1 rounded-full transition-all"
              style={{ background: step >= n ? LC.btn : LC.inputBg }}
            />
          ))}
        </div>

        {/* ── Étape 1 : Prestation ───────────────────────────────────────────── */}
        {step === 1 && (
          <div className="fade-up">
            <h3
              className="mono mb-4 text-[10px] uppercase tracking-[0.3em]"
              style={{ color: LC.back }}
            >
              {t('step1Header')}
            </h3>
            {/* Grid 2 colonnes même sur mobile — cards carré arrondi.
                Sur sm+, le ratio reste mais le contenu respire un peu plus. */}
            <div className="grid grid-cols-2 gap-3">
              {services.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setServiceId(s.id);
                    setStep(2);
                  }}
                  className={`btn-press fade-up flex cursor-pointer flex-col rounded-2xl border p-3.5 text-start transition-all delay-${(i % 6) + 1}`}
                  style={{
                    background: LC.card,
                    borderColor: serviceId === s.id ? LC.btn : LC.cardBorder,
                    boxShadow:
                      serviceId === s.id
                        ? '0 0 28px rgba(40,35,28,0.24), 0 0 2px rgba(40,35,28,0.16)'
                        : '0 0 20px rgba(40,35,28,0.14), 0 0 1px rgba(40,35,28,0.10)',
                    aspectRatio: '1 / 1',
                    minHeight: 160,
                  }}
                >
                  <div className="flex flex-1 items-center justify-center py-3">
                    <div
                      className="flex h-16 w-16 items-center justify-center rounded-2xl"
                      style={{ background: LC.inputBg, color: LC.btn }}
                    >
                      <ServiceIcon iconKey={s.icon} className="h-8 w-8" />
                    </div>
                  </div>
                  <div className="display text-base leading-tight" style={{ color: LC.title }}>
                    {s.name}
                  </div>
                  <div className="mt-1.5 flex items-end justify-between">
                    <div
                      className="mono text-[9px] uppercase tracking-[0.2em]"
                      style={{ color: LC.back }}
                    >
                      <Clock className="me-1 inline h-3 w-3" />
                      {s.duration} min
                    </div>
                    <span className="mono text-[13px] font-semibold" style={{ color: LC.title }}>
                      {fmt(s.priceCents)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Étape 2 : Barbier ──────────────────────────────────────────────── */}
        {step === 2 && (
          <div className="fade-up">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="btn-press mono mb-6 flex items-center gap-2 text-[10px] uppercase tracking-[0.25em]"
              style={{ color: LC.back }}
            >
              <ChevronLeft className="h-3 w-3 rtl:-scale-x-100" /> {t('modifyService')}
            </button>
            <h3
              className="mono mb-4 text-[10px] uppercase tracking-[0.3em]"
              style={{ color: LC.back }}
            >
              {t('step2Header')}
            </h3>
            <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
              {/* Sans préférence */}
              <button
                type="button"
                onClick={() => {
                  setBarberId(barbers[0]?.id ?? null);
                  setStep(3);
                }}
                className="btn-press flex flex-col items-center justify-center gap-1.5 rounded-2xl border p-3 text-center transition-all sm:p-4"
                style={{ background: LC.card, borderColor: LC.cardBorder }}
              >
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-full"
                  style={{ background: LC.inputBg, border: `1px solid ${LC.cardBorder}` }}
                >
                  <Sparkles className="h-5 w-5" style={{ color: LC.btn }} strokeWidth={1.5} />
                </div>
                <div className="display text-base leading-tight" style={{ color: LC.title }}>
                  {t('noPreference')}
                </div>
                <div className="text-[10px]" style={{ color: LC.subtitle }}>
                  {t('firstAvailable')}
                </div>
              </button>

              {/* Barbiers — note /5 + avis consultables */}
              {barbers.map((b) => {
                const rating = ratings.get(b.id);
                const avg = rating?.avg ?? 0;
                const count = rating?.count ?? 0;
                const hasReviews = count > 0;
                const isSelected = barberId === b.id;
                return (
                  <div
                    key={b.id}
                    className="flex flex-col overflow-hidden rounded-2xl border transition-all"
                    style={{
                      background: LC.card,
                      borderColor: isSelected ? LC.btn : LC.cardBorder,
                      boxShadow: isSelected ? LC.cardShadow : undefined,
                    }}
                  >
                    {/* Sélection du barbier */}
                    <button
                      type="button"
                      onClick={() => {
                        setBarberId(b.id);
                        setStep(3);
                      }}
                      className="btn-press flex flex-1 flex-col items-center gap-1.5 p-3 text-center sm:p-4"
                    >
                      <StaffPhoto
                        photoUrl={b.photoUrl}
                        initials={b.initials}
                        tone={b.tone}
                        className="display h-12 w-12 text-xl"
                      />
                      <div
                        className="display w-full truncate text-base leading-tight"
                        style={{ color: LC.title }}
                      >
                        {b.name}
                      </div>
                      <div
                        className="mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                        style={{ background: 'rgba(224,162,61,0.12)' }}
                      >
                        <Star
                          className="h-3 w-3"
                          strokeWidth={1.5}
                          style={{ color: STAR_GOLD, fill: STAR_GOLD }}
                        />
                        <span
                          className="mono text-[11px] font-bold leading-none"
                          style={{ color: LC.title }}
                        >
                          {avg.toFixed(1)}
                          <span className="font-semibold" style={{ color: LC.back }}>
                            /5
                          </span>
                        </span>
                      </div>
                    </button>
                    {/* Avis consultables */}
                    <button
                      type="button"
                      onClick={() => setReviewsBarber(b)}
                      className="btn-press flex items-center justify-center gap-1 py-2 text-[10px] font-semibold transition-colors"
                      style={{
                        background: LC.inputBg,
                        borderTop: `1px solid ${LC.separator}`,
                        color: LC.subtitle,
                      }}
                    >
                      {hasReviews ? t('reviewsCount', { count }) : t('viewReviews')}
                      <ChevronRight className="h-3 w-3 rtl:-scale-x-100" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Étape 3 : Date & heure ─────────────────────────────────────────── */}
        {step === 3 && (
          <div className="fade-up">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="btn-press mono mb-6 flex items-center gap-2 text-[10px] uppercase tracking-[0.25em]"
              style={{ color: LC.back }}
            >
              <ChevronLeft className="h-3 w-3 rtl:-scale-x-100" /> {t('modifyBarber')}
            </button>
            <h3
              className="mono mb-4 text-[10px] uppercase tracking-[0.3em]"
              style={{ color: LC.back }}
            >
              {t('step3Header')}
            </h3>
            <div className="scrollbar -mx-6 mb-6 flex gap-2 overflow-x-auto px-6 pb-2">
              {days.map((d) => (
                <button
                  key={d.iso}
                  type="button"
                  onClick={() => setDate(d.iso)}
                  className="btn-press w-16 shrink-0 rounded-2xl border py-3 text-center transition-all"
                  style={
                    date === d.iso
                      ? { background: LC.btn, borderColor: LC.btn, color: LC.btnText }
                      : { background: LC.card, borderColor: LC.cardBorder, color: LC.back }
                  }
                >
                  <div className="mono text-[10px] uppercase tracking-wider">{d.dow}</div>
                  <div className="display mt-1 text-2xl">{d.dom}</div>
                </button>
              ))}
            </div>
            {visibleSlots.length === 0 && (
              <div
                className="rounded-2xl border py-8 text-center text-sm"
                style={{ background: LC.card, borderColor: LC.cardBorder, color: LC.back }}
              >
                {t('noSlots')}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {visibleSlots.map((t) => {
                const taken = takenSlots.has(t);
                return (
                  <button
                    key={t}
                    type="button"
                    disabled={taken}
                    onClick={() => {
                      if (!taken) {
                        setTime(t);
                        setStep(4);
                      }
                    }}
                    className="btn-press mono rounded-2xl border py-3 text-sm transition-all"
                    style={
                      taken
                        ? {
                            background: LC.card,
                            borderColor: LC.cardBorder,
                            color: LC.back,
                            opacity: 0.3,
                            textDecoration: 'line-through',
                            cursor: 'not-allowed',
                          }
                        : time === t
                          ? { background: LC.btn, borderColor: LC.btn, color: LC.btnText }
                          : { background: LC.card, borderColor: LC.cardBorder, color: LC.title }
                    }
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Étape 4 : Confirmation ─────────────────────────────────────────── */}
        {step === 4 && service && barber && time && (
          <div className="fade-up">
            <button
              type="button"
              onClick={() => setStep(3)}
              className="btn-press mono mb-6 flex items-center gap-2 text-[10px] uppercase tracking-[0.25em]"
              style={{ color: LC.back }}
            >
              <ChevronLeft className="h-3 w-3 rtl:-scale-x-100" /> {t('modifyDate')}
            </button>
            <h3
              className="mono mb-4 text-[10px] uppercase tracking-[0.3em]"
              style={{ color: LC.back }}
            >
              {t('step4Header')}
            </h3>

            {/* Avis ponctualité — en tête du récap : prévient le client qu'un
                retard peut faire sauter son créneau (les RDV s'enchaînent).
                Ton ambre = information importante mais non bloquante, même
                style que le bandeau d'inscription pour rester cohérent. */}
            <div
              className="mb-4 flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-xs"
              style={{
                background: 'rgba(224,162,61,0.12)',
                border: '1px solid rgba(224,162,61,0.35)',
                color: '#7A5320',
              }}
            >
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
              <span>{t('punctualityNotice')}</span>
            </div>

            {/* Résumé */}
            <div
              className="mb-4 p-6"
              style={{
                background: LC.card,
                border: `1px solid ${LC.cardBorder}`,
                boxShadow: LC.cardShadow,
                borderRadius: '1rem',
              }}
            >
              <div
                className="flex items-center justify-between border-b pb-4"
                style={{ borderColor: LC.separator }}
              >
                <div>
                  <div className="display text-2xl" style={{ color: LC.title }}>
                    {service.name}
                  </div>
                  <div className="mt-1 text-xs" style={{ color: LC.subtitle }}>
                    {service.desc}
                  </div>
                </div>
                <div className="display mono text-3xl" style={{ color: LC.title }}>
                  {fmt(service.priceCents)}
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div
                    className="mono mb-1 text-[9px] uppercase tracking-[0.2em]"
                    style={{ color: LC.back }}
                  >
                    {t('summaryWith')}
                  </div>
                  <div className="font-semibold" style={{ color: LC.title }}>
                    {barber.name}
                  </div>
                </div>
                <div>
                  <div
                    className="mono mb-1 text-[9px] uppercase tracking-[0.2em]"
                    style={{ color: LC.back }}
                  >
                    {t('summaryDuration')}
                  </div>
                  <div className="mono font-semibold" style={{ color: LC.title }}>
                    {service.duration} min
                  </div>
                </div>
                <div>
                  <div
                    className="mono mb-1 text-[9px] uppercase tracking-[0.2em]"
                    style={{ color: LC.back }}
                  >
                    {t('summaryDate')}
                  </div>
                  <div className="font-semibold capitalize" style={{ color: LC.title }}>
                    {new Date(date).toLocaleDateString('fr-FR', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    })}
                  </div>
                </div>
                <div>
                  <div
                    className="mono mb-1 text-[9px] uppercase tracking-[0.2em]"
                    style={{ color: LC.back }}
                  >
                    {t('summaryTime')}
                  </div>
                  <div className="mono font-semibold" style={{ color: LC.title }}>
                    {time}
                  </div>
                </div>
              </div>
            </div>

            {/* Teaser cashback — affiché uniquement si le salon a un taux > 0
                ET qu'on est sur un vrai tenant (pas en mode démo). Sans ce
                teaser le client ne sait pas qu'il va gagner du cashback sur
                cette prestation → effet fidélité invisible avant l'encaissement.
                Audit T5.13. */}
            {tenantSession && tenantSession.settings.cashback_rate_bp > 0 && (
              <div
                className="mb-4 flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm"
                style={{
                  background: 'rgba(139,174,110,0.12)',
                  border: '1px solid rgba(139,174,110,0.30)',
                  color: '#3d5d2a',
                }}
              >
                <div className="flex items-center gap-2">
                  <Gift className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                  <span>
                    {t('cashbackTeaser', {
                      amount: fmt(
                        Math.round(
                          (service.priceCents * tenantSession.settings.cashback_rate_bp) / 10_000,
                        ),
                      ),
                    })}
                  </span>
                </div>
                <span className="mono text-[10px] uppercase tracking-wider opacity-70">
                  +{(tenantSession.settings.cashback_rate_bp / 100).toFixed(1)}%
                </span>
              </div>
            )}

            {/* Inscription obligatoire — téléphone + email + prénom requis.
                En mode démo (sans tenantSession), on retombe sur l'ancien
                formulaire « nom uniquement » pour préserver la démo publique. */}
            {tenantSession ? (
              <>
                {/* Bandeau : « Pour confirmer, créez votre profil » si pas inscrit */}
                {profileLoaded === false && (
                  <div
                    className="mb-4 flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-xs"
                    style={{
                      background: 'rgba(224,162,61,0.12)',
                      border: '1px solid rgba(224,162,61,0.35)',
                      color: '#7A5320',
                    }}
                  >
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                    <span>{t('registerRequiredHint')}</span>
                  </div>
                )}
                <div className="mb-4 grid gap-3">
                  <label className="block">
                    <span
                      className="mono mb-1.5 block text-[10px] uppercase tracking-[0.2em]"
                      style={{ color: LC.back }}
                    >
                      {t('regFirstNameLabel')} *
                    </span>
                    <input
                      type="text"
                      value={regFirstName}
                      onChange={(e) => setRegFirstName(e.target.value)}
                      placeholder={t('regFirstNamePlaceholder')}
                      autoComplete="given-name"
                      maxLength={60}
                      className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors"
                      style={{
                        background: LC.inputBg,
                        borderColor: LC.inputBorder,
                        color: LC.title,
                      }}
                    />
                  </label>
                  <label className="block">
                    <span
                      className="mono mb-1.5 block text-[10px] uppercase tracking-[0.2em]"
                      style={{ color: LC.back }}
                    >
                      {t('regLastNameLabel')}
                    </span>
                    <input
                      type="text"
                      value={regLastName}
                      onChange={(e) => setRegLastName(e.target.value)}
                      placeholder={t('regLastNamePlaceholder')}
                      autoComplete="family-name"
                      maxLength={60}
                      className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors"
                      style={{
                        background: LC.inputBg,
                        borderColor: LC.inputBorder,
                        color: LC.title,
                      }}
                    />
                  </label>
                  <label className="block">
                    <span
                      className="mono mb-1.5 block text-[10px] uppercase tracking-[0.2em]"
                      style={{ color: LC.back }}
                    >
                      {t('regPhoneLabel')} *
                    </span>
                    <input
                      type="tel"
                      value={regPhone}
                      onChange={(e) => setRegPhone(e.target.value)}
                      placeholder={t('regPhonePlaceholder')}
                      autoComplete="tel"
                      inputMode="tel"
                      maxLength={40}
                      className="mono w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors"
                      style={{
                        background: LC.inputBg,
                        borderColor: LC.inputBorder,
                        color: LC.title,
                      }}
                    />
                  </label>
                  <label className="block">
                    <span
                      className="mono mb-1.5 block text-[10px] uppercase tracking-[0.2em]"
                      style={{ color: LC.back }}
                    >
                      {t('regEmailLabel')} *
                    </span>
                    <input
                      type="email"
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      placeholder={t('regEmailPlaceholder')}
                      autoComplete="email"
                      inputMode="email"
                      maxLength={120}
                      className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors"
                      style={{
                        background: LC.inputBg,
                        borderColor: LC.inputBorder,
                        color: LC.title,
                      }}
                    />
                  </label>
                  {/* Date de naissance OBLIGATOIRE — utilisée pour le cadeau
                      anniversaire automatique (widget Anniversaires côté
                      Direction). `type="date"` ouvre le sélecteur natif sur
                      mobile (calendrier déroulant iOS/Android). */}
                  <label className="block">
                    <span
                      className="mono mb-1.5 block text-[10px] uppercase tracking-[0.2em]"
                      style={{ color: LC.back }}
                    >
                      {t('regDobLabel')} *
                    </span>
                    <input
                      type="date"
                      value={regDob}
                      onChange={(e) => setRegDob(e.target.value)}
                      autoComplete="bday"
                      max={new Date().toISOString().split('T')[0]}
                      min="1900-01-01"
                      className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors"
                      style={{
                        background: LC.inputBg,
                        borderColor: LC.inputBorder,
                        color: LC.title,
                      }}
                    />
                    <p className="mt-1 text-[10px] leading-tight" style={{ color: LC.back }}>
                      {t('regDobHint')}
                    </p>
                  </label>
                </div>
              </>
            ) : (
              // Mode démo : ancien formulaire allégé (juste un nom)
              <div className="mb-4">
                <label className="block">
                  <span
                    className="mono mb-2 block text-[10px] uppercase tracking-[0.2em]"
                    style={{ color: LC.back }}
                  >
                    {t('namePromptLabel')}
                  </span>
                  <input
                    type="text"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder={t('namePromptPlaceholder')}
                    className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors"
                    style={{
                      background: LC.inputBg,
                      borderColor: LC.inputBorder,
                      color: LC.title,
                    }}
                  />
                </label>
              </div>
            )}

            <p className="mb-4 text-center text-xs" style={{ color: LC.subtitle }}>
              {t('paymentNotice')}
            </p>
            {submitError && (
              <p
                className="mb-3 rounded-xl border px-3 py-2 text-sm"
                style={{
                  color: '#B91C1C',
                  borderColor: 'rgba(185,28,28,0.3)',
                  background: 'rgba(185,28,28,0.07)',
                }}
              >
                {submitError}
              </p>
            )}
            {(() => {
              // Le bouton « Confirmer » est désactivé tant que les champs
              // obligatoires ne sont pas saisis. En mode tenant, on exige
              // prénom + téléphone (≥6) + email (regex) + DOB (YYYY-MM-DD).
              // En démo, juste le nom.
              const canSubmit = tenantSession
                ? regFirstName.trim().length > 0 &&
                  regPhone.trim().length >= 6 &&
                  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regEmail.trim()) &&
                  /^\d{4}-\d{2}-\d{2}$/.test(regDob.trim())
                : clientName.trim().length > 0;
              return (
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSubmit || isPending}
                  className="btn-press w-full rounded-xl py-3.5 text-sm font-semibold disabled:opacity-30"
                  style={{ background: LC.btn, color: LC.btnText }}
                >
                  {isPending
                    ? t('submitting')
                    : tenantSession && profileLoaded === false
                      ? t('submitRegisterAndConfirm')
                      : t('submit')}
                </button>
              );
            })()}
          </div>
        )}
      </div>

      {reviewsBarber && (
        <BarberReviewsModal
          tenantId={tenantSession?.tenant.id ?? ''}
          barber={reviewsBarber}
          onClose={closeReviews}
        />
      )}
    </div>
  );
}

// =============================================================================
// Mes RDV
// =============================================================================
interface MyBookingsProps {
  bookings: Booking[];
  services: Service[];
  barbers: Barber[];
  cancelBooking: (id: string) => void;
}

function ClientMyBookings({ bookings, services, barbers, cancelBooking }: MyBookingsProps) {
  const t = useTranslations('client.mine');
  const fmt = useFmtMoney();
  const sorted = [...bookings].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const upcoming = sorted.filter((b) => b.status === 'upcoming');
  const past = sorted.filter((b) => b.status === 'done' || b.status === 'cancelled');

  const renderItem = (b: Booking) => {
    const s = services.find((x) => x.id === b.serviceId);
    const barber = barbers.find((x) => x.id === b.barberId);
    return (
      <div
        key={b.id}
        className="fade-up flex items-center justify-between gap-4 rounded-2xl p-5"
        style={{
          background: LC.card,
          border: `1px solid ${LC.cardBorder}`,
          boxShadow: LC.cardShadow,
        }}
      >
        <div className="flex min-w-0 items-center gap-4">
          <div
            className="shrink-0 rounded-xl px-3 py-2 text-center"
            style={{ background: LC.inputBg }}
          >
            <div
              className="mono text-[9px] uppercase tracking-wider"
              style={{ color: LC.subtitle }}
            >
              {new Date(b.date).toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')}
            </div>
            <div className="display text-2xl leading-none" style={{ color: LC.title }}>
              {new Date(b.date).getDate()}
            </div>
            <div className="mono mt-1 text-[10px]" style={{ color: LC.btn }}>
              {b.time}
            </div>
          </div>
          <div className="min-w-0">
            <div className="display truncate text-lg" style={{ color: LC.title }}>
              {s?.name}
            </div>
            <div className="text-xs" style={{ color: LC.subtitle }}>
              {t('withBarber', { name: barber?.name ?? '', duration: s?.duration ?? 0 })}
            </div>
            <div className="mt-2">
              {b.status === 'upcoming' && (
                <span
                  className="rounded-md px-2 py-0.5 text-[10px] font-semibold"
                  style={{ background: LC.btn, color: LC.btnText }}
                >
                  {t('statusUpcoming')}
                </span>
              )}
              {b.status === 'done' && (
                <span
                  className="rounded-md px-2 py-0.5 text-[10px] font-semibold"
                  style={{ background: '#E8F5E9', color: '#2E7D32' }}
                >
                  {b.paid ? t('statusDonePaid') : t('statusDone')}
                </span>
              )}
              {b.status === 'cancelled' && (
                <span
                  className="rounded-md px-2 py-0.5 text-[10px] font-semibold"
                  style={
                    b.noShow
                      ? { background: '#FFF4E6', color: '#B45309' } // copper-ish pour « Manqué »
                      : { background: '#FEECEC', color: '#B91C1C' } // rouge pour « Annulé »
                  }
                >
                  {b.noShow ? t('statusMissed') : t('statusCancelled')}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="display mono text-xl" style={{ color: LC.title }}>
            {fmt(b.amountCents)}
          </span>
          {b.status === 'upcoming' && (
            <button
              type="button"
              onClick={() => cancelBooking(b.id)}
              className="btn-press mono text-xs uppercase tracking-wider hover:underline"
              style={{ color: '#B91C1C' }}
            >
              {t('cancel')}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className="min-h-screen"
      style={{
        background: `radial-gradient(ellipse 120% 50% at 50% 0%, #ECEAE4 0%, ${LC.bg} 40%, #EDECEA 100%)`,
      }}
    >
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="mono mb-2 text-[9px] uppercase tracking-[0.4em]" style={{ color: LC.back }}>
          {t('eyebrow')}
        </div>
        <h2 className="display mb-8 text-4xl" style={{ color: LC.title }}>
          {t('title')}
        </h2>

        {upcoming.length > 0 && (
          <>
            <h3
              className="mono mb-3 text-[10px] uppercase tracking-[0.3em]"
              style={{ color: LC.back }}
            >
              {t('upcoming', { count: upcoming.length })}
            </h3>
            <div className="mb-10 space-y-3">{upcoming.map(renderItem)}</div>
          </>
        )}

        {past.length > 0 && (
          <>
            <h3
              className="mono mb-3 text-[10px] uppercase tracking-[0.3em]"
              style={{ color: LC.back }}
            >
              {t('past')}
            </h3>
            <div className="space-y-3">{past.map(renderItem)}</div>
          </>
        )}

        {bookings.length === 0 && (
          <div
            className="rounded-2xl p-12 text-center"
            style={{
              background: LC.card,
              border: `1px solid ${LC.cardBorder}`,
              boxShadow: LC.cardShadow,
            }}
          >
            <Calendar
              className="mx-auto mb-4 h-10 w-10"
              style={{ color: LC.back }}
              strokeWidth={1}
            />
            <div className="display mb-2 text-xl" style={{ color: LC.title }}>
              {t('emptyTitle')}
            </div>
            <div className="text-sm" style={{ color: LC.subtitle }}>
              {t('emptySubtitle')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Onglet "Le salon" — informations du salon depuis les Paramètres Direction
// =============================================================================

// Jour courant en clé DayKey (lun/mar/…/dim)
const TODAY_KEY: DayKey = (() => {
  const jsDay = new Date().getDay(); // 0=dim … 6=sam
  const map: DayKey[] = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
  return map[jsDay] ?? 'lun';
})();

function InfoRow({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  href?: string;
}) {
  const inner = (
    <div className="flex items-start gap-3">
      <span
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center"
        style={{
          background: LC.inputBg,
          border: `1px solid ${LC.cardBorder}`,
          borderRadius: '0.75rem',
        }}
      >
        <Icon className="h-4 w-4" strokeWidth={1.5} style={{ color: LC.btn }} />
      </span>
      <div className="min-w-0 flex-1">
        <div
          className="mono mb-0.5 text-[9px] uppercase tracking-[0.2em]"
          style={{ color: LC.back }}
        >
          {label}
        </div>
        <div className="break-words text-sm font-medium" style={{ color: LC.title }}>
          {value}
        </div>
      </div>
      {href && (
        <ExternalLink
          className="mt-1 h-3.5 w-3.5 shrink-0"
          strokeWidth={1.5}
          style={{ color: LC.back }}
        />
      )}
    </div>
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-xl p-3 transition-colors"
        style={{ color: 'inherit' }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = LC.inputBg;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = 'transparent';
        }}
      >
        {inner}
      </a>
    );
  }
  return <div className="p-3">{inner}</div>;
}

function SalonInfoTab() {
  const t = useTranslations('client.info');
  const tDayLong = useTranslations('days.long');
  const tenantSession = useTenantOrNull();
  const s = tenantSession?.settings;
  const salonName = tenantSession?.tenant.name ?? 'Maison Lefèvre';
  const logoUrl = tenantSession?.branding.logo_url ?? null;

  // Adresse complète — la branche / quartier s'insère entre la rue et la ville
  const addressParts = [s?.address_street, s?.branch, s?.address_city, s?.address_zip].filter(
    Boolean,
  );
  const fullAddress = addressParts.join(', ');
  // Priorité 1 : lien Google Maps personnalisé renseigné par le gérant
  //   (épingle exacte → bonne carte au 1er clic, pas une recherche).
  // Priorité 2 : fallback recherche par adresse texte.
  const mapsHref = s?.maps_url
    ? s.maps_url
    : fullAddress
      ? `https://www.google.com/maps/search/${encodeURIComponent(fullAddress)}`
      : undefined;

  // Horaires
  const schedule = parseWeekSchedule(s?.hours_text);

  // Instagram : assure le @ et construit le lien
  const igHandle = s?.contact_instagram ? s.contact_instagram.replace(/^@/, '') : null;

  return (
    <div
      className="min-h-screen"
      style={{
        background: `radial-gradient(ellipse 120% 50% at 50% 0%, #ECEAE4 0%, ${LC.bg} 40%, #EDECEA 100%)`,
      }}
    >
      <div className="mx-auto max-w-2xl px-6 py-10">
        {/* En-tête salon */}
        <div className="fade-up mb-8 flex items-center gap-4">
          {logoUrl ? (
            <Image
              src={logoUrl}
              alt={salonName}
              width={64}
              height={64}
              className="h-16 w-16 rounded-full object-cover"
              unoptimized
            />
          ) : (
            <div
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-2xl font-bold"
              style={{
                background: LC.inputBg,
                color: LC.btn,
                border: `1px solid ${LC.cardBorder}`,
              }}
            >
              {salonInitials(salonName)}
            </div>
          )}
          <div>
            <div
              className="mono mb-1 text-[9px] uppercase tracking-[0.4em]"
              style={{ color: LC.back }}
            >
              {t('eyebrow')}
            </div>
            <h2 className="display mt-1 text-3xl leading-tight" style={{ color: LC.title }}>
              {salonName}
            </h2>
            {s?.tagline && (
              <p className="mt-0.5 text-sm italic" style={{ color: LC.subtitle }}>
                {s.tagline}
              </p>
            )}
          </div>
        </div>

        <div className="fade-up space-y-4">
          {/* Adresse */}
          {fullAddress && (
            <div
              className="overflow-hidden rounded-2xl"
              style={{
                background: LC.card,
                border: `1px solid ${LC.cardBorder}`,
                boxShadow: LC.cardShadow,
              }}
            >
              <InfoRow
                icon={MapPin}
                label={t('addressLabel')}
                value={fullAddress}
                href={mapsHref}
              />
            </div>
          )}

          {/* Horaires */}
          {schedule && (
            <div
              className="overflow-hidden rounded-2xl"
              style={{
                background: LC.card,
                border: `1px solid ${LC.cardBorder}`,
                boxShadow: LC.cardShadow,
              }}
            >
              <div
                className="px-4 py-3"
                style={{
                  background: LC.inputBg,
                  borderBottom: `1px solid ${LC.separator}`,
                }}
              >
                <span
                  className="mono text-[10px] uppercase tracking-[0.2em]"
                  style={{ color: LC.back }}
                >
                  <Clock className="me-1.5 inline h-3 w-3" strokeWidth={1.5} />
                  {t('openingHours')}
                </span>
              </div>
              <div className="divide-y" style={{ borderColor: LC.separator }}>
                {DAYS_FR.map((day) => {
                  const d = schedule[day.key];
                  const isToday = day.key === TODAY_KEY;
                  return (
                    <div
                      key={day.key}
                      className="flex items-center justify-between px-4 py-3"
                      style={isToday ? { background: `${LC.btn}08` } : undefined}
                    >
                      <span
                        className="mono text-[11px] uppercase tracking-[0.15em]"
                        style={
                          isToday ? { color: LC.btn, fontWeight: 600 } : { color: LC.subtitle }
                        }
                      >
                        {isToday && (
                          <span
                            className="me-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
                            style={{ background: LC.btn }}
                          />
                        )}
                        {tDayLong(day.key)}
                      </span>
                      {d.open && d.slots.length > 0 ? (
                        <div className="flex flex-col items-end gap-0.5">
                          {d.slots.map((slot, i) => (
                            <span
                              key={i}
                              className="mono text-sm"
                              style={
                                isToday ? { color: LC.btn, fontWeight: 600 } : { color: LC.title }
                              }
                            >
                              {slot.from.replace(':00', 'h').replace(':30', 'h30')} –{' '}
                              {slot.to.replace(':00', 'h').replace(':30', 'h30')}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-sm" style={{ color: LC.back }}>
                          {t('closed')}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Contacts — icônes uniquement */}
          {(s?.contact_phone || s?.contact_email || s?.contact_website || igHandle) && (
            <div
              className="rounded-2xl px-5 py-4"
              style={{
                background: LC.card,
                border: `1px solid ${LC.cardBorder}`,
                boxShadow: LC.cardShadow,
              }}
            >
              <div
                className="mono mb-4 text-[9px] uppercase tracking-[0.25em]"
                style={{ color: LC.back }}
              >
                {t('contactsHeader')}
              </div>
              <div className="flex items-center gap-3">
                {s?.contact_phone && (
                  <a
                    href={`tel:${s.contact_phone.replace(/\s/g, '')}`}
                    className="btn-press flex h-12 w-12 items-center justify-center rounded-2xl transition-all"
                    style={{
                      background: LC.inputBg,
                      border: `1px solid ${LC.cardBorder}`,
                      color: LC.btn,
                    }}
                    title={s.contact_phone}
                  >
                    <Phone className="h-5 w-5" strokeWidth={1.5} />
                  </a>
                )}
                {s?.contact_email && (
                  <a
                    href={`mailto:${s.contact_email}`}
                    className="btn-press flex h-12 w-12 items-center justify-center rounded-2xl transition-all"
                    style={{
                      background: LC.inputBg,
                      border: `1px solid ${LC.cardBorder}`,
                      color: LC.btn,
                    }}
                    title={s.contact_email}
                  >
                    <Mail className="h-5 w-5" strokeWidth={1.5} />
                  </a>
                )}
                {s?.contact_website && (
                  <a
                    href={
                      s.contact_website.startsWith('http')
                        ? s.contact_website
                        : `https://${s.contact_website}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-press flex h-12 w-12 items-center justify-center rounded-2xl transition-all"
                    style={{
                      background: LC.inputBg,
                      border: `1px solid ${LC.cardBorder}`,
                      color: LC.btn,
                    }}
                    title={s.contact_website}
                  >
                    <Globe className="h-5 w-5" strokeWidth={1.5} />
                  </a>
                )}
                {igHandle && (
                  <a
                    href={`https://instagram.com/${igHandle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-press flex h-12 w-12 items-center justify-center rounded-2xl transition-all"
                    style={{
                      background: LC.inputBg,
                      border: `1px solid ${LC.cardBorder}`,
                      color: LC.btn,
                    }}
                    title={`@${igHandle}`}
                    aria-label={`Instagram @${igHandle}`}
                  >
                    <InstagramIcon className="h-5 w-5" strokeWidth={1.5} />
                  </a>
                )}
              </div>
            </div>
          )}

          {/* État vide (aucune info renseignée) */}
          {!fullAddress &&
            !schedule &&
            !s?.contact_phone &&
            !s?.contact_email &&
            !s?.contact_website &&
            !igHandle && (
              <div
                className="rounded-2xl p-12 text-center"
                style={{
                  background: LC.card,
                  border: `1px solid ${LC.cardBorder}`,
                  boxShadow: LC.cardShadow,
                }}
              >
                <Store
                  className="mx-auto mb-4 h-10 w-10"
                  style={{ color: LC.back }}
                  strokeWidth={1}
                />
                <div className="display mb-2 text-xl" style={{ color: LC.title }}>
                  {t('emptyTitle')}
                </div>
                <div className="text-sm" style={{ color: LC.subtitle }}>
                  {t('emptySubtitle')}
                </div>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Onglet "Mon profil" — création de profil + carte de fidélité
// =============================================================================

/**
 * Trois écrans :
 *  - login  : pas de téléphone connu → formulaire de connexion (phone only)
 *  - create : numéro saisi mais aucun profil → formulaire de création complet
 *  - profile: profil chargé → carte fidélité + avis + édition
 */
function ProfileTab({
  phone,
  onPhoneChange,
  onBack,
}: {
  phone: string;
  onPhoneChange: (p: string) => void;
  /** Callback optionnel pour revenir à l'app (utilisé en mode plein écran sans header). */
  onBack?: () => void;
}) {
  const t = useTranslations('client.profile');
  const tErrors = useTranslations('client.errors');
  // Formatter monnaie selon la devise du tenant — utilisé pour afficher le
  // wallet cashback avec la bonne devise (EGP / EUR / USD…).
  const fmtMoney = useFmtMoney();
  // tPdf retiré : les labels PDF vivent désormais côté serveur (cf.
  // `client/receipt-pdf-action.ts` PDF_LABELS) parce que la génération
  // est server-side. Le client n'a plus besoin de ces clés i18n.
  const profileLocale = useLocale();
  const profileBcp47 =
    profileLocale === 'ar' ? 'ar-EG' : profileLocale === 'en' ? 'en-US' : 'fr-FR';
  void profileBcp47;
  const tenantSession = useTenantOrNull();
  const salonName = tenantSession?.tenant.name ?? t('fallbackSalonName');
  const tenantId = tenantSession?.tenant.id ?? null;
  // ── Mode de navigation (login → create | profile) ───────────────────────
  const [mode, setMode] = useState<'login' | 'create' | 'profile'>(() =>
    phone ? 'profile' : 'login',
  );
  // Téléphone saisi dans l'écran login (avant validation)
  // Identifiant principal sur l'écran de connexion = EMAIL.
  // Le téléphone reste obligatoire mais devient un champ du formulaire
  // d'inscription, pas de connexion. Cohérent avec le booking-public-action
  // qui exige email + phone au RDV — mais l'email est ce qui « identifie »
  // l'utilisateur dans l'app.
  const [loginEmail, setLoginEmail] = useState('');
  // Téléphone saisi sur le formulaire d'inscription (mode 'create') — séparé
  // de `phone` (qui est l'ID persisté en localStorage / DB).
  const [signupPhone, setSignupPhone] = useState('');
  const [lookupPending, setLookupPending] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  // Mot de passe (connexion) + état « lien de réinitialisation envoyé ».
  const [loginPassword, setLoginPassword] = useState('');
  const [resetSent, setResetSent] = useState(false);

  // Synchronise le mode quand le prop `phone` change de l'extérieur
  useEffect(() => {
    if (phone && mode !== 'profile') setMode('profile');
    if (!phone && mode === 'profile') setMode('login');
  }, [phone, mode]); // inclure mode satisfait eslint — la logique reste stable car setMode est idempotent

  // ── Champs du formulaire de création / édition ──────────────────────────
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [email, setEmail] = useState('');

  // ── Fidélité / cashback ────────────────────────────────────────────────
  const [points, setPoints] = useState(0);
  const [cashbackCents, setCashbackCents] = useState(0);
  const [loading, setLoading] = useState(false);

  // ── Avis clients ─────────────────────────────────────────────────────────
  const [visits, setVisits] = useState<ReviewableVisit[]>([]);
  const [visitsLoading, setVisitsLoading] = useState(false);
  const [pendingRatings, setPendingRatings] = useState<Record<string, number>>({});
  const [pendingComments, setPendingComments] = useState<Record<string, string>>({});
  /** Liste des ids de visites notées dans cette session OU précédemment
   *  (rechargée depuis localStorage). Sert de filtre defense-in-depth :
   *  si `getReviewableVisits` retourne malgré tout une visite déjà notée
   *  (lag réplication, cache stale, etc.), on la masque côté UI. Audit T5.17. */
  const [submittedVisits, setSubmittedVisits] = useState<Set<string>>(new Set());
  const [ratingErrors, setRatingErrors] = useState<Record<string, string>>({});
  const [submittingVisit, setSubmittingVisit] = useState<string | null>(null);

  // Clé localStorage scopée au couple (tenantId, phone) pour ne pas mélanger
  // les visites notées entre salons ou comptes successifs sur le même device.
  // Format stocké : `{ ids: string[]; savedAt: number }` — purge auto à 30j
  // (largement au-delà du lag de réplication possible).
  const submittedVisitsStorageKey =
    tenantId && phone ? `systema:submitted-visits:${tenantId}:${phone}` : null;

  // Hydrate au mount + sur changement de compte
  useEffect(() => {
    if (!submittedVisitsStorageKey || typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(submittedVisitsStorageKey);
      if (!raw) {
        setSubmittedVisits(new Set());
        return;
      }
      const parsed = JSON.parse(raw) as { ids?: string[]; savedAt?: number };
      const ageMs = Date.now() - (parsed.savedAt ?? 0);
      if (ageMs > 30 * 24 * 60 * 60 * 1000) {
        window.localStorage.removeItem(submittedVisitsStorageKey);
        setSubmittedVisits(new Set());
        return;
      }
      setSubmittedVisits(new Set(parsed.ids ?? []));
    } catch {
      setSubmittedVisits(new Set());
    }
  }, [submittedVisitsStorageKey]);

  // Persist à chaque ajout
  const markVisitSubmitted = (id: string) => {
    setSubmittedVisits((prev) => {
      const next = new Set([...prev, id]);
      if (submittedVisitsStorageKey && typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(
            submittedVisitsStorageKey,
            JSON.stringify({ ids: Array.from(next), savedAt: Date.now() }),
          );
        } catch {
          /* quota plein → on perd la persistance mais pas la session */
        }
      }
      return next;
    });
  };

  // ── Feedback ────────────────────────────────────────────────────────────
  const [saved, setSaved] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // ── Factures (sales) — chargées dès que phone + tenant disponibles ──────
  const [sales, setSales] = useState<ClientSaleItem[]>([]);
  const [salesLoading, setSalesLoading] = useState(false);
  /** Track per-saleId qui est en train de fetch son snapshot PDF — évite
   *  les double-clics qui consommeraient le rate-limit côté server sans
   *  feedback visible (audit-2 finding I). */
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  useEffect(() => {
    if (!phone || !tenantId) return;
    setSalesLoading(true);
    void getClientSales(tenantId, phone)
      .then((r) => {
        if (r.ok) setSales(r.sales);
      })
      .catch(() => {})
      .finally(() => setSalesLoading(false));
  }, [phone, tenantId]);

  // Palette light — partagée entre login / create / profile
  const C = {
    bg: '#F4F3F0',
    card: '#FFFFFF',
    cardBorder: '#E4E2DC',
    cardShadow: '0 4px 32px rgba(40,35,28,0.09), 0 1px 4px rgba(40,35,28,0.06)',
    title: '#18160F',
    subtitle: '#8A8478',
    label: '#B0ACA4',
    inputBg: '#EEECEA',
    inputBorder: '#DEDAD3',
    inputBorderFocus: '#3A3630',
    inputText: '#18160F',
    inputPlaceholder: '#C0BDB5',
    btn: '#1A1714',
    btnText: '#FFFFFF',
    back: '#A8A49C',
    espaceClient: '#A09C95',
    footer: '#C0BBB3',
    separator: '#E4E2DC',
  };

  // Charge le profil existant dès que phone + tenant sont disponibles.
  useEffect(() => {
    if (!phone || !tenantId) return;
    setLoading(true);
    getClientProfile(tenantId, phone)
      .then((result) => {
        if (result.ok) {
          setPoints(result.points);
          setCashbackCents(result.cashbackCents);
          setFirstName(result.profile.firstName ?? '');
          setLastName(result.profile.lastName ?? '');
          setDob(result.profile.dateOfBirth ?? '');
          setEmail(result.profile.email ?? '');
        } else if (result.errorKey === 'authRequired') {
          // Session absente/expirée → purge le phone local + retour au login.
          onPhoneChange('');
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [phone, tenantId, onPhoneChange]);

  // Snapshot du Set submittedVisits dans une ref — évite de re-fetch
  // getReviewableVisits à chaque submit (le filtre n'a besoin que de la
  // valeur au moment du fetch, pas d'être recalculé en boucle).
  const submittedVisitsRef = useRef(submittedVisits);
  submittedVisitsRef.current = submittedVisits;

  // Charge les visites notables dès que phone + tenant sont disponibles.
  useEffect(() => {
    if (!phone || !tenantId) return;
    setVisitsLoading(true);
    getReviewableVisits(tenantId, phone)
      .then((r) => {
        if (r.ok) {
          // Defense-in-depth (audit T5.17) : filtre les visites notées
          // dans cette session OU précédemment (localStorage).
          // Couvre les cas où getReviewableVisits retournerait une visite
          // déjà notée (lag réplication, refresh trop rapide après submit).
          const skipSet = submittedVisitsRef.current;
          setVisits(r.visits.filter((v) => !skipSet.has(v.id)));
        }
      })
      .catch(() => {})
      .finally(() => setVisitsLoading(false));
  }, [phone, tenantId]);

  // ── Connexion par EMAIL (écran login) ──────────────────────────────────
  // Note : la connexion utilise désormais l'email comme identifiant principal.
  // Sous le capot, on résout (email → phone) via getClientProfileByEmail puis
  // on persiste le phone en localStorage (parce que les ventes Caisse et RDV
  // matchent toujours sur phone — ID stable historique).
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    // Identifiant = EMAIL ou TÉLÉPHONE + mot de passe. `loginClient` détecte
    // le type, vérifie le hash scrypt et pose le COOKIE de session httpOnly.
    // On ne fait plus aucun lookup non authentifié côté UI.
    const raw = loginEmail.trim();
    if (!raw) {
      setLookupError(t('errors.emailOrPhoneRequired'));
      return;
    }
    if (!loginPassword) {
      setLookupError(t('errors.passwordRequired'));
      return;
    }
    if (!tenantId) return;
    setLookupError(null);
    setResetSent(false);
    setLookupPending(true);
    loginClient(raw, loginPassword).then((res) => {
      setLookupPending(false);
      if (res.ok) {
        // Cookie de session posé côté serveur ; on remonte le phone pour l'UI.
        onPhoneChange(res.phone);
        setMode('profile');
        return;
      }
      setLookupError(
        res.code === 'invalidCredentials'
          ? t('errors.invalidCredentials')
          : res.code === 'mustSetPassword'
            ? t('errors.mustSetPassword')
            : res.code === 'notFound'
              ? t('errors.accountNotFound')
              : res.code === 'rateLimited'
                ? t('errors.rateLimited')
                : t('errors.unexpected'),
      );
    }).catch(() => {
      // FIX : un rejet (réseau, timeout) laissait lookupPending=true à vie →
      // bouton bloqué sur « Vérification… » jusqu'au rechargement de la page.
      setLookupPending(false);
      setLookupError(t('errors.unexpected'));
    });
  };

  // ── Mot de passe oublié / première définition ────────────────────────────
  // Envoie un lien signé par email (l'identifiant doit être un email — le SMS
  // n'est pas branché). Réponse toujours « envoyé » côté UI (anti-énumération).
  const handleForgotPassword = () => {
    const raw = loginEmail.trim().toLowerCase();
    if (!raw.includes('@') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
      // Message dédié : explique qu'il faut un email (pas un téléphone) pour
      // recevoir le lien de réinit. Évite la confusion « j'ai tapé mon numéro
      // pour me connecter, pourquoi on me dit que c'est invalide ? ».
      setLookupError(t('errors.forgotPasswordNeedsEmail'));
      return;
    }
    setLookupError(null);
    setLookupPending(true);
    requestClientPasswordReset(raw).then(() => {
      setLookupPending(false);
      setResetSent(true);
    }).catch(() => {
      // Réseau / timeout : on évite de laisser le bouton bloqué sur « Vérification… ».
      setLookupPending(false);
      setLookupError(t('errors.unexpected'));
    });
  };

  // ── Soumission inscription (création de profil) ────────────────────────
  // Téléphone obligatoire — sert d'ID stable pour matcher les ventes Caisse
  // futures et permettre les rappels SMS/WhatsApp. L'email vient du flow login.
  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedPhone = signupPhone.trim();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedPhone || normalizedPhone.length < 6) {
      setFormError(t('errors.phoneRequired'));
      return;
    }
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setFormError(t('errors.emailRequired'));
      return;
    }
    if (!firstName.trim()) {
      setFormError(t('errors.firstNameRequired'));
      return;
    }
    const dobTrim = dob.trim();
    if (!dobTrim || !/^\d{4}-\d{2}-\d{2}$/.test(dobTrim)) {
      setFormError(t('errors.dobRequired'));
      return;
    }
    const dobDate = new Date(dobTrim);
    if (Number.isNaN(dobDate.getTime()) || dobDate > new Date() || dobDate.getFullYear() < 1900) {
      setFormError(t('errors.dobInvalid'));
      return;
    }
    if (!tenantId) return;
    setFormError(null);
    startTransition(async () => {
      // Pré-check anti-doublon : si le téléphone est déjà rattaché à un
      // AUTRE email côté DB, on bloque avant l'UPSERT qui écraserait
      // silencieusement l'ancien profil. Le caissier guide ainsi le
      // visiteur vers le « bon » login (l'email déjà associé, masqué).
      const availability = await checkClientPhoneAvailable(
        tenantId,
        normalizedPhone,
        normalizedEmail,
      );
      if (availability.ok && availability.available === false) {
        setFormError(
          t('errors.phoneAlreadyLinked', {
            email: availability.maskedEmail ?? '—',
          }),
        );
        return;
      }
      const result = await upsertClientProfile({
        tenantId,
        phone: normalizedPhone,
        firstName,
        lastName,
        dateOfBirth: dobTrim,
        email: normalizedEmail,
      });
      if (result.ok) {
        onPhoneChange(normalizedPhone); // persiste en localStorage + remonte dans l'état
      } else {
        setFormError(tErrors(result.errorKey as 'dbError', result.errorValues));
      }
    });
  };

  // ── Soumission mise à jour (profil existant) ────────────────────────────
  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !phone) return;
    setFormError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await upsertClientProfile({
        tenantId,
        phone,
        firstName,
        lastName,
        dateOfBirth: dob,
        email,
      });
      if (result.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        setFormError(tErrors(result.errorKey as 'dbError', result.errorValues));
      }
    });
  };

  const handleSubmitRating = (visit: ReviewableVisit) => {
    const rating = pendingRatings[visit.id];
    if (!rating || !tenantId) return;
    setSubmittingVisit(visit.id);
    setRatingErrors((e) => {
      const n = { ...e };
      delete n[visit.id];
      return n;
    });
    submitReview({
      tenantId,
      clientPhone: phone,
      barberId: visit.barberId,
      bookingId: visit.kind === 'booking' ? visit.id : undefined,
      saleId: visit.kind === 'sale' ? visit.id : undefined,
      rating,
      comment: pendingComments[visit.id],
    })
      .then((r) => {
        if (r.ok) {
          markVisitSubmitted(visit.id);
          setVisits((v) => v.filter((x) => x.id !== visit.id));
        } else {
          setRatingErrors((e) => ({
            ...e,
            [visit.id]: tErrors(r.errorKey as 'dbError', r.errorValues),
          }));
        }
      })
      .catch(() => {
        setRatingErrors((e) => ({ ...e, [visit.id]: t('errors.unexpected') }));
      })
      .finally(() => setSubmittingVisit(null));
  };

  // ── Écran de connexion ────────────────────────────────────────────────
  if (mode === 'login') {
    const logoUrl = tenantSession?.branding.logo_url ?? null;

    return (
      <div
        className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-16"
        style={{
          background: `radial-gradient(ellipse 110% 90% at 50% 10%, #ECEAE4 0%, ${C.bg} 45%, #EDECEA 100%)`,
        }}
      >
        {/* ── Retour au salon ─────────────────────────────────────────────── */}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="btn-press mono absolute start-6 top-6 flex items-center gap-1 text-[10px] uppercase tracking-wider transition-opacity hover:opacity-60"
            style={{ color: C.back }}
          >
            <ChevronLeft className="h-3.5 w-3.5 rtl:-scale-x-100" /> {t('backToSalon')}
          </button>
        )}

        {/* ── Logo + nom ──────────────────────────────────────────────────── */}
        <div className="relative mb-10 flex flex-col items-center gap-4 text-center">
          {/* Ombre douce derrière le logo */}
          <div
            className="pointer-events-none absolute -top-4 start-1/2 h-36 w-36 -translate-x-1/2 rounded-full blur-2xl"
            style={{ background: 'rgba(40,35,28,0.08)' }}
          />
          {logoUrl ? (
            <Image
              src={logoUrl}
              alt={salonName}
              width={96}
              height={96}
              className="relative rounded-3xl object-cover"
              style={{
                boxShadow: C.cardShadow,
                border: `1px solid ${C.cardBorder}`,
              }}
              unoptimized
            />
          ) : (
            <div
              className="relative flex h-24 w-24 items-center justify-center rounded-3xl text-3xl font-bold"
              style={{
                background: C.btn,
                color: '#ffffff',
                boxShadow: C.cardShadow,
              }}
            >
              {salonInitials(salonName)}
            </div>
          )}
          <div>
            <div className="display text-2xl leading-snug" style={{ color: C.title }}>
              {salonName}
            </div>
            <div
              className="mono mt-1 text-[9px] uppercase tracking-[0.45em]"
              style={{ color: C.back }}
            >
              {t('loginRoleLabel')}
            </div>
          </div>
        </div>

        {/* ── Card blanche ────────────────────────────────────────────────── */}
        <div
          className="w-full max-w-sm rounded-2xl p-7"
          style={{
            background: C.card,
            border: `1px solid ${C.cardBorder}`,
            boxShadow: C.cardShadow,
          }}
        >
          <h2 className="display mb-1 text-[1.65rem] leading-tight" style={{ color: C.title }}>
            {t('login.title')}
          </h2>
          <p className="mb-7 text-sm leading-relaxed" style={{ color: C.subtitle }}>
            {t('login.subtitle')}
          </p>

          <form onSubmit={handleLogin} className="space-y-3">
            <label className="block">
              <span
                className="mono mb-2 block text-[9px] uppercase tracking-[0.2em]"
                style={{ color: C.back }}
              >
                {t('login.identifierLabel')}
              </span>
              <input
                type="text"
                inputMode="text"
                autoComplete="username"
                value={loginEmail}
                onChange={(e) => {
                  setLoginEmail(e.target.value);
                  setLookupError(null);
                }}
                placeholder={t('login.identifierPlaceholder')}
                disabled={lookupPending}
                required
                className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all disabled:opacity-50"
                style={{
                  background: C.inputBg,
                  border: `1px solid ${C.inputBorder}`,
                  color: C.inputText,
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = C.inputBorderFocus;
                  e.currentTarget.style.background = '#FFFFFF';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = C.inputBorder;
                  e.currentTarget.style.background = C.inputBg;
                }}
              />
            </label>

            <label className="block">
              <span
                className="mono mb-2 block text-[9px] uppercase tracking-[0.2em]"
                style={{ color: C.back }}
              >
                {t('login.passwordLabel')}
              </span>
              <input
                type="password"
                autoComplete="current-password"
                value={loginPassword}
                onChange={(e) => {
                  setLoginPassword(e.target.value);
                  setLookupError(null);
                }}
                placeholder={t('login.passwordPlaceholder')}
                disabled={lookupPending}
                className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all disabled:opacity-50"
                style={{
                  background: C.inputBg,
                  border: `1px solid ${C.inputBorder}`,
                  color: C.inputText,
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = C.inputBorderFocus;
                  e.currentTarget.style.background = '#FFFFFF';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = C.inputBorder;
                  e.currentTarget.style.background = C.inputBg;
                }}
              />
            </label>

            {lookupError && (
              <p className="border-red/30 bg-red/10 text-red rounded-xl border px-4 py-2.5 text-xs">
                {lookupError}
              </p>
            )}

            <button
              type="submit"
              disabled={lookupPending || !loginEmail.trim() || !loginPassword || !tenantSession}
              className="btn-press mt-1 w-full rounded-xl py-3.5 text-sm font-semibold transition-opacity disabled:opacity-30"
              style={{ background: C.btn, color: C.btnText }}
            >
              {lookupPending ? t('login.submitting') : t('login.submit')}
            </button>

            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={lookupPending}
              className="btn-press w-full text-center text-xs underline disabled:opacity-50"
              style={{ color: C.subtitle }}
            >
              {t('login.forgotLink')}
            </button>

            {resetSent && (
              <p
                className="rounded-xl border px-4 py-2.5 text-xs"
                style={{
                  borderColor: 'rgba(139,174,110,0.3)',
                  background: 'rgba(139,174,110,0.12)',
                  color: '#3d5d2a',
                }}
              >
                {t('login.resetSent')}
              </p>
            )}

            {!tenantSession && (
              <p className="text-center text-xs" style={{ color: C.subtitle }}>
                {t('login.demoMode')}
              </p>
            )}
          </form>

          <div className="my-6 border-t" style={{ borderColor: C.separator }} />
          <p className="text-center text-xs" style={{ color: C.footer }}>
            {t('login.firstVisitHint')}
          </p>
        </div>
      </div>
    );
  }

  // ── Écran de création de profil ──────────────────────────────────────
  if (mode === 'create') {
    return (
      <div
        className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-16"
        style={{
          background: `radial-gradient(ellipse 110% 90% at 50% 10%, #ECEAE4 0%, ${C.bg} 45%, #EDECEA 100%)`,
        }}
      >
        {/* ── Retour ────────────────────────────────────────────────────── */}
        <button
          type="button"
          onClick={() => {
            setMode('login');
            setFormError(null);
          }}
          className="btn-press mono absolute start-6 top-6 flex items-center gap-1 text-[10px] uppercase tracking-wider transition-opacity hover:opacity-60"
          style={{ color: C.back }}
        >
          <ChevronLeft className="h-3.5 w-3.5 rtl:-scale-x-100" /> {t('create.backLink')}
        </button>

        {/* ── En-tête ───────────────────────────────────────────────────── */}
        <div className="mb-8 text-center">
          <div
            className="mono mb-2 text-[9px] uppercase tracking-[0.4em]"
            style={{ color: C.back }}
          >
            {t('create.eyebrow')}
          </div>
          <h2 className="display text-3xl leading-tight" style={{ color: C.title }}>
            {t('create.welcomeBefore')}
            <span className="display-i" style={{ color: C.btn }}>
              {t('create.welcomeAccent')}
            </span>
          </h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: C.subtitle }}>
            {t('create.subtitle')}
          </p>
        </div>

        {/* ── Card formulaire ───────────────────────────────────────────── */}
        <div
          className="w-full max-w-sm rounded-2xl p-7"
          style={{
            background: C.card,
            border: `1px solid ${C.cardBorder}`,
            boxShadow: C.cardShadow,
          }}
        >
          <form onSubmit={handleCreate} className="space-y-4">
            {/* Email verrouillé (saisi à l'étape précédente) */}
            <div>
              <span
                className="mono mb-2 block text-[9px] uppercase tracking-[0.2em]"
                style={{ color: C.back }}
              >
                {t('create.emailLabel')}
              </span>
              <div
                className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm"
                style={{
                  background: C.inputBg,
                  border: `1px solid ${C.inputBorder}`,
                  color: C.subtitle,
                }}
              >
                <AtSign className="h-3.5 w-3.5 shrink-0" style={{ color: C.back }} />
                {email || loginEmail}
              </div>
            </div>

            {/* Téléphone obligatoire — éditable */}
            <label className="block">
              <span
                className="mono mb-2 block text-[9px] uppercase tracking-[0.2em]"
                style={{ color: C.back }}
              >
                {t('create.phoneLabel')} *
              </span>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={signupPhone}
                onChange={(e) => setSignupPhone(e.target.value)}
                placeholder={t('create.phonePlaceholder')}
                disabled={isPending}
                required
                maxLength={40}
                className="mono w-full rounded-xl px-4 py-3 text-sm outline-none transition-all disabled:opacity-50"
                style={{
                  background: C.inputBg,
                  border: `1px solid ${C.inputBorder}`,
                  color: C.inputText,
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = C.inputBorderFocus;
                  e.currentTarget.style.background = '#FFFFFF';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = C.inputBorder;
                  e.currentTarget.style.background = C.inputBg;
                }}
              />
            </label>

            {/* Prénom / Nom */}
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  {
                    id: 'firstName',
                    label: t('create.firstNameLabel'),
                    value: firstName,
                    setter: setFirstName,
                    placeholder: t('create.firstNamePlaceholder'),
                  },
                  {
                    id: 'lastName',
                    label: t('create.lastNameLabel'),
                    value: lastName,
                    setter: setLastName,
                    placeholder: t('create.lastNamePlaceholder'),
                  },
                ] as const
              ).map(({ id, label, value, setter, placeholder }) => (
                <label key={id} className="block">
                  <span
                    className="mono mb-2 block text-[9px] uppercase tracking-[0.2em]"
                    style={{ color: C.back }}
                  >
                    {label}
                  </span>
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => setter(e.target.value)}
                    placeholder={placeholder}
                    disabled={isPending}
                    className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all disabled:opacity-50"
                    style={{
                      background: C.inputBg,
                      border: `1px solid ${C.inputBorder}`,
                      color: C.inputText,
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = C.inputBorderFocus;
                      e.currentTarget.style.background = '#FFFFFF';
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = C.inputBorder;
                      e.currentTarget.style.background = C.inputBg;
                    }}
                  />
                </label>
              ))}
            </div>

            {/* Date de naissance OBLIGATOIRE — utilisée pour envoyer
                automatiquement un cadeau anniversaire au client (widget
                Anniversaires côté Direction). */}
            <label className="block">
              <span
                className="mono mb-2 block text-[9px] uppercase tracking-[0.2em]"
                style={{ color: C.back }}
              >
                {t('create.dobLabel')} *
              </span>
              <input
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                disabled={isPending}
                required
                max={new Date().toISOString().split('T')[0]}
                min="1900-01-01"
                autoComplete="bday"
                className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all disabled:opacity-50"
                style={{
                  background: C.inputBg,
                  border: `1px solid ${C.inputBorder}`,
                  color: C.inputText,
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = C.inputBorderFocus;
                  e.currentTarget.style.background = '#FFFFFF';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = C.inputBorder;
                  e.currentTarget.style.background = C.inputBg;
                }}
              />
              <p className="mono mt-2 text-[10px] leading-tight" style={{ color: C.subtitle }}>
                {t('create.dobHint')}
              </p>
            </label>

            {/* Email : déjà saisi à l'étape login + affiché en read-only en
                haut du formulaire. Pas de duplicat ici — le champ est verrouillé
                pour éviter qu'un client typo son email entre login et inscription. */}

            {formError && (
              <p className="border-red/30 bg-red/10 text-red rounded-xl border px-4 py-2.5 text-xs">
                {formError}
              </p>
            )}

            <button
              type="submit"
              disabled={isPending || !tenantSession}
              className="btn-press mt-1 w-full rounded-xl py-3.5 text-sm font-semibold transition-opacity disabled:opacity-30"
              style={{ background: C.btn, color: C.btnText }}
            >
              {isPending ? t('create.submitting') : t('create.submit')}
            </button>

            {!tenantSession && (
              <p className="text-center text-xs" style={{ color: C.subtitle }}>
                {t('create.demoMode')}
              </p>
            )}
          </form>
        </div>
      </div>
    );
  }

  // ── Profil existant (mode === 'profile') ─────────────────────────────
  // La carte de points est toujours rendue (0 pts si pas encore de RDV payé).
  return (
    <div
      className="min-h-screen"
      style={{
        background: `radial-gradient(ellipse 110% 60% at 50% 0%, #ECEAE4 0%, ${C.bg} 50%, #EDECEA 100%)`,
      }}
    >
      <div className="mx-auto max-w-2xl px-6 py-10">
        {/* ── En-tête ─────────────────────────────────────────────────── */}
        <div className="mb-8">
          <div
            className="mono mb-2 text-[9px] uppercase tracking-[0.4em]"
            style={{ color: C.back }}
          >
            {t('loyalty.eyebrow')}
          </div>
          <h2 className="display text-4xl leading-tight" style={{ color: C.title }}>
            {t('loyalty.titleBefore')}
            <span className="display-i" style={{ color: C.btn }}>
              {t('loyalty.titleAccent')}
            </span>
          </h2>
        </div>

        {/* ── Carte de fidélité ─────────────────────────────────────── */}
        <div
          className="fade-up mb-6 overflow-hidden rounded-2xl"
          style={{ boxShadow: C.cardShadow, border: `1px solid ${C.cardBorder}` }}
        >
          {/* Bandeau charcoal */}
          <div
            className="flex items-center justify-between px-6 py-4"
            style={{ background: C.btn }}
          >
            <span
              className="mono text-[9px] uppercase tracking-[0.25em]"
              style={{ color: 'rgba(255,255,255,0.45)' }}
            >
              {t('loyalty.cardLabel', { salonName })}
            </span>
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold"
              style={{
                background: 'rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.6)',
                border: '1px solid rgba(255,255,255,0.18)',
              }}
            >
              {salonInitials(salonName)}
            </div>
          </div>
          {/* Corps blanc */}
          <div className="px-6 py-5" style={{ background: C.card }}>
            {loading ? (
              <div
                className="h-14 w-32 animate-pulse rounded-lg"
                style={{ background: C.inputBg }}
              />
            ) : (
              <>
                {/* Solde principal = wallet cashback (en devise du salon).
                    On affiche le montant cumulé que le client a gagné — c'est
                    plus parlant qu'un compteur de points abstraits. */}
                <div
                  className="mono display text-5xl font-bold tabular-nums"
                  style={{ color: C.title }}
                >
                  {fmtMoney(cashbackCents)}
                </div>
                <p className="mt-2 text-xs" style={{ color: C.subtitle }}>
                  {t('loyalty.cashbackRule', { points })}
                </p>
              </>
            )}
          </div>
        </div>

        {/* ── Historique cashback ────────────────────────────────────
            Liste compacte des 5 derniers événements cashback (gagné +
            utilisé), tirée des sales déjà chargées. Le gain est calculé
            au taux ACTUEL du salon (compromis : exact si le taux n'a pas
            changé, approximatif sinon — acceptable pour de l'historique
            non-comptable côté client). Audit T5.14. */}
        {phone &&
          tenantSession &&
          tenantSession.settings.cashback_rate_bp > 0 &&
          sales.length > 0 &&
          (() => {
            // On construit une timeline triée des évènements cashback :
            // chaque sale produit (1) un gain (toujours, sauf si refunded)
            // et (2) éventuellement un usage (si cashback_redeemed_cents > 0).
            type CashbackEvent = {
              kind: 'earned' | 'redeemed';
              cents: number;
              date: string;
              time: string;
              key: string;
            };
            const rate = tenantSession.settings.cashback_rate_bp;
            const events: CashbackEvent[] = [];
            for (const s of sales) {
              if (!s.refunded) {
                const earned = Math.round((s.subtotalCents * rate) / 10_000);
                if (earned > 0) {
                  events.push({
                    kind: 'earned',
                    cents: earned,
                    date: s.date,
                    time: s.time,
                    key: `${s.id}-earn`,
                  });
                }
              }
              if (s.cashbackRedeemedCents > 0) {
                events.push({
                  kind: 'redeemed',
                  cents: s.cashbackRedeemedCents,
                  date: s.date,
                  time: s.time,
                  key: `${s.id}-redeem`,
                });
              }
            }
            // Sales déjà triées DESC (récent → ancien) côté serveur, mais on
            // re-trie par sécurité.
            events.sort((a, b) =>
              a.date === b.date ? b.time.localeCompare(a.time) : b.date.localeCompare(a.date),
            );
            const preview = events.slice(0, 5);
            if (preview.length === 0) return null;
            return (
              <div className="mb-6">
                <div
                  className="mono mb-3 text-[9px] uppercase tracking-[0.25em]"
                  style={{ color: C.back }}
                >
                  {t('loyalty.cashbackHistoryHeader')}
                </div>
                <div
                  className="rounded-2xl p-2"
                  style={{
                    background: C.card,
                    border: `1px solid ${C.cardBorder}`,
                    boxShadow: C.cardShadow,
                  }}
                >
                  <ul className="divide-y" style={{ borderColor: C.separator }}>
                    {preview.map((e) => {
                      const isEarn = e.kind === 'earned';
                      return (
                        <li
                          key={e.key}
                          className="flex items-center justify-between px-3 py-2.5 text-sm"
                        >
                          <div>
                            <div className="font-medium" style={{ color: C.title }}>
                              {isEarn
                                ? t('loyalty.cashbackEarnedLabel')
                                : t('loyalty.cashbackRedeemedLabel')}
                            </div>
                            <div className="mono mt-0.5 text-[10px]" style={{ color: C.subtitle }}>
                              {new Date(e.date).toLocaleDateString(profileBcp47, {
                                day: 'numeric',
                                month: 'short',
                              })}{' '}
                              · {e.time}
                            </div>
                          </div>
                          <div
                            className="mono text-sm font-semibold"
                            style={{ color: isEarn ? '#3d5d2a' : '#A4453D' }}
                          >
                            {isEarn ? '+' : '−'}
                            {fmtMoney(e.cents)}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            );
          })()}

        {/* ── Vos avis ──────────────────────────────────────────────── */}
        {phone && (visitsLoading || visits.length > 0 || submittedVisits.size > 0) && (
          <div className="mb-6">
            <div
              className="mono mb-3 text-[9px] uppercase tracking-[0.25em]"
              style={{ color: C.back }}
            >
              {t('reviews.header')}
            </div>
            {visitsLoading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-28 animate-pulse rounded-2xl"
                    style={{ background: C.card, border: `1px solid ${C.cardBorder}` }}
                  />
                ))}
              </div>
            ) : visits.length === 0 ? (
              <div
                className="rounded-2xl p-5 text-center"
                style={{
                  background: C.card,
                  border: `1px solid ${C.cardBorder}`,
                  boxShadow: C.cardShadow,
                }}
              >
                <Star className="mx-auto mb-2 h-6 w-6" style={{ color: C.back }} strokeWidth={1} />
                <p className="text-xs" style={{ color: C.subtitle }}>
                  {t('reviews.allSubmitted')}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {visits.map((visit) => {
                  const selectedRating = pendingRatings[visit.id] ?? 0;
                  const isBusy = submittingVisit === visit.id;
                  return (
                    <div
                      key={visit.id}
                      className="rounded-2xl p-5"
                      style={{
                        background: C.card,
                        border: `1px solid ${C.cardBorder}`,
                        boxShadow: C.cardShadow,
                      }}
                    >
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="display truncate text-lg" style={{ color: C.title }}>
                            {visit.barberName}
                          </div>
                          <div className="mt-0.5 truncate text-xs" style={{ color: C.subtitle }}>
                            {visit.label}
                          </div>
                          <div
                            className="mono mt-0.5 text-[9px] uppercase tracking-[0.15em]"
                            style={{ color: C.back }}
                          >
                            {new Date(visit.date).toLocaleDateString('fr-FR', {
                              day: 'numeric',
                              month: 'long',
                            })}
                          </div>
                        </div>
                        {/* Étoiles */}
                        <div className="flex shrink-0 gap-1">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <button
                              key={star}
                              type="button"
                              disabled={isBusy}
                              onClick={() => setPendingRatings((r) => ({ ...r, [visit.id]: star }))}
                              className="btn-press"
                            >
                              <Star
                                className={`h-6 w-6 transition-colors ${
                                  star <= selectedRating
                                    ? 'fill-brand-primary text-brand-primary'
                                    : ''
                                }`}
                                style={star > selectedRating ? { color: C.inputBorder } : undefined}
                                strokeWidth={1.5}
                              />
                            </button>
                          ))}
                        </div>
                      </div>
                      {selectedRating > 0 && (
                        <textarea
                          value={pendingComments[visit.id] ?? ''}
                          onChange={(e) =>
                            setPendingComments((c) => ({ ...c, [visit.id]: e.target.value }))
                          }
                          placeholder={t('reviews.commentPlaceholder')}
                          rows={2}
                          disabled={isBusy}
                          className="mb-3 w-full resize-none rounded-xl px-4 py-3 text-sm outline-none transition-all disabled:opacity-50"
                          style={{
                            background: C.inputBg,
                            border: `1px solid ${C.inputBorder}`,
                            color: C.inputText,
                          }}
                          onFocus={(e) => {
                            e.currentTarget.style.borderColor = C.inputBorderFocus;
                            e.currentTarget.style.background = '#FFFFFF';
                          }}
                          onBlur={(e) => {
                            e.currentTarget.style.borderColor = C.inputBorder;
                            e.currentTarget.style.background = C.inputBg;
                          }}
                        />
                      )}
                      {ratingErrors[visit.id] && (
                        <p className="border-red/30 bg-red/10 text-red mb-3 rounded-xl border px-4 py-2.5 text-xs">
                          {ratingErrors[visit.id]}
                        </p>
                      )}
                      <button
                        type="button"
                        disabled={!selectedRating || isBusy || !tenantSession}
                        onClick={() => handleSubmitRating(visit)}
                        className="btn-press w-full rounded-xl py-3 text-sm font-semibold transition-opacity disabled:opacity-30"
                        style={{ background: C.btn, color: C.btnText }}
                      >
                        {isBusy ? t('reviews.submitting') : t('reviews.submit')}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Mes factures (sales) — historique d'achats ─────────────── */}
        {phone && (salesLoading || sales.length > 0) && (
          <div className="mb-6">
            <div
              className="mono mb-3 text-[9px] uppercase tracking-[0.25em]"
              style={{ color: C.back }}
            >
              {t('invoices.header')}
            </div>
            {salesLoading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-20 animate-pulse rounded-2xl"
                    style={{ background: C.card, border: `1px solid ${C.cardBorder}` }}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {sales.map((s) => {
                  const methodLabel =
                    s.method === 'card'
                      ? t('invoices.methodCard')
                      : s.method === 'cash'
                        ? t('invoices.methodCash')
                        : t('invoices.methodMobile');
                  const itemsLabel = s.items.map((i) => i.name).join(' + ');
                  const refunded = s.refunded === true;
                  const tenantCurrency = tenantSession?.tenant.currency ?? 'EGP';
                  void tenantCurrency;
                  // Le PDF est désormais généré ENTIÈREMENT serveur-side.
                  // Le client reçoit base64 + filename + hash et fait juste
                  // un blob download → impossible de modifier le contenu
                  // (ni les données, ni le rendu jsPDF qui tourne en Node,
                  // ni le footer signé HMAC qui authentifie sale+total).
                  const isDownloading = downloadingId === s.id;
                  const handleDownload = async () => {
                    if (!tenantId || isDownloading) return;
                    setDownloadingId(s.id);
                    try {
                      const localeNorm: 'fr' | 'en' | 'ar' =
                        profileLocale === 'ar' ? 'ar' : profileLocale === 'en' ? 'en' : 'fr';
                      const res = await downloadReceiptPdfServer(tenantId, s.id, phone, localeNorm);
                      if (!res.ok) {
                        // Pas de toast (rate-limit silencieux) ; le bouton se
                        // réactive auto via le finally.
                        return;
                      }
                      // Décode base64 → Blob → trigger download natif.
                      const byteString = atob(res.pdfBase64);
                      const bytes = new Uint8Array(byteString.length);
                      for (let i = 0; i < byteString.length; i++) {
                        bytes[i] = byteString.charCodeAt(i);
                      }
                      const blob = new Blob([bytes], { type: 'application/pdf' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = res.filename;
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    } finally {
                      setDownloadingId(null);
                    }
                  };
                  return (
                    <div
                      key={s.id}
                      className={`flex items-center justify-between gap-4 rounded-2xl p-4 ${refunded ? 'opacity-60' : ''}`}
                      style={{
                        background: C.card,
                        border: `1px solid ${C.cardBorder}`,
                        boxShadow: C.cardShadow,
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div
                          className={`display flex items-center gap-2 truncate text-sm leading-tight ${refunded ? 'line-through' : ''}`}
                          style={{ color: C.title }}
                        >
                          <span className="truncate">{itemsLabel || methodLabel}</span>
                          {refunded && (
                            <span
                              className="mono shrink-0 rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wider"
                              style={{ background: '#E84B4B22', color: '#C73838' }}
                            >
                              {t('invoices.refundedTag')}
                            </span>
                          )}
                        </div>
                        <div
                          className="mono mt-1 flex items-center gap-2 truncate text-[10px] uppercase tracking-wider"
                          style={{ color: C.subtitle }}
                        >
                          <span>
                            {new Date(s.date).toLocaleDateString(profileBcp47, {
                              day: 'numeric',
                              month: 'long',
                              year: 'numeric',
                            })}
                          </span>
                          <span>· {s.time}</span>
                          <span>· {methodLabel}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <div
                          className={`display mono text-xl ${refunded ? 'line-through' : ''}`}
                          style={{ color: C.title }}
                        >
                          {(s.totalCents / 100).toLocaleString(profileBcp47, {
                            style: 'currency',
                            currency: tenantCurrency,
                            maximumFractionDigits: 0,
                          })}
                        </div>
                        <button
                          type="button"
                          onClick={handleDownload}
                          disabled={isDownloading}
                          aria-label={t('invoices.downloadPdfAria')}
                          title={t('invoices.downloadPdf')}
                          className={`btn-press flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
                            isDownloading ? 'animate-pulse cursor-wait opacity-50' : ''
                          }`}
                          style={{ background: C.card, border: `1px solid ${C.cardBorder}` }}
                        >
                          <Download className="h-4 w-4" strokeWidth={1.5} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Téléphone + formulaire ────────────────────────────────── */}
        {phone && (
          <>
            {/* Identité enregistrée + bouton déconnexion proéminent */}
            <div
              className="mb-4 rounded-2xl px-5 py-4"
              style={{
                background: C.card,
                border: `1px solid ${C.cardBorder}`,
                boxShadow: C.cardShadow,
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  {email && (
                    <div
                      className="flex min-w-0 items-center gap-2 truncate text-sm"
                      style={{ color: C.title }}
                    >
                      <AtSign className="h-3.5 w-3.5 shrink-0" style={{ color: C.back }} />
                      <span className="truncate">{email}</span>
                    </div>
                  )}
                  <div
                    className="mono flex items-center gap-2 text-xs"
                    style={{ color: C.subtitle }}
                  >
                    <Phone className="h-3 w-3 shrink-0" style={{ color: C.back }} />
                    {phone}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void logoutClient(); // efface le cookie de session httpOnly
                    onPhoneChange('');
                    setMode('login');
                    setLoginEmail('');
                    setSignupPhone('');
                  }}
                  className="btn-press inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold"
                  style={{
                    background: C.inputBg,
                    border: `1px solid ${C.cardBorder}`,
                    color: C.title,
                  }}
                  aria-label={t('edit.logout')}
                >
                  <LogOut className="h-3.5 w-3.5" strokeWidth={1.8} />
                  <span>{t('edit.logout')}</span>
                </button>
              </div>
            </div>

            {/* Formulaire mise à jour */}
            <div
              className="rounded-2xl p-6"
              style={{
                background: C.card,
                border: `1px solid ${C.cardBorder}`,
                boxShadow: C.cardShadow,
              }}
            >
              <form onSubmit={handleSave} className="space-y-4">
                <div
                  className="mono text-[10px] uppercase tracking-[0.2em]"
                  style={{ color: C.back }}
                >
                  {t('edit.sectionHeader')}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      {
                        id: 'fn',
                        label: t('edit.firstNameLabel'),
                        value: firstName,
                        setter: setFirstName,
                        placeholder: t('edit.firstNamePlaceholder'),
                      },
                      {
                        id: 'ln',
                        label: t('edit.lastNameLabel'),
                        value: lastName,
                        setter: setLastName,
                        placeholder: t('edit.lastNamePlaceholder'),
                      },
                    ] as const
                  ).map(({ id, label, value, setter, placeholder }) => (
                    <label key={id} className="block">
                      <span
                        className="mono mb-2 block text-[9px] uppercase tracking-[0.2em]"
                        style={{ color: C.back }}
                      >
                        {label}
                      </span>
                      <input
                        type="text"
                        value={value}
                        onChange={(e) => setter(e.target.value)}
                        placeholder={placeholder}
                        disabled={isPending || !tenantSession}
                        className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all disabled:opacity-50"
                        style={{
                          background: C.inputBg,
                          border: `1px solid ${C.inputBorder}`,
                          color: C.inputText,
                        }}
                        onFocus={(e) => {
                          e.currentTarget.style.borderColor = C.inputBorderFocus;
                          e.currentTarget.style.background = '#FFFFFF';
                        }}
                        onBlur={(e) => {
                          e.currentTarget.style.borderColor = C.inputBorder;
                          e.currentTarget.style.background = C.inputBg;
                        }}
                      />
                    </label>
                  ))}
                </div>

                <label className="block">
                  <span
                    className="mono mb-2 block text-[9px] uppercase tracking-[0.2em]"
                    style={{ color: C.back }}
                  >
                    {t('edit.dobLabel')}{' '}
                    <span className="font-normal normal-case">{t('edit.optional')}</span>
                  </span>
                  <input
                    type="date"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    disabled={isPending || !tenantSession}
                    className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all disabled:opacity-50"
                    style={{
                      background: C.inputBg,
                      border: `1px solid ${C.inputBorder}`,
                      color: C.inputText,
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = C.inputBorderFocus;
                      e.currentTarget.style.background = '#FFFFFF';
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = C.inputBorder;
                      e.currentTarget.style.background = C.inputBg;
                    }}
                  />
                </label>

                <label className="block">
                  <span
                    className="mono mb-2 block text-[9px] uppercase tracking-[0.2em]"
                    style={{ color: C.back }}
                  >
                    {t('edit.emailLabel')}{' '}
                    <span className="font-normal normal-case">{t('edit.optional')}</span>
                  </span>
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('edit.emailPlaceholder')}
                    disabled={isPending || !tenantSession}
                    className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all disabled:opacity-50"
                    style={{
                      background: C.inputBg,
                      border: `1px solid ${C.inputBorder}`,
                      color: C.inputText,
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = C.inputBorderFocus;
                      e.currentTarget.style.background = '#FFFFFF';
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = C.inputBorder;
                      e.currentTarget.style.background = C.inputBg;
                    }}
                  />
                </label>

                {formError && (
                  <p className="border-red/30 bg-red/10 text-red rounded-xl border px-4 py-2.5 text-xs">
                    {formError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={isPending || !tenantSession}
                  className="btn-press mt-1 w-full rounded-xl py-3.5 text-sm font-semibold transition-opacity disabled:opacity-30"
                  style={{ background: C.btn, color: C.btnText }}
                >
                  {isPending ? (
                    t('edit.submitting')
                  ) : saved ? (
                    <span className="flex items-center justify-center gap-2">
                      <Check className="h-4 w-4" />
                      {t('edit.saved')}
                    </span>
                  ) : (
                    t('edit.submit')
                  )}
                </button>

                {!tenantSession && (
                  <p className="text-center text-xs" style={{ color: C.subtitle }}>
                    {t('edit.demoMode')}
                  </p>
                )}
              </form>
            </div>

            {/* Zone danger — suppression de compte (RGPD). Affichée uniquement
                pour un vrai tenant + phone connue. La suppression est
                irreversible et passe par double confirmation. Audit T5.16. */}
            {tenantSession && phone && (
              <div
                className="mt-6 rounded-2xl p-5"
                style={{
                  background: '#FFFFFF',
                  border: '1px solid #F2D0CC',
                  boxShadow: C.cardShadow,
                }}
              >
                <div
                  className="mono mb-2 text-[10px] uppercase tracking-[0.2em]"
                  style={{ color: '#A4453D' }}
                >
                  {t('edit.dangerHeader')}
                </div>
                <p className="mb-3 text-xs leading-relaxed" style={{ color: C.subtitle }}>
                  {t('edit.dangerDescription')}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    // Double confirm — phrase explicite à taper pour eviter
                    // les clics accidentels (le bouton est petit mais la
                    // perte est definitive).
                    const phrase = t('edit.deleteConfirmPhrase');
                    const typed = prompt(t('edit.deleteConfirmPrompt', { phrase }));
                    if (!typed || typed.trim() !== phrase) return;
                    if (!tenantId) return;
                    void deleteClientAccount(tenantId, phone).then((res) => {
                      if (!res.ok) {
                        setFormError(tErrors(res.errorKey, res.errorValues));
                        return;
                      }
                      // Vide la session (cookie httpOnly + état) puis login.
                      void logoutClient();
                      onPhoneChange('');
                      setMode('login');
                      setLoginEmail('');
                      setSignupPhone('');
                      // Force un reload pour purger toutes les caches client.
                      if (typeof window !== 'undefined') window.location.reload();
                    });
                  }}
                  className="btn-press inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold"
                  style={{
                    background: '#FCEEEC',
                    border: '1px solid #F2D0CC',
                    color: '#A4453D',
                  }}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                  {t('edit.deleteAccountBtn')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
