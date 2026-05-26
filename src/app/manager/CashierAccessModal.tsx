'use client';

/**
 * CashierAccessModal — la Direction gère le compte de connexion /cashier d'un
 * membre du staff (cf. Server Actions `createCashierAccess`,
 * `resetCashierPassword`, `revokeCashierAccess`).
 *
 * Cinq vues, pilotées par `staff.cashierUserId` à l'ouverture :
 *  - create        : aucun accès → formulaire email + mot de passe.
 *  - reveal        : identifiants à transmettre (après création / réinit.).
 *  - manage        : accès existant → réinitialiser ou révoquer.
 *  - reset         : nouveau mot de passe.
 *  - confirmRevoke : confirmation de suppression du compte.
 */
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Btn, Input, Modal } from '@/components';
import { useTenantOrNull } from '../_components/TenantProvider';
import type { Staff } from '../_data/mock';
import { createCashierAccess, resetCashierPassword, revokeCashierAccess } from './actions';

type View = 'create' | 'reveal' | 'manage' | 'reset' | 'confirmRevoke';

/** Mot de passe lisible : alphabet sans caractères ambigus, dictable à voix haute. */
function generatePassword(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'; // sans i, l, o, 0, 1
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => alphabet.charAt(b % alphabet.length));
  // 3 groupes de 4 : « abcd-efgh-jkmn » (14 caractères).
  return [0, 4, 8].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

interface CashierAccessModalProps {
  /** Caissier dont on gère l'accès — `null` ferme le modal. */
  staff: Staff | null;
  onClose: () => void;
}

export function CashierAccessModal({ staff, onClose }: CashierAccessModalProps) {
  const router = useRouter();
  const session = useTenantOrNull();
  const t = useTranslations('manager.cashierAccess');
  const tErrors = useTranslations('manager.errors');
  const salonName = session?.tenant.name ?? t('fallbackSalonName');

  // État initialisé au montage depuis `staff`. Le parent passe `key={staffId}`
  // → ouvrir une autre fiche remonte le composant (état frais) ; après un
  // router.refresh() la clé est inchangée, donc la vue courante est conservée
  // (ex. l'écran « identifiants » affiché juste après la création).
  const [view, setView] = useState<View>(staff?.cashierUserId ? 'manage' : 'create');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Mot de passe suggéré — généré côté client (crypto non garanti au SSR).
  useEffect(() => {
    setPassword(generatePassword());
  }, []);

  const slug = session?.tenant.slug;
  const loginUrl =
    typeof window === 'undefined'
      ? `${slug ? `/${slug}` : ''}/cashier/login`
      : `${window.location.origin}${slug ? `/${slug}` : ''}/cashier/login`;

  const passwordValid = password.length >= 8;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!staff) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createCashierAccess({ staffId: staff.id, password });
      if (!res.ok) {
        setError(tErrors(res.errorKey, res.errorValues));
        return;
      }
      router.refresh();
      setView('reveal');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('unexpectedError'));
    } finally {
      setBusy(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (!staff) return;
    setBusy(true);
    setError(null);
    try {
      const res = await resetCashierPassword({ staffId: staff.id, password });
      if (!res.ok) {
        setError(tErrors(res.errorKey, res.errorValues));
        return;
      }
      setView('reveal');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('unexpectedShort'));
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke() {
    if (!staff) return;
    setBusy(true);
    setError(null);
    try {
      const res = await revokeCashierAccess(staff.id);
      if (!res.ok) {
        setError(tErrors(res.errorKey, res.errorValues));
        return;
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('unexpectedShort'));
    } finally {
      setBusy(false);
    }
  }

  async function copyCredentials() {
    // L'email n'est pas transmis au caissier — il se connecte par son nom.
    const text = [
      t('reveal.clipboardHeader', { salonName }),
      t('reveal.clipboardLoginUrlLine', { url: loginUrl }),
      t('reveal.clipboardInstructionLine'),
      password,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers indisponible (permissions) — ignoré silencieusement.
    }
  }

  return (
    <Modal open={!!staff} onClose={onClose} title={staff ? t(`titles.${view}`) : ''}>
      {staff && (
        <div className="space-y-4">
          {/* ─── Création ─────────────────────────────────────────────── */}
          {view === 'create' && (
            <form onSubmit={handleCreate} className="space-y-4">
              <p className="text-ink-mute text-sm">
                {t('create.introBefore')}
                <span className="text-ink font-semibold">{staff.name}</span>
                {t('create.introAfter')}
                <code className="mono text-brand-glow">/cashier/login</code>
                {t('create.introCodeSuffix')}
              </p>
              <PasswordField
                value={password}
                show={showPassword}
                disabled={busy}
                onChange={(e) => setPassword(e.target.value)}
                onToggleShow={() => setShowPassword((v) => !v)}
                onGenerate={() => setPassword(generatePassword())}
              />
              {error && <ErrorBox message={error} />}
              <div className="flex gap-2 pt-1">
                <Btn type="button" variant="secondary" full onClick={onClose}>
                  {t('create.cancelBtn')}
                </Btn>
                <Btn type="submit" full disabled={busy || !passwordValid}>
                  {busy ? t('create.creatingBtn') : t('create.submitBtn')}
                </Btn>
              </div>
            </form>
          )}

          {/* ─── Identifiants à transmettre ───────────────────────────── */}
          {view === 'reveal' && (
            <div className="space-y-4">
              <div className="text-green flex items-center gap-2">
                <Check className="h-5 w-5" strokeWidth={2} />
                <span className="display text-lg">{t('reveal.title')}</span>
              </div>
              <p className="text-ink-mute text-sm">
                {t('reveal.introBefore')}
                <span className="text-ink font-semibold">{t('reveal.introStrong')}</span>
                {t('reveal.introMiddle')}
                <span className="text-ink font-semibold">{staff.name}</span>
                {t('reveal.introAfter')}
              </p>
              <div className="border-line bg-bg-soft space-y-3 rounded-sm border p-4">
                <CredRow label={t('reveal.connectionLabel')} value={loginUrl} />
                <CredRow label={t('reveal.passwordLabel')} value={password} mono />
              </div>
              <Btn
                type="button"
                variant="secondary"
                full
                icon={(copied ? Check : Copy) as LucideIcon}
                onClick={copyCredentials}
              >
                {copied ? t('reveal.copiedBtn') : t('reveal.copyBtn')}
              </Btn>
              <Btn type="button" full onClick={onClose}>
                {t('reveal.doneBtn')}
              </Btn>
            </div>
          )}

          {/* ─── Accès existant ───────────────────────────────────────── */}
          {view === 'manage' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="bg-green/15 text-green flex h-10 w-10 shrink-0 items-center justify-center rounded-sm">
                  <KeyRound className="h-5 w-5" strokeWidth={1.5} />
                </div>
                <div>
                  <div className="display text-lg leading-tight">{t('manage.title')}</div>
                  <div className="text-ink-mute text-sm">
                    {staff.name}
                    {t('manage.subtitleAfter')}
                    <code className="mono text-brand-glow text-xs">/cashier/login</code>
                    {t('manage.subtitleSuffix')}
                  </div>
                </div>
              </div>
              <div className="border-line bg-bg-soft space-y-3 rounded-sm border p-4">
                <CredRow label={t('manage.connectionLabel')} value={loginUrl} />
              </div>
              <p className="text-ink-soft text-xs">{t('manage.noPasswordHint')}</p>
              {error && <ErrorBox message={error} />}
              <div className="grid grid-cols-2 gap-2">
                <Btn
                  type="button"
                  variant="secondary"
                  icon={RefreshCw as LucideIcon}
                  onClick={() => {
                    setError(null);
                    setPassword(generatePassword());
                    setShowPassword(true);
                    setView('reset');
                  }}
                >
                  {t('manage.resetBtn')}
                </Btn>
                <Btn
                  type="button"
                  variant="danger"
                  onClick={() => {
                    setError(null);
                    setView('confirmRevoke');
                  }}
                >
                  {t('manage.revokeBtn')}
                </Btn>
              </div>
            </div>
          )}

          {/* ─── Réinitialisation du mot de passe ─────────────────────── */}
          {view === 'reset' && (
            <form onSubmit={handleReset} className="space-y-4">
              <p className="text-ink-mute text-sm">
                {t('reset.introBefore')}
                <span className="text-ink font-semibold">{staff.name}</span>
                {t('reset.introAfter')}
              </p>
              <PasswordField
                value={password}
                show={showPassword}
                disabled={busy}
                onChange={(e) => setPassword(e.target.value)}
                onToggleShow={() => setShowPassword((v) => !v)}
                onGenerate={() => setPassword(generatePassword())}
              />
              {error && <ErrorBox message={error} />}
              <div className="flex gap-2 pt-1">
                <Btn type="button" variant="secondary" full onClick={() => setView('manage')}>
                  {t('reset.backBtn')}
                </Btn>
                <Btn type="submit" full disabled={busy || !passwordValid}>
                  {busy ? t('reset.resettingBtn') : t('reset.submitBtn')}
                </Btn>
              </div>
            </form>
          )}

          {/* ─── Confirmation de révocation ───────────────────────────── */}
          {view === 'confirmRevoke' && (
            <div className="space-y-4">
              <p className="text-ink-mute">
                {t('revoke.questionBefore')}
                <span className="text-ink font-semibold">{staff.name}</span>
                {t('revoke.questionAfter')}
              </p>
              <p className="text-ink-soft text-xs leading-relaxed">{t('revoke.explanation')}</p>
              {error && <ErrorBox message={error} />}
              <div className="flex gap-2">
                <Btn type="button" variant="secondary" full onClick={() => setView('manage')}>
                  {t('revoke.cancelBtn')}
                </Btn>
                <Btn type="button" variant="danger" full disabled={busy} onClick={handleRevoke}>
                  {busy ? t('revoke.revokingBtn') : t('revoke.submitBtn')}
                </Btn>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// -----------------------------------------------------------------------------

interface PasswordFieldProps {
  value: string;
  show: boolean;
  disabled?: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onToggleShow: () => void;
  onGenerate: () => void;
}

function PasswordField({
  value,
  show,
  disabled,
  onChange,
  onToggleShow,
  onGenerate,
}: PasswordFieldProps) {
  const t = useTranslations('manager.cashierAccess.password');
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="mono text-ink-soft text-[10px] uppercase tracking-[0.2em]">
          {t('label')}
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onGenerate}
            className="mono text-brand-primary btn-press flex items-center gap-1 text-[10px] uppercase tracking-wider hover:underline"
          >
            <RefreshCw className="h-3 w-3" /> {t('generateBtn')}
          </button>
          <button
            type="button"
            onClick={onToggleShow}
            className="mono text-ink-mute btn-press hover:text-ink flex items-center gap-1 text-[10px] uppercase tracking-wider"
          >
            {show ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {show ? t('hideBtn') : t('showBtn')}
          </button>
        </div>
      </div>
      <Input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        disabled={disabled}
        autoComplete="new-password"
        placeholder={t('placeholder')}
        className="mono"
      />
    </div>
  );
}

function CredRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="mono text-ink-soft shrink-0 text-[10px] uppercase tracking-[0.2em]">
        {label}
      </span>
      <span className={`text-ink truncate text-sm ${mono ? 'mono' : ''}`}>{value}</span>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="border-red/30 bg-red/10 text-red flex items-start gap-2 rounded-sm border px-3 py-2 text-xs">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
