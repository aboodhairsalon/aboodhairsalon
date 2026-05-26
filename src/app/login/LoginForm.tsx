'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { AUTH_C, AuthButton, AuthField, AuthShell } from '../_components/auth-ui';
import { getBrowserClient } from '../_data/supabase';

type Status = { kind: 'idle' } | { kind: 'submitting' } | { kind: 'error'; message: string };

interface LoginFormProps {
  /** Slug du tenant résolu depuis l'URL (ex: "aboodhairsalon"). Vide si accès direct à /login. */
  slug: string;
  /** Source de la résolution tenant (cf. middleware x-tenant-source).
   *  Quand 'custom_domain' ou 'subdomain', le slug est implicite dans le host —
   *  on ne préfixe PAS l'URL avec /{slug}/ après login (sinon le browser navigue
   *  vers `www.aboodhairsalon.com/aboodhairsalon/manager` qui est laid). */
  tenantSource?: 'custom_domain' | 'subdomain' | 'path' | null;
  /** Logo du salon (tenant_branding.logo_url) — null si non configuré. */
  logoUrl: string | null;
}

export function LoginForm({ slug, tenantSource, logoUrl }: LoginFormProps) {
  const t = useTranslations('auth.direction');
  const tCommon = useTranslations('auth.common');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const submitting = status.kind === 'submitting';
  // Préfixe slug UNIQUEMENT en path-based mode (app.system-aone.com/{slug}/...).
  // Sur custom_domain/subdomain le slug est implicite — utilise un path nu.
  const useSlugPrefix =
    Boolean(slug) && tenantSource !== 'custom_domain' && tenantSource !== 'subdomain';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus({ kind: 'submitting' });
    const supabase = getBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) {
      setStatus({ kind: 'error', message: t('errorInvalidCredentials') });
      return;
    }
    window.location.href = useSlugPrefix ? `/${slug}/manager` : '/manager';
  };

  return (
    <AuthShell
      logoUrl={logoUrl}
      roleLabel={t('roleLabel')}
      title={t('title')}
      subtitle={t('subtitle')}
    >
      <form onSubmit={submit} className="space-y-3.5">
        <AuthField
          label={t('emailLabel')}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('emailPlaceholder')}
          disabled={submitting}
        />

        <AuthField
          label={t('passwordLabel')}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('passwordPlaceholder')}
          disabled={submitting}
          error={status.kind === 'error' ? status.message : undefined}
        />

        <div className="flex justify-end">
          <Link
            href="/reset-password"
            className="text-xs transition-opacity hover:opacity-70"
            style={{ color: AUTH_C.back }}
          >
            {t('forgotPassword')}
          </Link>
        </div>

        <AuthButton type="submit" loading={submitting}>
          {submitting ? tCommon('submitting') : t('submit')}
        </AuthButton>

        <p className="text-center text-xs" style={{ color: AUTH_C.back }}>
          {tCommon('secured')}
        </p>
      </form>
    </AuthShell>
  );
}
