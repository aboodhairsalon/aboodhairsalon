'use client';

/**
 * Formulaire de réinitialisation du mot de passe — espace Direction.
 *
 * Thème clair « booking » via AuthShell (palette AUTH_C, carte centrée) —
 * cohérent avec /login et /cashier/login. Remplace l'ancienne coquille sombre
 * EntryShell (DA System A One).
 *
 * Deux modes sur la même page :
 *  - « request » : saisie de l'email → resetPasswordForEmail() → Supabase envoie
 *    un lien de récupération.
 *  - « recover » : arrivée depuis ce lien (code PKCE en query ou token dans le
 *    hash) → saisie d'un nouveau mot de passe → updateUser() → /manager.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { AUTH_C, AuthButton, AuthField, AuthShell } from '../_components/auth-ui';
import { getBrowserClient } from '../_data/supabase';

export function ResetPasswordForm({ logoUrl }: { logoUrl: string | null }) {
  const t = useTranslations('resetPassword');
  const [mode, setMode] = useState<'request' | 'recover'>('request');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  // Erreur stockée comme clé i18n (request vs recover) pour rester réactive au
  // changement de langue.
  type ErrorKey = 'requestFailed' | 'recoverFailed';
  const [errorKey, setErrorKey] = useState<ErrorKey | null>(null);

  useEffect(() => {
    // Capturer les artefacts de l'URL AVANT de créer le client : `detectSessionInUrl`
    // peut consommer/nettoyer le hash ou le code dès la création du client.
    const search = new URLSearchParams(window.location.search);
    const code = search.get('code'); // flux PKCE
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const accessToken = hash.get('access_token'); // flux implicite
    const refreshToken = hash.get('refresh_token');
    const hashIsRecovery = hash.get('type') === 'recovery' || (!!accessToken && !!refreshToken);

    const supabase = getBrowserClient();

    // Filet : Supabase émet PASSWORD_RECOVERY quand il traite le token de
    // récupération (couvre les cas où detectSessionInUrl gère tout seul).
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setMode('recover');
    });

    if (code) {
      // Flux PKCE : échange le code contre une session (verifier en localStorage,
      // posé lors de resetPasswordForEmail sur le même navigateur).
      setMode('recover');
      void supabase.auth.exchangeCodeForSession(code);
    } else if (hashIsRecovery) {
      // Flux implicite : établit la session depuis les tokens du hash.
      setMode('recover');
      if (accessToken && refreshToken) {
        void supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
      }
    }

    return () => subscription.unsubscribe();
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

  const errorMessage = errorKey
    ? errorKey === 'requestFailed'
      ? t('request.error')
      : t('recover.error')
    : null;

  // Pied commun : « mot de passe retrouvé ? → connexion ».
  const footer = (
    <div
      className="flex flex-wrap items-center justify-center gap-2 text-center text-xs"
      style={{ color: AUTH_C.back }}
    >
      <span>{t('footer.rememberedPassword')}</span>
      <Link
        href="/login"
        className="font-semibold transition-opacity hover:opacity-70"
        style={{ color: AUTH_C.title }}
      >
        {t('footer.backToLogin')} →
      </Link>
    </div>
  );

  // ---- Mode récupération : définir un nouveau mot de passe ----
  if (mode === 'recover') {
    return (
      <AuthShell
        logoUrl={logoUrl}
        roleLabel={t('eyebrow')}
        title={t('recover.title')}
        subtitle={t('recover.intro')}
        footer={footer}
      >
        <form onSubmit={updatePassword} className="space-y-3.5">
          <AuthField
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
          <AuthButton type="submit" loading={busy}>
            {busy ? t('recover.submitting') : t('recover.submit')}
          </AuthButton>
        </form>
      </AuthShell>
    );
  }

  // ---- Email de réinitialisation envoyé ----
  if (sent) {
    return (
      <AuthShell
        logoUrl={logoUrl}
        roleLabel={t('eyebrow')}
        title={t('sent.title')}
        subtitle={`${t('sent.bodyBefore')}${email}${t('sent.bodyAfter')}`}
        footer={footer}
      >
        <p className="text-xs leading-relaxed" style={{ color: AUTH_C.back }}>
          {t('sent.spamHint')}
        </p>
      </AuthShell>
    );
  }

  // ---- Mode demande : saisir l'email ----
  return (
    <AuthShell
      logoUrl={logoUrl}
      roleLabel={t('eyebrow')}
      title={t('request.title')}
      subtitle={t('request.intro')}
      footer={footer}
    >
      <form onSubmit={requestReset} className="space-y-3.5">
        <AuthField
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
        <AuthButton type="submit" loading={busy}>
          {busy ? t('request.submitting') : t('request.submit')}
        </AuthButton>
      </form>
    </AuthShell>
  );
}
