'use client';

/**
 * Onglet Clients — vue Direction.
 *
 * Liste tous les profils clients du salon avec leurs métriques (visites, total
 * dépensé, points de fidélité, dernier passage). Chaque fiche est dépliable :
 *  - édition de l'identité (prénom, nom, naissance, e-mail)
 *  - historique complet des rendez-vous (chargé à la demande)
 *
 * Les anniversaires du mois courant sont mis en avant (badge + filtre dédié).
 *
 * Données chargées lazily au premier rendu de l'onglet. Recherche client-side.
 */
import { Cake, Calendar, Mail, Pencil, Phone, Scissors, Search, Star, User } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { Btn, Card, Input, Modal, Tag } from '@/components';
import { useTenantOrNull } from '../_components/TenantProvider';
import { useToast } from '../_components/Toast';
import {
  getClientHistory,
  getManagerClients,
  updateClientProfile,
  type ClientVisit,
  type ManagerClient,
} from './clients-actions';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Convertit le code de langue interne en tag BCP47 pour Intl. */
function toBcp47(locale: string): string {
  return locale === 'ar' ? 'ar-EG' : locale === 'en' ? 'en-US' : 'fr-FR';
}

function initials(c: ManagerClient): string {
  const f = (c.firstName ?? '').charAt(0).toUpperCase();
  const l = (c.lastName ?? '').charAt(0).toUpperCase();
  return f || l ? `${f}${l}` : c.phone.slice(-2);
}

function fullName(c: ManagerClient): string {
  const parts = [c.firstName, c.lastName].filter(Boolean);
  return parts.length ? parts.join(' ') : '—';
}

/** 'YYYY-MM-DD' (ou ISO) → format date localisé selon BCP47. */
function fmtDate(iso: string | null, bcp47: string): string {
  if (!iso) return '—';
  const d = iso.split('T')[0]!;
  const [y, m, day] = d.split('-').map(Number);
  if (!y || !m || !day) return iso;
  return new Intl.DateTimeFormat(bcp47, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.UTC(y, m - 1, day)));
}

/** 'YYYY-MM-DD' → '14 mars' (jour + mois, sans année) selon la locale active. */
function fmtBirthday(iso: string | null, bcp47: string): string {
  if (!iso) return '—';
  const parts = iso.split('T')[0]!.split('-').map(Number);
  const [, m, day] = parts;
  if (!m || !day || m < 1 || m > 12) return fmtDate(iso, bcp47);
  return new Intl.DateTimeFormat(bcp47, { day: 'numeric', month: 'long' }).format(
    new Date(Date.UTC(2000, m - 1, day)),
  );
}

/** L'anniversaire tombe-t-il dans le mois courant, EN TIMEZONE TENANT ?
 *  Cf. BirthdayWidget pour les détails de la dérive UTC vs TZ salon (T5.30). */
function isBirthdayThisMonth(iso: string | null, tz: string): boolean {
  if (!iso) return false;
  const m = Number(iso.split('T')[0]!.split('-')[1]);
  const nowMonth = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      month: '2-digit',
      numberingSystem: 'latn',
    }).format(new Date()),
  );
  return m === nowMonth;
}

function fmtMoney(cents: number, currency: string, bcp47: string): string {
  return new Intl.NumberFormat(bcp47, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

// ─── Composant principal ────────────────────────────────────────────────────

export function ManagerClients() {
  const t = useTranslations('manager.clients');
  const tErrors = useTranslations('manager.errors');
  const locale = useLocale();
  const bcp47 = toBcp47(locale);
  const session = useTenantOrNull();
  const tenantId = session?.tenant.id;
  const currency = session?.tenant.currency ?? 'EUR';
  // TZ du salon pour le filtre « anniversaires du mois » (cf. T5.30).
  const tz = session?.tenant.timezone || 'UTC';
  const toast = useToast();

  const [clients, setClients] = useState<ManagerClient[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [birthdayOnly, setBirthdayOnly] = useState(false);
  const [editing, setEditing] = useState<ManagerClient | null>(null);
  const [, startTransition] = useTransition();

  // Chargement lazy — déclenché quand tenantId est disponible.
  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    startTransition(async () => {
      const result = await getManagerClients(tenantId);
      if (result.ok) setClients(result.clients);
      else setError(tErrors(result.errorKey as 'dbError', result.errorValues));
      setLoading(false);
    });
  }, [tenantId]);

  const birthdayCount = useMemo(
    () => clients.filter((c) => isBirthdayThisMonth(c.dateOfBirth, tz)).length,
    [clients, tz],
  );

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    let list = clients;
    if (birthdayOnly) list = list.filter((c) => isBirthdayThisMonth(c.dateOfBirth, tz));
    if (q) {
      list = list.filter(
        (c) =>
          fullName(c).toLowerCase().includes(q) ||
          c.phone.includes(q) ||
          (c.email ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [clients, birthdayOnly, q]);

  // Applique localement une fiche mise à jour côté serveur.
  const handleSaved = (updated: ManagerClient) => {
    setClients((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setEditing(null);
    toast.success(t('toastSaved'));
  };

  const resultsLabel = (n: number) =>
    n > 1 ? t('resultsMany', { count: n }) : t('resultsOne', { count: n });
  const birthdaysLabel = (n: number) =>
    n > 1 ? t('birthdaysMany', { count: n }) : t('birthdaysOne', { count: n });

  return (
    <div className="mx-auto max-w-7xl px-6 py-10 md:px-10">
      {/* ── En-tête ─────────────────────────────────────────────────────── */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Tag tone="copper">{t('eyebrow')}</Tag>
          <h2 className="display mt-3 text-4xl">{t('title')}</h2>
          <p className="text-ink-mute mt-2 max-w-xl text-sm">{t('subtitle')}</p>
        </div>
        {!loading && clients.length > 0 && (
          <div className="text-end">
            <div className="display text-3xl">{clients.length}</div>
            <div className="text-ink-soft text-xs">
              {clients.length > 1 ? t('nounMany') : t('nounOne')}
            </div>
          </div>
        )}
      </div>

      {/* ── Recherche + filtre anniversaires ─────────────────────────────── */}
      {clients.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="border-line bg-surface flex min-w-[240px] flex-1 items-center gap-3 rounded-sm border px-4 py-2.5">
            <Search className="text-ink-soft h-4 w-4 flex-shrink-0" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="text-ink placeholder:text-ink-soft flex-1 bg-transparent text-sm outline-none"
            />
            {query && (
              <span className="text-ink-soft text-xs">{resultsLabel(filtered.length)}</span>
            )}
          </div>
          {birthdayCount > 0 && (
            <button
              type="button"
              onClick={() => setBirthdayOnly((v) => !v)}
              aria-pressed={birthdayOnly}
              className={`btn-press flex items-center gap-2 rounded-sm border px-3 py-2.5 text-sm transition ${
                birthdayOnly
                  ? 'border-brand-primary bg-brand-primary/10 text-ink font-semibold'
                  : 'border-line text-ink-mute hover:text-ink'
              }`}
            >
              <Cake className="h-4 w-4" strokeWidth={1.5} />
              {birthdaysLabel(birthdayCount)}
            </button>
          )}
        </div>
      )}

      {/* ── États ───────────────────────────────────────────────────────── */}
      {loading && (
        <div className="grid gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="border-line bg-surface animate-pulse rounded-sm border"
              style={{ height: 88 }}
            />
          ))}
        </div>
      )}

      {error && !loading && (
        <div className="border-red/30 bg-red/10 text-red rounded-sm border px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && clients.length === 0 && (
        <Card className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="bg-surface flex h-14 w-14 items-center justify-center rounded-full">
            <User className="text-ink-soft h-6 w-6" />
          </div>
          <p className="text-ink-mute text-sm">{t('empty')}</p>
          <p className="text-ink-soft max-w-xs text-xs">
            {t('emptyHintBefore')}
            <span className="text-brand-primary">/{session?.tenant.slug}/client</span>
            {t('emptyHintAfter')}
          </p>
        </Card>
      )}

      {!loading && !error && filtered.length === 0 && clients.length > 0 && (
        <Card className="py-12 text-center">
          <p className="text-ink-mute text-sm">
            {q ? t('noMatchQuery', { query }) : t('noMatchFilters')}
          </p>
        </Card>
      )}

      {/* ── Liste clients ────────────────────────────────────────────────── */}
      {!loading && !error && filtered.length > 0 && (
        <div className="grid gap-3">
          {filtered.map((c) => (
            <ClientRow
              key={c.id}
              client={c}
              currency={currency}
              tenantId={tenantId}
              bcp47={bcp47}
              tz={tz}
              onEdit={() => setEditing(c)}
            />
          ))}
        </div>
      )}

      {/* ── Modale d'édition ─────────────────────────────────────────────── */}
      {editing && (
        <ClientEditModal client={editing} onClose={() => setEditing(null)} onSaved={handleSaved} />
      )}
    </div>
  );
}

// ─── ClientRow ───────────────────────────────────────────────────────────────

function ClientRow({
  client: c,
  currency,
  tenantId,
  bcp47,
  tz,
  onEdit,
}: {
  client: ManagerClient;
  currency: string;
  tenantId: string | undefined;
  bcp47: string;
  tz: string;
  onEdit: () => void;
}) {
  const t = useTranslations('manager.clients');
  const tDetails = useTranslations('manager.clients.details');
  const tStatus = useTranslations('manager.clients.visitStatus');
  const tHistory = useTranslations('manager.clients.history');

  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<ClientVisit[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const isBday = isBirthdayThisMonth(c.dateOfBirth, tz);

  // Statut d'un RDV → libellé + classe de couleur.
  const visitStatusOf = (status: string): { label: string; cls: string } => {
    switch (status) {
      case 'done':
        return { label: tStatus('done'), cls: 'text-green' };
      case 'in_chair':
      case 'in-chair':
        return { label: tStatus('inChair'), cls: 'text-brand-glow' };
      case 'cancelled':
        return { label: tStatus('cancelled'), cls: 'text-red' };
      default:
        return { label: tStatus('upcoming'), cls: 'text-brand-primary' };
    }
  };

  const pointsLabel = (n: number) =>
    n > 1 ? t('pointMany', { count: n }) : t('pointOne', { count: n });
  const visitsLabel = (n: number) =>
    n > 1 ? t('visitMany', { count: n }) : t('visitOne', { count: n });

  // Historique chargé à la demande, une seule fois, à la première ouverture.
  useEffect(() => {
    if (!expanded || historyLoaded || !tenantId) return;
    setHistoryLoading(true);
    getClientHistory(tenantId, c.phone)
      .then((r) => {
        if (r.ok) setHistory(r.visits);
      })
      .catch(() => {})
      .finally(() => {
        setHistoryLoading(false);
        setHistoryLoaded(true);
      });
  }, [expanded, historyLoaded, tenantId, c.phone]);

  return (
    <Card className="border p-0 transition-all">
      {/* ── Ligne principale (bascule le détail) ─────────────────────────── */}
      <div
        className="flex cursor-pointer items-center gap-4 px-5 py-4"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="bg-brand-primary/15 text-brand-primary flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold">
          {initials(c)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-ink flex items-center gap-2 font-semibold">
            <span className="truncate">{fullName(c)}</span>
            {isBday && (
              <span
                className="text-brand-primary flex flex-shrink-0 items-center"
                title={t('birthdayTitle', { date: fmtBirthday(c.dateOfBirth, bcp47) })}
              >
                <Cake className="h-3.5 w-3.5" strokeWidth={1.5} />
              </span>
            )}
            {c.points > 0 && (
              <span className="text-brand-primary mono flex flex-shrink-0 items-center gap-0.5 text-[10px]">
                <Star className="h-3 w-3 fill-current" />
                {pointsLabel(c.points)}
              </span>
            )}
          </div>
          <div className="text-ink-mute mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
            <span className="flex items-center gap-1">
              <Phone className="h-3 w-3" />
              {c.phone}
            </span>
            {c.email && (
              <span className="flex items-center gap-1 truncate">
                <Mail className="h-3 w-3" />
                {c.email}
              </span>
            )}
          </div>
        </div>
        <div className="hidden flex-shrink-0 text-end sm:block">
          <div className="text-ink text-sm font-semibold">{visitsLabel(c.visitCount)}</div>
          <div className="text-ink-soft text-xs">
            {c.totalSpentCents > 0 ? fmtMoney(c.totalSpentCents, currency, bcp47) : '—'}
          </div>
        </div>
      </div>

      {/* ── Détails dépliables ───────────────────────────────────────────── */}
      {expanded && (
        <div className="border-line border-t px-5 py-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs sm:grid-cols-3 lg:grid-cols-4">
            <DetailField label={tDetails('firstName')} value={c.firstName ?? '—'} />
            <DetailField label={tDetails('lastName')} value={c.lastName ?? '—'} />
            <DetailField
              label={tDetails('dateOfBirth')}
              icon={<Calendar className="h-3 w-3" />}
              value={fmtDate(c.dateOfBirth, bcp47)}
            />
            <DetailField
              label={tDetails('phone')}
              icon={<Phone className="h-3 w-3" />}
              value={c.phone}
            />
            <DetailField
              label={tDetails('email')}
              icon={<Mail className="h-3 w-3" />}
              value={c.email ?? '—'}
            />
            <DetailField
              label={tDetails('points')}
              icon={<Star className="h-3 w-3" />}
              value={pointsLabel(c.points)}
            />
            <DetailField label={tDetails('visits')} value={`${c.visitCount}`} />
            <DetailField
              label={tDetails('totalSpent')}
              value={c.totalSpentCents > 0 ? fmtMoney(c.totalSpentCents, currency, bcp47) : '—'}
            />
            <DetailField label={tDetails('lastVisit')} value={fmtDate(c.lastVisitDate, bcp47)} />
            <DetailField label={tDetails('clientSince')} value={fmtDate(c.createdAt, bcp47)} />
          </div>

          {/* Action — édition de la fiche */}
          <div className="mt-4">
            <button
              type="button"
              onClick={onEdit}
              className="btn-press mono border-line-hi hover:border-brand-primary text-ink-mute hover:text-ink flex items-center gap-1.5 rounded-sm border px-3 py-2 text-[10px] uppercase tracking-wider"
            >
              <Pencil className="h-3 w-3" strokeWidth={1.5} />
              {t('edit')}
            </button>
          </div>

          {/* Historique des rendez-vous */}
          <div className="border-line mt-5 border-t pt-4">
            <div className="mono text-ink-soft mb-3 text-[10px] uppercase tracking-[0.2em]">
              {tHistory('header')}
            </div>
            {historyLoading && (
              <div className="grid gap-2">
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    className="bg-surface animate-pulse rounded-sm"
                    style={{ height: 38 }}
                  />
                ))}
              </div>
            )}
            {!historyLoading && historyLoaded && history.length === 0 && (
              <p className="text-ink-soft text-xs">{tHistory('empty')}</p>
            )}
            {!historyLoading && history.length > 0 && (
              <div className="grid gap-1.5">
                {history.map((v) => {
                  const st = visitStatusOf(v.status);
                  return (
                    <div
                      key={v.id}
                      className="border-line flex items-center gap-3 border-b py-2 text-xs last:border-0"
                    >
                      <span className="mono text-ink-soft w-20 flex-shrink-0">
                        {fmtDate(v.date, bcp47)}
                      </span>
                      <span className="mono text-ink-soft hidden w-11 flex-shrink-0 sm:block">
                        {v.time}
                      </span>
                      <span className="text-ink flex min-w-0 flex-1 items-center gap-1.5">
                        <Scissors className="text-ink-soft h-3 w-3 flex-shrink-0" />
                        <span className="truncate">{v.serviceName}</span>
                      </span>
                      <span className="text-ink-mute hidden w-28 flex-shrink-0 truncate sm:block">
                        {v.barberName}
                      </span>
                      <span className={`mono flex-shrink-0 text-[10px] uppercase ${st.cls}`}>
                        {st.label}
                      </span>
                      <span className="mono text-ink w-16 flex-shrink-0 text-end">
                        {v.amountCents > 0 ? fmtMoney(v.amountCents, currency, bcp47) : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── DetailField ─────────────────────────────────────────────────────────────

function DetailField({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div>
      <div className="text-ink-soft mb-0.5 flex items-center gap-1 text-[9px] font-medium uppercase tracking-[0.15em]">
        {icon}
        {label}
      </div>
      <div className="text-ink text-sm">{value}</div>
    </div>
  );
}

// ─── ClientEditModal ─────────────────────────────────────────────────────────

function ClientEditModal({
  client,
  onClose,
  onSaved,
}: {
  client: ManagerClient;
  onClose: () => void;
  onSaved: (updated: ManagerClient) => void;
}) {
  const tEditModal = useTranslations('manager.clients.editModal');
  const tErrors = useTranslations('manager.errors');
  const [firstName, setFirstName] = useState(client.firstName ?? '');
  const [lastName, setLastName] = useState(client.lastName ?? '');
  const [dateOfBirth, setDateOfBirth] = useState(client.dateOfBirth ?? '');
  const [email, setEmail] = useState(client.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const save = () => {
    setError(null);
    startSave(async () => {
      const res = await updateClientProfile({
        id: client.id,
        firstName,
        lastName,
        email,
        dateOfBirth,
      });
      if (res.ok) {
        onSaved({
          ...client,
          firstName: firstName.trim() || null,
          lastName: lastName.trim() || null,
          email: email.trim() || null,
          dateOfBirth: dateOfBirth.trim() || null,
        });
      } else {
        setError(tErrors(res.errorKey as 'dbError', res.errorValues));
      }
    });
  };

  return (
    <Modal open onClose={onClose} title={tEditModal('title')}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={tEditModal('firstNameLabel')}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder={tEditModal('firstNamePlaceholder')}
          />
          <Input
            label={tEditModal('lastNameLabel')}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder={tEditModal('lastNamePlaceholder')}
          />
        </div>
        <Input
          label={tEditModal('dobLabel')}
          type="date"
          value={dateOfBirth}
          onChange={(e) => setDateOfBirth(e.target.value)}
        />
        <Input
          label={tEditModal('emailLabel')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={tEditModal('emailPlaceholder')}
        />

        {/* Téléphone — lecture seule (clé d'identité du client) */}
        <div>
          <span className="mono text-ink-soft mb-2 block text-[10px] uppercase tracking-[0.2em]">
            {tEditModal('phoneLabel')}
          </span>
          <div className="border-line bg-surface text-ink-mute flex items-center gap-2 rounded-sm border px-3 py-2.5 text-sm">
            <Phone className="h-3.5 w-3.5 flex-shrink-0" />
            {client.phone}
            <span className="text-ink-soft ms-auto text-[10px]">{tEditModal('phoneReadonly')}</span>
          </div>
        </div>

        {error && (
          <div className="border-red/30 bg-red/10 text-red rounded-sm border px-3 py-2 text-xs">
            {error}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Btn variant="secondary" full onClick={onClose}>
            {tEditModal('cancelBtn')}
          </Btn>
          <Btn full onClick={save} disabled={saving}>
            {saving ? tEditModal('savingBtn') : tEditModal('saveBtn')}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
