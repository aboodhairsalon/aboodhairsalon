'use client';

/**
 * BirthdayWidget — encart Tableau de bord listant les anniversaires du mois.
 *
 * Conçu pour pousser une action commerciale : compteur visible, top 3 clients
 * concernés, un clic = ouverture d'un mail / WhatsApp pré-rempli avec un
 * petit mot de félicitation. Le bouton "Voir tous" bascule sur l'onglet
 * Clients filtré birthdayOnly.
 *
 * Chargement lazy au montage (réutilise getManagerClients) — pas de coût
 * tant que l'onglet Dashboard n'est pas affiché.
 */
import { Cake, Mail, MessageCircle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Card, Tag } from '@/components';
import { useTenantOrNull } from '../_components/TenantProvider';
import { getManagerClients, type ManagerClient } from './clients-actions';

function toBcp47(locale: string): string {
  return locale === 'ar' ? 'ar-EG' : locale === 'en' ? 'en-US' : 'fr-FR';
}

/**
 * Vrai si l'anniversaire (mois sur YYYY-MM-DD) tombe sur le mois courant
 * VU DANS LA TIMEZONE du salon. Avant l'audit T5.30, on utilisait
 * `new Date().getMonth()` qui dépend de la TZ du runtime (Vercel = UTC).
 * Aux extrêmes du mois — ex. 31 mai 23 h Cairo = 31 mai 21 h UTC OK,
 * mais 31 mai 23 h Pacific = 1 juin 06 h UTC → on filtrait les
 * anniversaires de juin alors qu'on est encore en mai pour le salon —
 * la liste affichée n'était pas alignée sur l'actualité du salon.
 *
 * Implémentation : on formate "now" au format YYYY-MM via Intl.DateTimeFormat
 * avec la TZ du salon, puis on compare le mois.
 */
function isBirthdayThisMonth(iso: string | null, tz: string): boolean {
  if (!iso) return false;
  const m = Number(iso.split('T')[0]!.split('-')[1]);
  // `numberingSystem: 'latn'` force chiffres latins (sinon ar-EG sort
  // « ٠٥ » qu'on ne sait pas parser via Number()).
  const nowMonth = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      month: '2-digit',
      numberingSystem: 'latn',
    }).format(new Date()),
  );
  return m === nowMonth;
}

/** 'YYYY-MM-DD' → jour + mois localisé (sans année). */
function fmtBirthday(iso: string | null, bcp47: string): string {
  if (!iso) return '—';
  const parts = iso.split('T')[0]!.split('-').map(Number);
  const [, m, day] = parts;
  if (!m || !day) return iso;
  return new Intl.DateTimeFormat(bcp47, { day: 'numeric', month: 'long' }).format(
    new Date(Date.UTC(2000, m - 1, day)),
  );
}

function fullName(c: ManagerClient): string {
  const parts = [c.firstName, c.lastName].filter(Boolean);
  return parts.length ? parts.join(' ') : c.phone;
}

export function BirthdayWidget({ onViewAll }: { onViewAll: () => void }) {
  const t = useTranslations('manager.birthdays');
  const locale = useLocale();
  const bcp47 = toBcp47(locale);
  const session = useTenantOrNull();
  const tenantId = session?.tenant.id;
  const salonName = session?.tenant.name ?? '';
  // TZ du salon — fallback UTC si TenantProvider absent (cas démo).
  // Sert au calcul du mois courant pour le filtre anniversaires (T5.30).
  const tz = session?.tenant.timezone || 'UTC';

  const [clients, setClients] = useState<ManagerClient[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!tenantId) {
      setLoaded(true);
      return;
    }
    let alive = true;
    void getManagerClients(tenantId).then((res) => {
      if (!alive) return;
      if (res.ok) setClients(res.clients);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [tenantId]);

  const birthdays = useMemo(
    () => clients.filter((c) => isBirthdayThisMonth(c.dateOfBirth, tz)),
    [clients, tz],
  );
  const totalCount = birthdays.length;

  // Tri : par jour du mois croissant, pour suivre l'ordre dans le calendrier.
  const sorted = useMemo(
    () =>
      [...birthdays].sort((a, b) => {
        const da = Number(a.dateOfBirth?.split('T')[0]?.split('-')[2] ?? 99);
        const db = Number(b.dateOfBirth?.split('T')[0]?.split('-')[2] ?? 99);
        return da - db;
      }),
    [birthdays],
  );
  const preview = sorted.slice(0, 3);

  // Pas encore chargé → rien (évite un état vide qui clignote).
  if (!loaded) return null;
  // Aucun anniversaire ce mois → on n'affiche pas le widget (vide = bruit).
  if (totalCount === 0) return null;

  // Normalise un téléphone en format wa.me — la doc WhatsApp exige des
  // chiffres uniquement, sans + ni 00 initial. On gère les deux préfixes
  // internationaux courants : `+201234...` → `201234...`, `00201234...` →
  // `201234...`. Si pas de préfixe (numéro local genre `01234...`), on le
  // laisse tel quel — wa.me détectera le pays via le compte WhatsApp client.
  const normalizePhoneForWa = (phone: string): string => {
    const digits = phone.replace(/[^\d+]/g, '');
    if (digits.startsWith('+')) return digits.slice(1);
    if (digits.startsWith('00')) return digits.slice(2);
    return digits;
  };

  // Sélectionne le template adapté : si pas de prénom, on bascule sur la
  // variante sans nom (« Bonjour, … » au lieu de « Bonjour {nom}, … »)
  // pour éviter « Bonjour , » avec la virgule orpheline.
  const buildMessage = (c: ManagerClient): string => {
    const firstName = (c.firstName ?? '').trim();
    return firstName
      ? t('messageTemplate', { firstName, salonName })
      : t('messageTemplateNoName', { salonName });
  };

  // Construit un lien WhatsApp pré-rempli (E.164 du téléphone client + message)
  // et un lien mailto (si email connu). On laisse le device choisir l'app.
  const buildWhatsAppLink = (c: ManagerClient) => {
    const msg = encodeURIComponent(buildMessage(c));
    return `https://wa.me/${normalizePhoneForWa(c.phone)}?text=${msg}`;
  };
  const buildMailLink = (c: ManagerClient) => {
    if (!c.email) return null;
    const subject = encodeURIComponent(t('mailSubject', { salonName }));
    const body = encodeURIComponent(buildMessage(c));
    return `mailto:${c.email}?subject=${subject}&body=${body}`;
  };

  return (
    <Card className="p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-brand-primary/12 text-brand-primary flex h-10 w-10 items-center justify-center rounded-full">
            <Cake className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <div>
            <h3 className="display text-xl">{t('title')}</h3>
            <p className="text-ink-mute mt-0.5 text-xs">
              {totalCount > 1
                ? t('subtitleMany', { count: totalCount })
                : t('subtitleOne', { count: totalCount })}
            </p>
          </div>
        </div>
        <Tag tone="copper">
          <span className="mono text-[10px] uppercase tracking-wider">{t('thisMonth')}</span>
        </Tag>
      </div>

      <div className="space-y-2">
        {preview.map((c) => {
          const wa = buildWhatsAppLink(c);
          const mail = buildMailLink(c);
          return (
            <div
              key={c.id}
              className="border-line/60 flex flex-wrap items-center justify-between gap-3 border-b py-2 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <div className="text-ink truncate text-sm font-semibold">{fullName(c)}</div>
                <div className="text-ink-soft mt-0.5 text-[11px]">
                  {fmtBirthday(c.dateOfBirth, bcp47)}
                  {c.points > 0 && (
                    <span className="text-brand-primary mono ms-2 text-[10px]">
                      · {t('points', { count: c.points })}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <a
                  href={wa}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={t('sendWhatsApp')}
                  className="btn-press text-ink-soft hover:text-green flex h-8 w-8 items-center justify-center rounded-sm transition-colors"
                >
                  <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
                </a>
                {mail && (
                  <a
                    href={mail}
                    title={t('sendEmail')}
                    className="btn-press text-ink-soft hover:text-brand-primary flex h-8 w-8 items-center justify-center rounded-sm transition-colors"
                  >
                    <Mail className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {totalCount > preview.length && (
        <button
          type="button"
          onClick={onViewAll}
          className="btn-press mono text-brand-primary hover:text-brand-glow mt-4 text-[10px] uppercase tracking-wider transition-colors"
        >
          {t('viewAll', { count: totalCount })}
        </button>
      )}
    </Card>
  );
}
