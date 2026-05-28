/**
 * Page MARKETING /site — Aboodhairsalon (design éditorial 2026)
 *
 * Cohérence visuelle avec l'app client booking (palette LC cream + noir + or).
 * Layout éditorial Sender-style : rounded-3xl partout, ombres douces, photo
 * grid services data-driven depuis la DB.
 *
 * Source de vérité : la DB. Les services, horaires, contacts viennent de
 * `getSiteTenantData()` — toute modif dans le manager se reflète ici sans
 * redéploiement.
 *
 * Route : `app.system-aone.com/aboodhairsalon/site` (path-based)
 * → WordPress aboodhairsalon.com reste intact.
 */
import { ArrowRight, Calendar, Clock, MapPin, Phone, Star } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { LocaleSwitcher } from '../_components/LocaleSwitcher';
import { getSiteTenantData, type SiteTenantData } from './data';
import { MobileNav } from './MobileNav';

type SiteT = Awaited<ReturnType<typeof getTranslations<'site'>>>;

// Logo Instagram SVG (lucide v1.16 ne l'expose pas)
function Instagram({
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

// ─── Palette alignée sur l'app client (LC) — cream + noir + or doux ────────
const C = {
  bg: '#F4F3F0', // cream principal (= client LC.bg)
  bgSoft: '#EEECEA', // alt soft (= LC.inputBg)
  card: '#FFFFFF',
  text: '#18160F', // (= LC.title)
  textMuted: '#8A8478', // (= LC.subtitle)
  textSubtle: '#A8A49C', // (= LC.back)
  accent: '#E0A23D', // gold doux (= STAR_GOLD client)
  btn: '#1A1714', // noir CTA (= LC.btn)
  btnText: '#FFFFFF', // (= LC.btnText)
  border: '#E4E2DC', // (= LC.cardBorder)
  shadow: '0 4px 32px rgba(40,35,28,0.09), 0 1px 4px rgba(40,35,28,0.06)',
  shadowLg: '0 24px 64px rgba(40,35,28,0.12), 0 4px 12px rgba(40,35,28,0.08)',
};

// ─── Assets Supabase Storage (migrés vers le projet dédié Aboodhairsalon) ───
// Host dérivé de NEXT_PUBLIC_SUPABASE_URL → reste lié au projet configuré et
// ne réintroduit jamais une dépendance vers l'ancien storage System A.
const ST = `${process.env['NEXT_PUBLIC_SUPABASE_URL']}/storage/v1/object/public/salon-gallery/tenant/fa508622-b027-4907-9508-afd2e9f83eeb/wp-snapshot`;
const IMG = {
  logo: `${ST}/wp-logo.png`,
  owner: `${ST}/wp-owner.jpeg`,
  shots: [
    `${ST}/wp-shot-1.jpeg`,
    `${ST}/wp-shot-2.webp`,
    `${ST}/wp-shot-3.webp`,
    `${ST}/wp-shot-4.jpeg`,
    `${ST}/wp-shot-5.jpeg`,
    `${ST}/wp-shot-6.jpeg`,
  ],
  gallery: [
    `${ST}/wp-gal-1.jpg`,
    `${ST}/wp-gal-2.jpg`,
    `${ST}/wp-gal-3.jpg`,
    `${ST}/wp-gal-4.jpg`,
    `${ST}/wp-gal-5.jpg`,
    `${ST}/wp-gal-6.jpg`,
    `${ST}/wp-gal-7.jpg`,
  ],
};

// Photos servies par service — ordre matche le sort_order de la DB :
//   1 → Standard Haircut, 2 → Hair Coloring, 3 → Beard Trim,
//   4 → Beard Coloring, 5 → Oil Treatment, 6 → Facial Cleansing,
//   7 → Caviar Hair Treatment, 8 → Full Hair Color,
//   9 → Manicure & Pedicure, 10 → Skin Care
const SERVICE_PHOTOS = [
  `${ST}/wp-svc-1.png`,
  `${ST}/wp-svc-2.png`,
  `${ST}/wp-svc-3.png`,
  `${ST}/wp-svc-4.png`,
  `${ST}/wp-svc-5.png`,
  `${ST}/wp-svc-6.png`,
  `${ST}/wp-svc-7.png`,
  `${ST}/wp-svc-8.png`,
  `${ST}/wp-svc-9.jpg`,
  `${ST}/wp-svc-10.jpg`,
];

const HERO_VIDEO_ID = '7KR3t_9qrGs';
const BOOK_URL = 'https://book.aboodhairsalon.com';

// ─── Branches du salon (à terme dans la DB via une migration `tenant_branches`)
// Pour l'instant hardcodé — les 2 adresses physiques d'Aboodhairsalon.
const BRANCHES: Array<{ name: string; address: string; mapsUrl: string }> = [
  {
    name: 'Smouha',
    address:
      'Smouha Square, Transportation and Engineering Street, Smouha Terrace, Building C, Alexandria',
    mapsUrl: 'https://maps.google.com/?q=Smouha+Square+Alexandria',
  },
  {
    name: 'San Stefano',
    address: '12 Street Kazeno, San Stefano, Alexandria',
    mapsUrl: 'https://maps.app.goo.gl/BuauYny4QJrpe5zh9?g_st=iw',
  },
];

// ─── Hours parsing (depuis tenant_settings.hours_text JSON) ────────────────
type DayKey = 'lun' | 'mar' | 'mer' | 'jeu' | 'ven' | 'sam' | 'dim';
type HoursMap = Record<DayKey, { open: boolean; slots: Array<{ from: string; to: string }> }>;

function parseHours(raw: string | null): HoursMap | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as HoursMap;
  } catch {
    return null;
  }
}

function formatTime(t: string): string {
  const [hStr] = t.split(':');
  const h = parseInt(hStr ?? '0', 10);
  if (h === 0) return '12am';
  if (h < 12) return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

function summarizeHours(hours: HoursMap | null, t: SiteT): string {
  if (!hours) return t('hours.defaultLabel');
  const days: DayKey[] = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
  const lun = hours.lun?.slots?.[0];
  if (!lun) return t('hours.defaultLabel');
  const allSame = days.every((d) => {
    const a = hours[d]?.slots?.[0];
    return hours[d]?.open === hours.lun?.open && a?.from === lun.from && a?.to === lun.to;
  });
  if (allSame && hours.lun?.open) {
    return `${t('hours.everyDay')} · ${formatTime(lun.from)} — ${formatTime(lun.to)}`;
  }
  return t('hours.defaultLabel');
}

// ─── PAGE ─────────────────────────────────────────────────────────────────
export default async function SitePage() {
  const data = await getSiteTenantData();
  if (!data) redirect('/client');
  const { tenant, branding, settings, services } = data;

  const locale = await getLocale();
  const t = await getTranslations('site');
  const isRtl = locale === 'ar';

  const phone = settings.contact_phone ?? '+20 122 329 5647';
  const phoneTel = phone.replace(/\s+/g, '');
  const igUrl = settings.contact_instagram ?? 'https://www.instagram.com/aboodhairsalon/';
  const hours = parseHours(settings.hours_text);
  const hoursLabel = summarizeHours(hours, t);

  return (
    <main
      dir={isRtl ? 'rtl' : 'ltr'}
      style={{ background: C.bg, color: C.text }}
      className="min-h-screen antialiased"
    >
      <Nav t={t} tenantName={tenant.name} logoUrl={branding.logo_url ?? IMG.logo} />
      <Hero t={t} hoursLabel={hoursLabel} />
      <Services t={t} services={services} />
      <About t={t} />
      <Location t={t} phone={phone} phoneTel={phoneTel} hoursLabel={hoursLabel} />
      <CtaBig t={t} />
      <Footer
        t={t}
        tenantName={tenant.name}
        logoUrl={branding.logo_url ?? IMG.logo}
        instagram={igUrl}
        hoursLabel={hoursLabel}
      />
    </main>
  );
}

// ═════════════════════════════════════════════════════════════════════════════

function Nav({ t, tenantName, logoUrl }: { t: SiteT; tenantName: string; logoUrl: string }) {
  const links = [
    { href: '#services', label: t('nav.services') },
    { href: '#about', label: t('nav.about') },
    { href: '#location', label: t('nav.location') },
  ];
  return (
    <header
      className="sticky top-0 z-40"
      style={{
        background: 'rgba(244,243,240,0.85)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3 sm:px-8 sm:py-4">
        <a href="#top" className="flex items-center gap-3">
          <Image
            src={logoUrl}
            alt={tenantName}
            width={40}
            height={40}
            className="h-10 w-10 rounded-2xl object-cover"
            style={{ border: `1px solid ${C.border}` }}
            unoptimized
          />
          <span className="text-sm font-semibold tracking-tight" style={{ color: C.text }}>
            {tenantName}
          </span>
        </a>
        <nav className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <NavLink key={link.href} href={link.href}>
              {link.label}
            </NavLink>
          ))}
        </nav>
        {/* Desktop CTA + LocaleSwitcher */}
        <div className="hidden items-center gap-3 md:flex">
          <LocaleSwitcher variant="auth" />
          <a
            href={BOOK_URL}
            className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-all hover:opacity-90"
            style={{
              background: C.btn,
              color: C.btnText,
              boxShadow: '0 4px 16px rgba(26,23,20,0.18)',
            }}
          >
            {t('nav.bookNow')}
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.4} />
          </a>
        </div>
        {/* Mobile : hamburger + drawer */}
        <MobileNav
          links={links}
          bookUrl={BOOK_URL}
          bookLabel={t('nav.bookNow')}
          tenantName={tenantName}
          logoUrl={logoUrl}
        />
      </div>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="rounded-full px-4 py-2 text-sm font-medium transition-colors hover:bg-black/5"
      style={{ color: C.textMuted }}
    >
      {children}
    </a>
  );
}

// ─── HERO ─────────────────────────────────────────────────────────────────
// 2 sections empilées :
//  1) Video banner — strict 16:9, vidéo fills à 100%, aucun crop ni letterbox
//  2) Content cream — heading + tagline + CTAs + trust row, theme cream
// Plus d'overlay = la vidéo respire toujours, le contenu est toujours lisible
// quel que soit le viewport (desktop, tablet, mobile).
function Hero({ t, hoursLabel }: { t: SiteT; hoursLabel: string }) {
  const ytSrc = `https://www.youtube-nocookie.com/embed/${HERO_VIDEO_ID}?autoplay=1&mute=1&loop=1&playlist=${HERO_VIDEO_ID}&controls=0&playsinline=1&modestbranding=1&rel=0&iv_load_policy=3&disablekb=1`;

  return (
    <>
      {/* ━━━ Section 1 : Vidéo banner pur 16:9 ━━━
          Pas de -mt négatif : la vidéo commence SOUS le Nav (pas dessous),
          du coup elle est 100% visible jamais cachée par la barre. */}
      <section
        id="top"
        className="relative w-full overflow-hidden"
        style={{ background: '#0F0F0F', aspectRatio: '16 / 9' }}
      >
        {/* Poster fallback */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: `url(${IMG.gallery[0]}) center/cover` }}
        />
        {/* Iframe : remplit parfaitement le 16:9, aucun crop */}
        <iframe
          src={ytSrc}
          title=""
          allow="autoplay; encrypted-media; picture-in-picture"
          loading="lazy"
          className="absolute inset-0 h-full w-full"
          style={{ border: 0, pointerEvents: 'none' }}
        />
      </section>

      {/* ━━━ Section 2 : Contenu cream sous la vidéo ━━━ */}
      <section className="px-5 py-16 sm:px-8 sm:py-20" style={{ background: C.bg }}>
        <div className="mx-auto max-w-3xl text-center">
          <div
            className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider"
            style={{
              background: C.bgSoft,
              color: C.textMuted,
              border: `1px solid ${C.border}`,
            }}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: C.accent }}
            />
            {t('hero.badge')}
          </div>

          <h1
            className="mt-6 text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl"
            style={{ color: C.text, letterSpacing: '-0.025em' }}
          >
            {t('hero.headingPrefix')}
            <br />
            {t('hero.headingMid')}{' '}
            <span
              style={{
                color: C.accent,
                fontStyle: 'italic',
                fontWeight: 500,
              }}
            >
              {t('hero.headingHighlight')}
            </span>
            .
          </h1>

          <p
            className="mx-auto mt-6 max-w-xl text-base leading-relaxed sm:text-lg"
            style={{ color: C.textMuted }}
          >
            {t('hero.tagline')}
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <a
              href={BOOK_URL}
              className="inline-flex items-center gap-2 rounded-full px-7 py-4 text-sm font-semibold transition-all hover:opacity-90"
              style={{
                background: C.btn,
                color: C.btnText,
                boxShadow: '0 12px 32px rgba(26,23,20,0.18)',
              }}
            >
              <Calendar className="h-4 w-4" strokeWidth={2.4} />
              {t('hero.bookCta')}
              <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
            </a>
            <a
              href="#services"
              className="inline-flex items-center gap-2 rounded-full px-7 py-4 text-sm font-semibold transition-all hover:bg-black/5"
              style={{ color: C.text, border: `1px solid ${C.border}` }}
            >
              {t('hero.viewServices')}
            </a>
          </div>

          {/* Trust row sur cream */}
          <div
            className="mt-10 flex flex-wrap items-center justify-center gap-x-7 gap-y-3 text-[13px]"
            style={{ color: C.textMuted }}
          >
            <span className="inline-flex items-center gap-2">
              <Star className="h-4 w-4 fill-current" strokeWidth={0} style={{ color: C.accent }} />
              <strong style={{ color: C.text }}>4.8</strong> · {t('hero.trustRating')}
            </span>
            <span className="inline-flex items-center gap-2">
              <Clock className="h-4 w-4" strokeWidth={1.8} style={{ color: C.accent }} />
              {hoursLabel}
            </span>
            <span className="inline-flex items-center gap-2">
              <MapPin className="h-4 w-4" strokeWidth={1.8} style={{ color: C.accent }} />
              {BRANCHES.map((b) => b.name).join(' · ')} · Alexandria
            </span>
          </div>
        </div>
      </section>
    </>
  );
}

// ─── SERVICES (data-driven, grid avec photo par service) ──────────────────
function Services({ t, services }: { t: SiteT; services: SiteTenantData['services'] }) {
  return (
    <section id="services" className="px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <div
            className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider"
            style={{
              background: C.bgSoft,
              color: C.textMuted,
              border: `1px solid ${C.border}`,
            }}
          >
            {t('services.badge')}
          </div>
          <h2
            className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl"
            style={{ color: C.text, letterSpacing: '-0.02em' }}
          >
            {t('services.headingPrefix')}{' '}
            <span
              style={{
                color: C.accent,
                fontStyle: 'italic',
                fontWeight: 500,
              }}
            >
              {t('services.headingHighlight')}
            </span>
            .
          </h2>
          <p className="mt-4 text-base leading-relaxed sm:text-lg" style={{ color: C.textMuted }}>
            {t('services.tagline')}
          </p>
        </div>

        <div className="mt-14 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
          {services.map((sv, i) => (
            <article
              key={sv.id}
              className="group flex flex-col overflow-hidden rounded-3xl transition-all hover:-translate-y-1"
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                boxShadow: C.shadow,
              }}
            >
              <div
                className="relative aspect-[4/3] overflow-hidden"
                style={{ background: C.bgSoft }}
              >
                <Image
                  src={SERVICE_PHOTOS[i % SERVICE_PHOTOS.length] ?? SERVICE_PHOTOS[0]!}
                  alt={sv.name}
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 400px"
                  className="object-cover transition-all duration-500 group-hover:scale-105 group-hover:grayscale"
                />
              </div>
              <div className="flex flex-1 flex-col p-5 sm:p-6">
                <h3 className="text-lg font-semibold tracking-tight" style={{ color: C.text }}>
                  {sv.name}
                </h3>
                <div
                  className="mt-1 inline-flex items-center gap-1.5 text-xs"
                  style={{ color: C.textMuted }}
                >
                  <Clock className="h-3.5 w-3.5" strokeWidth={1.8} />
                  {sv.duration_min} {t('services.minSuffix')}
                </div>
                <div className="mt-auto pt-5">
                  <a
                    href={BOOK_URL}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition-all hover:opacity-90"
                    style={{ background: C.btn, color: C.btnText }}
                  >
                    {t('services.bookButton')}
                    <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── ABOUT ────────────────────────────────────────────────────────────────
function About({ t }: { t: SiteT }) {
  return (
    <section id="about" className="px-5 py-24 sm:px-8 sm:py-32" style={{ background: C.bgSoft }}>
      <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2 md:gap-16">
        <div
          className="relative aspect-[4/5] overflow-hidden rounded-[28px] md:rounded-[36px]"
          style={{ boxShadow: C.shadowLg }}
        >
          <Image
            src={IMG.owner}
            alt=""
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-cover transition-all duration-500 hover:grayscale"
          />
        </div>
        <div>
          <div
            className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider"
            style={{
              background: C.card,
              color: C.textMuted,
              border: `1px solid ${C.border}`,
            }}
          >
            {t('about.badge')}
          </div>
          <h2
            className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl"
            style={{ color: C.text, letterSpacing: '-0.02em' }}
          >
            {t('about.headingPrefix')}{' '}
            <span
              style={{
                color: C.accent,
                fontStyle: 'italic',
                fontWeight: 500,
              }}
            >
              {t('about.headingHighlight')}
            </span>
            .
          </h2>
          <p className="mt-6 text-base leading-relaxed sm:text-lg" style={{ color: C.textMuted }}>
            {t('about.description')}
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <a
              href={BOOK_URL}
              className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-all hover:opacity-90"
              style={{ background: C.btn, color: C.btnText }}
            >
              {t('about.bookChair')}
              <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
            </a>
            <a
              href="#location"
              className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-all hover:bg-black/5"
              style={{ color: C.text, border: `1px solid ${C.border}` }}
            >
              {t('about.visitShop')}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── LOCATION ─────────────────────────────────────────────────────────────
function Location({
  t,
  phone,
  phoneTel,
  hoursLabel,
}: {
  t: SiteT;
  phone: string;
  phoneTel: string;
  hoursLabel: string;
}) {
  return (
    <section id="location" className="px-5 py-24 sm:px-8 sm:py-32" style={{ background: C.bgSoft }}>
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <div
            className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider"
            style={{
              background: C.card,
              color: C.textMuted,
              border: `1px solid ${C.border}`,
            }}
          >
            {t('location.badge')}
          </div>
          <h2
            className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl"
            style={{ color: C.text, letterSpacing: '-0.02em' }}
          >
            {t('location.headingPrefix')}{' '}
            <span
              style={{
                color: C.accent,
                fontStyle: 'italic',
                fontWeight: 500,
              }}
            >
              {t('location.headingHighlight')}
            </span>
            .
          </h2>
        </div>

        {/* Grid uniforme : 2 branches + Phone + Hours, toutes en ContactCard
            identique avec `auto-rows-fr` qui force toutes les cards à avoir
            EXACTEMENT la même hauteur. Maps iframe virées (le bouton
            ouvre Google Maps de toute façon, plus propre visuellement). */}
        <div className="mt-12 grid auto-rows-fr grid-cols-2 gap-3 sm:gap-4">
          {BRANCHES.map((b) => (
            <ContactCard
              key={b.name}
              icon={<MapPin className="h-5 w-5" strokeWidth={1.8} style={{ color: C.accent }} />}
              label={`${b.name} ${t('location.branchSuffix')}`}
              value={b.address}
              action={{ href: b.mapsUrl, label: t('location.getDirections') }}
            />
          ))}
          <ContactCard
            icon={<Phone className="h-5 w-5" strokeWidth={1.8} style={{ color: C.accent }} />}
            label={t('location.phoneLabel')}
            value={phone}
            action={{ href: `tel:${phoneTel}`, label: t('location.callNow') }}
          />
          <ContactCard
            icon={<Clock className="h-5 w-5" strokeWidth={1.8} style={{ color: C.accent }} />}
            label={t('location.hoursLabel')}
            value={hoursLabel}
            action={{ href: BOOK_URL, label: t('location.bookOnline') }}
          />
        </div>
      </div>
    </section>
  );
}

function ContactCard({
  icon,
  label,
  value,
  action,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  action: { href: string; label: string };
}) {
  return (
    <div
      className="flex flex-col rounded-3xl p-6 sm:p-7"
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        boxShadow: C.shadow,
      }}
    >
      <div
        className="flex h-10 w-10 items-center justify-center rounded-full"
        style={{ background: C.bgSoft }}
      >
        {icon}
      </div>
      <div
        className="mt-4 text-[11px] font-medium uppercase tracking-wider"
        style={{ color: C.textMuted }}
      >
        {label}
      </div>
      <div className="mt-1 text-base leading-relaxed" style={{ color: C.text }}>
        {value}
      </div>
      <a
        href={action.href}
        target={action.href.startsWith('http') ? '_blank' : undefined}
        rel={action.href.startsWith('http') ? 'noopener noreferrer' : undefined}
        className="mt-auto inline-flex items-center gap-1.5 pt-5 text-sm font-semibold transition-colors hover:opacity-80"
        style={{ color: C.text }}
      >
        {action.label}
        <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.4} />
      </a>
    </div>
  );
}

// ─── CTA BIG ──────────────────────────────────────────────────────────────
function CtaBig({ t }: { t: SiteT }) {
  return (
    <section className="px-5 py-24 sm:px-8 sm:py-32">
      <div
        className="mx-auto max-w-5xl rounded-[32px] px-8 py-16 text-center sm:rounded-[40px] sm:px-12 sm:py-24"
        style={{
          background: C.btn,
          color: C.btnText,
          boxShadow: C.shadowLg,
        }}
      >
        <div
          className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider"
          style={{
            background: 'rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.72)',
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          {t('cta.badge')}
        </div>
        <h2
          className="mx-auto mt-6 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl"
          style={{ letterSpacing: '-0.02em' }}
        >
          {t('cta.headingPrefix')}{' '}
          <span
            style={{
              color: C.accent,
              fontStyle: 'italic',
              fontWeight: 500,
            }}
          >
            {t('cta.headingHighlight')}
          </span>
          .
        </h2>
        <p
          className="mx-auto mt-5 max-w-xl text-base leading-relaxed sm:text-lg"
          style={{ color: 'rgba(255,255,255,0.72)' }}
        >
          {t('cta.tagline')}
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <a
            href={BOOK_URL}
            className="inline-flex items-center gap-2 rounded-full px-7 py-4 text-sm font-semibold transition-all hover:opacity-90"
            style={{ background: C.btnText, color: C.btn }}
          >
            <Calendar className="h-4 w-4" strokeWidth={2.4} />
            {t('cta.bookCta')}
            <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
          </a>
          <a
            href="#services"
            className="inline-flex items-center gap-2 rounded-full px-7 py-4 text-sm font-semibold transition-all hover:bg-white/5"
            style={{
              color: C.btnText,
              border: '1px solid rgba(255,255,255,0.18)',
            }}
          >
            {t('cta.seeServices')}
          </a>
        </div>
      </div>
    </section>
  );
}

// ─── FOOTER ───────────────────────────────────────────────────────────────
function Footer({
  t,
  tenantName,
  logoUrl,
  instagram,
  hoursLabel,
}: {
  t: SiteT;
  tenantName: string;
  logoUrl: string;
  instagram: string;
  hoursLabel: string;
}) {
  return (
    <footer className="px-5 pb-10 sm:px-8" style={{ background: C.bg }}>
      <div
        className="mx-auto max-w-6xl rounded-[28px] p-7 sm:p-10"
        style={{
          background: C.bgSoft,
          border: `1px solid ${C.border}`,
        }}
      >
        <div className="flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <Image
              src={logoUrl}
              alt={tenantName}
              width={48}
              height={48}
              className="h-12 w-12 rounded-2xl object-cover"
              unoptimized
            />
            <div>
              <div className="text-base font-semibold tracking-tight" style={{ color: C.text }}>
                {tenantName}
              </div>
              <div className="mt-0.5 text-[12px]" style={{ color: C.textMuted }}>
                {t('footer.subtitle')}
              </div>
            </div>
          </div>
          <div
            className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm"
            style={{ color: C.textMuted }}
          >
            <a
              href={instagram}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 transition-opacity hover:opacity-70"
            >
              <Instagram className="h-4 w-4" strokeWidth={1.6} />
              {t('footer.instagram')}
            </a>
            <span className="inline-flex items-center gap-2">
              <Clock className="h-4 w-4" strokeWidth={1.6} />
              {hoursLabel}
            </span>
          </div>
        </div>
        <div className="mt-8 border-t pt-5 text-center" style={{ borderColor: C.border }}>
          <p className="text-[11px]" style={{ color: C.textSubtle }}>
            © {new Date().getFullYear()} {tenantName}. {t('footer.copyright')}.
          </p>
        </div>
      </div>
    </footer>
  );
}
