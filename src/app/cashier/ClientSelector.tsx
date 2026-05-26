'use client';

/**
 * ClientSelector — composant Caisse pour rattacher un client à une vente.
 *
 * États visuels :
 *   1. Aucun client sélectionné → input de recherche + bouton « Nouveau client »
 *   2. Recherche en cours → dropdown de résultats (debouncing 250 ms)
 *   3. Client sélectionné → chip avec nom + téléphone + email + bouton retirer
 *
 * Pourquoi cette UX :
 *   - Évite de créer un doublon quand le client existe déjà (problème courant
 *     quand chaque caissier tape le nom différemment).
 *   - Garantit que les points de fidélité s'accumulent sur le bon profil.
 *   - L'email saisi à la création est nécessaire pour le QR/reçu et les
 *     futures communications.
 *
 * Server actions utilisées :
 *   - searchClients(tenantId, query) — recherche live
 *   - createClientFromCashier(...) — création / récupération idempotente
 */
import { Check, Mail, Phone, Search, UserPlus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Btn, Modal } from '@/components';
import {
  createClientFromCashier,
  searchClients,
  type ClientSearchHit,
} from '../client/profile-actions';

export type SelectedClient = {
  phone: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
};

export function ClientSelector({
  tenantId,
  value,
  onChange,
}: {
  tenantId: string | null;
  value: SelectedClient | null;
  onChange: (next: SelectedClient | null) => void;
}) {
  const t = useTranslations('cashier.clientSelector');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ClientSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Recherche debouncée — 250 ms après la dernière frappe pour éviter de
  // marteler Supabase à chaque caractère.
  useEffect(() => {
    if (!tenantId) return;
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    const handle = setTimeout(() => {
      setSearching(true);
      void searchClients(tenantId, query).then((r) => {
        if (!alive) return;
        setResults(r.ok ? r.results : []);
        setSearching(false);
      });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [query, tenantId]);

  const labelOf = (c: ClientSearchHit | SelectedClient) =>
    [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.phone;

  const handleSelect = (hit: ClientSearchHit) => {
    onChange({
      phone: hit.phone,
      firstName: hit.firstName,
      lastName: hit.lastName,
      email: hit.email,
    });
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  // ── Cas client déjà sélectionné — chip compact ─────────────────────────
  if (value) {
    return (
      <div className="border-line bg-bg-soft flex items-center justify-between gap-3 rounded-sm border px-3 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="bg-brand-primary/15 text-brand-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
            <Check className="h-4 w-4" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-ink truncate text-sm font-semibold">{labelOf(value)}</div>
            <div className="text-ink-mute mt-0.5 flex items-center gap-3 truncate text-[11px]">
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3 w-3" strokeWidth={1.5} />
                {value.phone}
              </span>
              {value.email && (
                <span className="inline-flex items-center gap-1 truncate">
                  <Mail className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                  <span className="truncate">{value.email}</span>
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={t('removeAria')}
          className="btn-press text-ink-soft hover:text-red flex h-7 w-7 shrink-0 items-center justify-center rounded-sm"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // ── Cas recherche / création ───────────────────────────────────────────
  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search
            className="text-ink-soft absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2"
            strokeWidth={1.5}
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              // Délai pour laisser le click sur un résultat se propager.
              setTimeout(() => setOpen(false), 150);
            }}
            placeholder={t('searchPlaceholder')}
            className="border-line bg-bg-soft text-ink placeholder:text-ink-soft focus:border-brand-primary w-full rounded-sm border py-2.5 pe-3 ps-9 text-sm outline-none transition-colors"
          />
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="btn-press border-line hover:border-brand-primary text-ink-mute hover:text-ink mono inline-flex shrink-0 items-center gap-1.5 rounded-sm border px-3 text-[10px] uppercase tracking-wider"
        >
          <UserPlus className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t('newBtn')}
        </button>
      </div>

      {/* Dropdown résultats */}
      {open && query.trim().length >= 2 && (
        <div
          className="border-line bg-surface absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-sm border shadow-lg"
          role="listbox"
        >
          {searching && (
            <div className="text-ink-soft px-3 py-3 text-center text-xs">{t('searching')}</div>
          )}
          {!searching && results.length === 0 && (
            <div className="text-ink-soft space-y-2 px-3 py-4 text-center text-xs">
              <div>{t('noMatch', { query })}</div>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  setModalOpen(true);
                }}
                className="btn-press mono text-brand-primary inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider hover:underline"
              >
                <UserPlus className="h-3 w-3" strokeWidth={1.5} />
                {t('createThis')}
              </button>
            </div>
          )}
          {!searching &&
            results.map((hit) => (
              <button
                key={hit.phone}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(hit)}
                className="border-line hover:bg-bg-soft btn-press flex w-full items-center justify-between gap-3 border-b px-3 py-2.5 text-start last:border-0"
                role="option"
                aria-selected="false"
              >
                <div className="min-w-0">
                  <div className="text-ink truncate text-sm font-semibold">{labelOf(hit)}</div>
                  <div className="text-ink-soft mt-0.5 flex items-center gap-2 truncate text-[11px]">
                    <span>{hit.phone}</span>
                    {hit.email && <span className="truncate">· {hit.email}</span>}
                  </div>
                </div>
              </button>
            ))}
        </div>
      )}

      <NewClientModal
        open={modalOpen}
        prefillQuery={query}
        onClose={() => setModalOpen(false)}
        onCreated={(client) => {
          onChange(client);
          setModalOpen(false);
          setQuery('');
          setResults([]);
        }}
        tenantId={tenantId}
      />
    </div>
  );
}

// =============================================================================
// NewClientModal — création rapide depuis la caisse
// =============================================================================

function NewClientModal({
  open,
  onClose,
  onCreated,
  tenantId,
  prefillQuery,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (client: SelectedClient) => void;
  tenantId: string | null;
  /** Si la recherche en cours ressemble à un téléphone ou un nom, on le
   *  pré-remplit dans le champ approprié — gain de temps à la caisse. */
  prefillQuery: string;
}) {
  const t = useTranslations('cashier.clientSelector.modal');
  const tErrors = useTranslations('client.errors');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Pré-remplissage à l'ouverture — basé sur ce que la caissière tapait.
  useEffect(() => {
    if (!open) return;
    setError(null);
    const q = prefillQuery.trim();
    const isPhone = /^[+\d\s().-]+$/.test(q) && q.replace(/\D/g, '').length >= 4;
    if (isPhone) {
      setPhone(q);
      setFirstName('');
    } else {
      setPhone('');
      setFirstName(q);
    }
    setEmail('');
    setLastName('');
  }, [open, prefillQuery]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;
    if (!phone.trim()) {
      setError(t('errorPhoneRequired'));
      return;
    }
    if (!email.trim()) {
      setError(t('errorEmailRequired'));
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createClientFromCashier({
        tenantId,
        phone: phone.trim(),
        email: email.trim(),
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
      });
      if (!result.ok) {
        setError(tErrors(result.errorKey as 'dbError', result.errorValues));
        return;
      }
      onCreated({
        phone: result.profile.phone,
        firstName: result.profile.firstName,
        lastName: result.profile.lastName,
        email: result.profile.email,
      });
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={t('title')}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-ink-mute text-xs">{t('description')}</p>

        <FieldRow
          label={t('phoneLabel')}
          value={phone}
          setValue={setPhone}
          placeholder={t('phonePlaceholder')}
          type="tel"
          autoFocus
        />
        <FieldRow
          label={t('emailLabel')}
          value={email}
          setValue={setEmail}
          placeholder={t('emailPlaceholder')}
          type="email"
        />
        <div className="grid grid-cols-2 gap-3">
          <FieldRow
            label={t('firstNameLabel')}
            value={firstName}
            setValue={setFirstName}
            placeholder={t('firstNamePlaceholder')}
            type="text"
          />
          <FieldRow
            label={t('lastNameLabel')}
            value={lastName}
            setValue={setLastName}
            placeholder={t('lastNamePlaceholder')}
            type="text"
          />
        </div>

        {error && (
          <p className="border-red/30 bg-red/10 text-red rounded-sm border px-3 py-2 text-xs">
            {error}
          </p>
        )}

        <div className="flex gap-2 pt-2">
          <Btn variant="secondary" onClick={onClose} disabled={pending}>
            {t('cancelBtn')}
          </Btn>
          <Btn type="submit" full disabled={pending || !tenantId}>
            {pending ? t('creatingBtn') : t('submitBtn')}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

function FieldRow({
  label,
  value,
  setValue,
  placeholder,
  type,
  autoFocus,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  placeholder: string;
  type: 'text' | 'tel' | 'email';
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="mono text-ink-soft mb-1.5 block text-[9px] uppercase tracking-[0.2em]">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="border-line bg-bg-soft text-ink placeholder:text-ink-soft focus:border-brand-primary w-full rounded-sm border px-3 py-2.5 text-sm outline-none transition-colors"
      />
    </label>
  );
}
