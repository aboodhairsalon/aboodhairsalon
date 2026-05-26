'use client';

/**
 * /cashier/login — formulaire de connexion caisse (thème clair).
 *
 * Reçoit la liste du staff pré-chargée côté serveur + le tenantId + slug.
 * Connexion par sélection du nom puis mot de passe (`loginCashierByName`).
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import type { CashierStaffItem, LoginErrorCode } from '../login-actions';
import { loginCashierByName } from '../login-actions';
import { AUTH_C, AuthButton, AuthField, AuthShell } from '../../_components/auth-ui';
import { StaffPhoto } from '../../_components/StaffPhoto';

// ─── StaffAvatar — carte de sélection d'un membre du staff ───────────────────

function StaffAvatar({
  member,
  selected,
  onSelect,
  disabled,
}: {
  member: CashierStaffItem;
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className="btn-press flex flex-col items-center gap-2 rounded-xl border px-2 py-3.5 transition-all disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        background: selected ? '#FFFFFF' : AUTH_C.inputBg,
        borderColor: selected ? AUTH_C.btn : AUTH_C.inputBorder,
        boxShadow: selected ? AUTH_C.cardShadow : undefined,
      }}
    >
      <StaffPhoto
        photoUrl={member.photoUrl}
        initials={member.initials}
        tone={member.tone}
        className="h-11 w-11 text-sm"
      />
      <span
        className="w-full truncate text-center text-xs font-medium leading-tight"
        style={{ color: selected ? AUTH_C.title : AUTH_C.subtitle }}
      >
        {member.name}
      </span>
    </button>
  );
}

// ─── Formulaire principal ────────────────────────────────────────────────────

interface CashierLoginFormProps {
  /** Liste du staff pré-chargée par le Server Component. */
  staffList: CashierStaffItem[];
  /** UUID du tenant résolu par le middleware (x-tenant-id). */
  tenantId: string;
  /** Slug du tenant (ex: "aboodhairsalon"). Vide si accès direct à /cashier/login. */
  slug: string;
  /** Source de la résolution tenant — détermine si on préfixe les URLs.
   *  Sur custom_domain/subdomain le slug est implicite (host) → pas de préfixe. */
  tenantSource?: 'custom_domain' | 'subdomain' | 'path' | null;
  /** Logo du salon (tenant_branding.logo_url) — null si non configuré. */
  logoUrl: string | null;
}

export function CashierLoginForm({
  staffList,
  tenantId,
  slug,
  tenantSource,
  logoUrl,
}: CashierLoginFormProps) {
  const t = useTranslations('auth.cashier');
  const tCommon = useTranslations('auth.common');
  const [selectedId, setSelectedId] = useState('');
  const [password, setPassword] = useState('');
  // Status garde un `errorKey` (LoginErrorCode | 'selectAndEnterPassword')
  // plutôt qu'une chaîne brute — comme ça la traduction reste réactive si
  // l'utilisateur change de langue en cours de saisie (re-render avec t() frais).
  type StatusLocal =
    | { kind: 'idle' }
    | { kind: 'submitting' }
    | { kind: 'error'; errorKey: LoginErrorCode | 'selectAndEnterPassword' };
  const [status, setStatus] = useState<StatusLocal>({ kind: 'idle' });
  const [isPending, startTransition] = useTransition();

  const submitting = status.kind === 'submitting' || isPending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId || !password) {
      setStatus({ kind: 'error', errorKey: 'selectAndEnterPassword' });
      return;
    }
    setStatus({ kind: 'submitting' });

    startTransition(async () => {
      const result = await loginCashierByName(selectedId, password, tenantId);
      if (!result.ok) {
        setStatus({ kind: 'error', errorKey: result.errorKey });
        return;
      }
      // Redirection complète pour hydrater la session depuis les cookies.
      // Skip slug prefix sur custom_domain/subdomain (slug implicite dans le host).
      const useSlugPrefix =
        Boolean(slug) && tenantSource !== 'custom_domain' && tenantSource !== 'subdomain';
      window.location.href = useSlugPrefix ? `/${slug}/cashier` : '/cashier';
    });
  };

  const errorMsg = status.kind === 'error' ? t(`errors.${status.errorKey}`) : undefined;
  const canSubmit = !!selectedId && !!password && !submitting;
  const selectedMember = staffList.find((m) => m.id === selectedId);
  const useSlugPrefix =
    Boolean(slug) && tenantSource !== 'custom_domain' && tenantSource !== 'subdomain';
  const loginHref = useSlugPrefix ? `/${slug}/login` : '/login';

  const gridCols =
    staffList.length <= 2
      ? 'grid-cols-2'
      : staffList.length <= 4
        ? 'grid-cols-2 sm:grid-cols-4'
        : 'grid-cols-3';

  return (
    <AuthShell
      wide
      logoUrl={logoUrl}
      roleLabel={t('roleLabel')}
      title={t('title')}
      subtitle={t('subtitle')}
      footer={
        <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-center text-xs">
          <span style={{ color: AUTH_C.subtitle }}>{t('switchToManagerQuestion')}</span>
          <Link
            href={loginHref}
            className="font-semibold transition-opacity hover:opacity-70"
            style={{ color: AUTH_C.title }}
          >
            {t('switchToManagerCta')}
          </Link>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        {/* Sélection du nom */}
        <div>
          <span
            className="mono mb-2.5 block text-[9px] uppercase tracking-[0.2em]"
            style={{ color: AUTH_C.back }}
          >
            {t('whoAreYou')}
          </span>

          {staffList.length === 0 ? (
            <p
              className="rounded-xl px-4 py-3 text-sm"
              style={{ background: AUTH_C.inputBg, color: AUTH_C.subtitle }}
            >
              {t('noAccessConfigured')}
            </p>
          ) : (
            <div className={`grid gap-2 ${gridCols}`}>
              {staffList.map((member) => (
                <StaffAvatar
                  key={member.id}
                  member={member}
                  selected={selectedId === member.id}
                  onSelect={() => setSelectedId(member.id)}
                  disabled={submitting}
                />
              ))}
            </div>
          )}
        </div>

        {/* Mot de passe */}
        <AuthField
          label={
            selectedMember
              ? t('passwordLabelFor', { name: selectedMember.name })
              : t('passwordLabel')
          }
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('passwordPlaceholder')}
          disabled={submitting || !selectedId}
          error={errorMsg}
        />

        <AuthButton type="submit" disabled={!canSubmit} loading={submitting}>
          {submitting ? tCommon('submitting') : t('submit')}
        </AuthButton>

        <p className="text-center text-xs" style={{ color: AUTH_C.back }}>
          {tCommon('secured')}
        </p>
      </form>
    </AuthShell>
  );
}
