'use client';

/**
 * /reset-password — réinitialisation du mot de passe de l'espace Direction.
 *
 * Deux modes sur la même page :
 *  - « request » : l'utilisateur saisit son email → resetPasswordForEmail()
 *    → Supabase envoie un email contenant un lien de récupération.
 *  - « recover » : arrivée depuis ce lien (token de récupération dans le hash
 *    de l'URL) → saisie d'un nouveau mot de passe → updateUser() →
 *    redirection vers /manager (la session de récupération vaut connexion).
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import {
  EntryButton,
  EntryEyebrow,
  EntryField,
  EntryShell,
  SerifAccent,
} from '../_components/entry-ui';
import { getBrowserClient } from '../_data/supabase';

const MONO = 'var(--font-jetbrains), ui-monospace, SFMono-Regular, monospace';

export default function ResetPasswordPage() {
  const t = useTranslations('resetPassword');
  const [mode, setMode] = useState<'request' | 'recover'>('request');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  // L'erreur est stockée comme clé i18n (request vs recover) pour rester
  // réactive au changement de langue.
  type ErrorKey = 'requestFailed' | 'recoverFailed';
  const [errorKey, setErrorKey] = useState<ErrorKey | null>(null);

  useEffect(() => {
    // Lire le hash AVANT de créer le client (detectSessionInUrl le consomme).
    // Le lien email implicite renvoie ici avec #access_token=…&type=recovery.
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const accessToken = hash.get('access_token');
    const refreshToken = hash.get('refresh_token');
    const isRecovery = hash.get('type') === 'recovery' || (!!accessToken && !!refreshToken);
    if (!isRecovery) return;

    setMode('recover');
    // Établit explicitement la session de récupération depuis les tokens du
    // hash — fiable et indépendant de l'appareil où le lien a été demandé.
    if (accessToken && refreshToken) {
      void getBrowserClient().auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
    }
  }, []);

  const requestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorKey(null);
    const supabase = getBrowserClient();
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (err) {
      setErrorKey('requestFailed');
      return;
    }
    setSent(true);
  };

  const updatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorKey(null);
    const supabase = getBrowserClient();
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) {
      setBusy(false);
      setErrorKey('recoverFailed');
      return;
    }
    window.location.href = '/manager';
  };

  // Résout l'erreur active vers la chaîne traduite — fait à chaque render
  // donc cohérent avec la locale courante.
  const errorMessage = errorKey
    ? errorKey === 'requestFailed'
      ? t('request.error')
      : t('recover.error')
    : null;

  return (
    <EntryShell
      eyebrow={t('eyebrow')}
      headline={
        <>
          {t('headlineLine1')}
          <br />
          <SerifAccent>{t('headlineAccent')}</SerifAccent>
        </>
      }
      intro={t('intro')}
    >
      {mode === 'recover' ? (
        // ---- Mode récupération : définir un nouveau mot de passe ----
        <div className="aone-fade" style={{ animationDelay: '120ms' }}>
          <EntryEyebrow>{t('recover.eyebrow')}</EntryEyebrow>
          <h2 className="mt-4 text-[27px] font-semibold leading-tight tracking-[-0.035em] text-[#FAFAFA]">
            {t('recover.title')}
          </h2>
          <p className="mt-2 text-[14px] leading-relaxed text-[#A1A1AA]">{t('recover.intro')}</p>

          <form onSubmit={updatePassword} className="mt-8 space-y-5">
            <EntryField
              label={t('recover.passwordLabel')}
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('recover.passwordPlaceholder')}
              disabled={busy}
              error={errorMessage ?? undefined}
            />
            <EntryButton type="submit" loading={busy}>
              {busy ? t('recover.submitting') : t('recover.submit')}
            </EntryButton>
          </form>
        </div>
      ) : sent ? (
        // ---- Email de réinitialisation envoyé ----
        <div className="aone-fade" style={{ animationDelay: '120ms' }}>
          <EntryEyebrow>{t('sent.eyebrow')}</EntryEyebrow>
          <h2 className="mt-4 text-[27px] font-semibold leading-tight tracking-[-0.035em] text-[#FAFAFA]">
            {t('sent.title')}
          </h2>
          <div className="mt-6 rounded-[12px] border border-[#A3E635]/25 bg-[#A3E635]/[0.05] p-5">
            <p className="text-[14px] leading-relaxed text-[#D4D4D8]">
              {t('sent.bodyBefore')}
              <strong className="text-[#FAFAFA]">{email}</strong>
              {t('sent.bodyAfter')}
            </p>
          </div>
          <p className="mt-4 text-[12px] leading-relaxed text-[#71717A]">{t('sent.spamHint')}</p>
        </div>
      ) : (
        // ---- Mode demande : saisir l'email ----
        <div className="aone-fade" style={{ animationDelay: '120ms' }}>
          <EntryEyebrow>{t('request.eyebrow')}</EntryEyebrow>
          <h2 className="mt-4 text-[27px] font-semibold leading-tight tracking-[-0.035em] text-[#FAFAFA]">
            {t('request.title')}
          </h2>
          <p className="mt-2 text-[14px] leading-relaxed text-[#A1A1AA]">{t('request.intro')}</p>

          <form onSubmit={requestReset} className="mt-8 space-y-5">
            <EntryField
              label={t('request.emailLabel')}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('request.emailPlaceholder')}
              disabled={busy}
              error={errorMessage ?? undefined}
            />
            <EntryButton type="submit" loading={busy}>
              {busy ? t('request.submitting') : t('request.submit')}
            </EntryButton>
          </form>
        </div>
      )}

      <div
        className="aone-fade mt-8 flex items-center gap-3 border-t border-[rgba(250,250,250,0.07)] pt-6"
        style={{ animationDelay: '300ms' }}
      >
        <span
          className="text-[10.5px] uppercase tracking-[0.18em] text-[#71717A]"
          style={{ fontFamily: MONO }}
        >
          {t('footer.rememberedPassword')}
        </span>
        <Link
          href="/login"
          className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-[#A3E635] transition-colors hover:text-[#BEF264]"
        >
          {t('footer.backToLogin')}
          <span className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
        </Link>
      </div>
    </EntryShell>
  );
}
