'use client';

/**
 * Onglet Avis — boîte de réception des avis clients (vue Direction).
 *
 * Agrège tous les avis du salon, tous barbiers confondus : note moyenne,
 * répartition par étoile, et le flux chronologique (du plus récent au plus
 * ancien). Le filtrage par barbier se fait côté client — aucun aller-retour
 * réseau au changement de filtre.
 *
 * Chargement lazy au premier rendu de l'onglet. En démo publique (pas de
 * tenant réel) aucun avis n'existe → état vide explicatif, cohérent avec les
 * cartes d'équipe qui affichent « Aucun avis ».
 */
import { MessageSquare, Star } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { Card, Tag } from '@/components';
import { StaffPhoto } from '../_components/StaffPhoto';
import { useTenantOrNull } from '../_components/TenantProvider';
import type { Barber } from '../_data/mock';
import { getTenantReviews, type TenantReview } from './reviews-actions';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Teinte neutre pour un avis dont le barbier n'existe plus dans l'équipe. */
const NEUTRAL_TONE = '#9B8E78';

/** Convertit le code de langue interne en tag BCP47 pour Intl. */
function toBcp47(locale: string): string {
  return locale === 'ar' ? 'ar-EG' : locale === 'en' ? 'en-US' : 'fr-FR';
}

/** Rangée de 5 étoiles, pleines jusqu'à `value`. */
function RatingStars({
  value,
  ariaLabel,
  className = 'h-3.5 w-3.5',
}: {
  value: number;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={ariaLabel}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`${className} ${
            n <= value ? 'fill-brand-primary text-brand-primary' : 'text-ink-soft'
          }`}
          strokeWidth={1.5}
        />
      ))}
    </span>
  );
}

/** 'YYYY-MM-DD' → date longue localisée. */
function fmtReviewDate(iso: string, bcp47: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(bcp47, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// ─── Composant ──────────────────────────────────────────────────────────────

export function ManagerReviews({ barbers }: { barbers: Barber[] }) {
  const t = useTranslations('manager.reviews');
  const tErrors = useTranslations('manager.errors');
  const locale = useLocale();
  const bcp47 = toBcp47(locale);
  const session = useTenantOrNull();
  const tenantId = session?.tenant.id;

  const ratingLabel = (v: number) => t('ariaRating', { value: v });
  const countLabel = (n: number) =>
    n > 1 ? t('countMany', { count: n }) : t('countOne', { count: n });

  const [reviews, setReviews] = useState<TenantReview[]>([]);
  const [avg, setAvg] = useState(0);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [barberFilter, setBarberFilter] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Chargement lazy — au premier rendu de l'onglet, dès que le tenant est connu.
  useEffect(() => {
    if (!tenantId) {
      setLoaded(true); // démo publique — aucune donnée serveur
      return;
    }
    setLoading(true);
    startTransition(async () => {
      const res = await getTenantReviews(tenantId);
      if (res.ok) {
        setReviews(res.reviews);
        setAvg(res.avg);
        setCount(res.count);
      } else {
        setError(tErrors(res.errorKey as 'dbError', res.errorValues));
      }
      setLoading(false);
      setLoaded(true);
    });
  }, [tenantId]);

  const barberById = useMemo(
    () => new Map(barbers.map((b): [string, Barber] => [b.id, b])),
    [barbers],
  );

  // Répartition des notes — index 0 = 1★ … index 4 = 5★.
  const distribution = useMemo(() => {
    const d = [0, 0, 0, 0, 0];
    for (const r of reviews) {
      const idx = r.rating - 1;
      if (idx >= 0 && idx < 5) d[idx] = (d[idx] ?? 0) + 1;
    }
    return d;
  }, [reviews]);

  // Nombre d'avis par barbier — alimente les puces de filtre.
  const countByBarber = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of reviews) m.set(r.barberId, (m.get(r.barberId) ?? 0) + 1);
    return m;
  }, [reviews]);

  // Barbiers ayant au moins un avis, dans l'ordre de l'équipe.
  const barbersWithReviews = useMemo(
    () => barbers.filter((b) => countByBarber.has(b.id)),
    [barbers, countByBarber],
  );

  const filtered = barberFilter ? reviews.filter((r) => r.barberId === barberFilter) : reviews;

  return (
    <div className="mx-auto max-w-7xl px-6 py-10 md:px-10">
      {/* ── En-tête ─────────────────────────────────────────────────────── */}
      <div className="mb-8">
        <Tag tone="copper">{t('eyebrow')}</Tag>
        <h2 className="display mt-3 text-4xl">{t('title')}</h2>
        <p className="text-ink-mute mt-2 max-w-xl text-sm">{t('subtitle')}</p>
      </div>

      {/* ── Chargement ──────────────────────────────────────────────────── */}
      {loading && (
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="border-line bg-surface animate-pulse rounded-sm border"
              style={{ height: 124 }}
            />
          ))}
        </div>
      )}

      {/* ── Erreur ──────────────────────────────────────────────────────── */}
      {error && !loading && (
        <div className="border-red/30 bg-red/10 text-red rounded-sm border px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* ── État vide ───────────────────────────────────────────────────── */}
      {loaded && !loading && !error && count === 0 && (
        <Card className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="bg-surface flex h-14 w-14 items-center justify-center rounded-full">
            <MessageSquare className="text-ink-soft h-6 w-6" strokeWidth={1.5} />
          </div>
          <p className="text-ink-mute text-sm">{t('empty')}</p>
          <p className="text-ink-soft max-w-sm text-xs">{t('emptyHint')}</p>
        </Card>
      )}

      {/* ── Contenu ─────────────────────────────────────────────────────── */}
      {!loading && !error && count > 0 && (
        <>
          {/* Synthèse — note moyenne + répartition par étoile */}
          <Card className="mb-8 p-6">
            <div className="grid gap-8 sm:grid-cols-[auto_1fr] sm:gap-10">
              <div className="border-line flex flex-col items-center justify-center sm:border-e sm:pe-10">
                <div className="display text-6xl leading-none">{avg.toFixed(1)}</div>
                <div className="mt-2">
                  <RatingStars
                    value={Math.round(avg)}
                    ariaLabel={ratingLabel(Math.round(avg))}
                    className="h-4 w-4"
                  />
                </div>
                <div className="mono text-ink-soft mt-2 text-[11px] uppercase tracking-wider">
                  {countLabel(count)}
                </div>
              </div>
              <div className="flex flex-col justify-center gap-2">
                {[5, 4, 3, 2, 1].map((star) => {
                  const n = distribution[star - 1] ?? 0;
                  const pct = count > 0 ? Math.round((n / count) * 100) : 0;
                  return (
                    <div key={star} className="flex items-center gap-3">
                      <span className="mono text-ink-soft flex w-7 items-center justify-end gap-0.5 text-[11px]">
                        {star}
                        <Star className="h-2.5 w-2.5 fill-current" strokeWidth={0} />
                      </span>
                      <div className="bg-surface-elev h-2 flex-1 overflow-hidden rounded-full">
                        <div
                          className="bg-brand-primary h-full rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="mono text-ink-soft w-7 text-end text-[11px]">{n}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>

          {/* Filtre par barbier */}
          {barbersWithReviews.length > 1 && (
            <div className="mb-6 flex flex-wrap gap-2">
              <FilterChip
                active={barberFilter === null}
                onClick={() => setBarberFilter(null)}
                label={t('filterAll')}
                n={count}
              />
              {barbersWithReviews.map((b) => (
                <FilterChip
                  key={b.id}
                  active={barberFilter === b.id}
                  onClick={() => setBarberFilter(b.id)}
                  label={b.name}
                  n={countByBarber.get(b.id) ?? 0}
                  tone={b.tone}
                />
              ))}
            </div>
          )}

          {/* Flux des avis */}
          <div className="grid gap-3">
            {filtered.map((r) => {
              const b = barberById.get(r.barberId);
              const tone = b?.tone ?? NEUTRAL_TONE;
              return (
                <Card key={r.id} className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <StaffPhoto
                        photoUrl={b?.photoUrl}
                        initials={b?.initials ?? '—'}
                        tone={tone}
                        className="h-10 w-10 text-sm"
                      />
                      <div>
                        <div className="text-sm font-semibold" style={{ color: tone }}>
                          {b?.name ?? t('fallbackBarber')}
                        </div>
                        <div className="mt-1">
                          <RatingStars value={r.rating} ariaLabel={ratingLabel(r.rating)} />
                        </div>
                      </div>
                    </div>
                    <span className="mono text-ink-soft shrink-0 text-[11px]">
                      {fmtReviewDate(r.date, bcp47)}
                    </span>
                  </div>
                  {r.comment ? (
                    <p className="text-ink mt-3 text-sm leading-relaxed">
                      {t('quoteOpen')} {r.comment} {t('quoteClose')}
                    </p>
                  ) : (
                    <p className="text-ink-soft mt-3 text-sm italic">{t('noComment')}</p>
                  )}
                  <div className="mono text-ink-soft mt-3 text-[10px] uppercase tracking-[0.15em]">
                    — {r.clientName}
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─── FilterChip — puce de filtre par barbier ─────────────────────────────────

function FilterChip({
  active,
  onClick,
  label,
  n,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  n: number;
  tone?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`btn-press flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-xs transition ${
        active
          ? 'border-brand-primary bg-brand-primary/10 text-ink font-semibold'
          : 'border-line text-ink-mute hover:text-ink'
      }`}
    >
      {tone && <span className="h-2 w-2 rounded-full" style={{ background: tone }} />}
      {label}
      <span className="mono text-ink-soft text-[10px]">{n}</span>
    </button>
  );
}
