'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { AUTH_C, AuthButton, AuthField, AuthShell } from '../_components/auth-ui';
import { loginManager } from './login-actions';

type Status = { kind: 'idle' } | { kind: 'submitting' } | { kind: 'error'; message: string };

interface LoginFormProps {
  /** Logo du salon (`salon_settings.logo_url`) — null si non configuré. */
  logoUrl: string | null;
}

export function LoginForm({ logoUrl }: LoginFormProps) {
  const t = useTranslations('auth.direction');
  const tCommon = useTranslations('auth.common');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const submitting = status.kind === 'submitting';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus({ kind: 'submitting' });
    // Server action : rate-limit (email + IP) + signIn server-side (cookie posé).
    try {
      const res = await loginManager(email, password);
      if (!res.ok) {
        setStatus({
          kind: 'error',
          message:
            res.code === 'rateLimited'
              ? tCommon('rateLimited')
              : t('errorInvalidCredentials'),
        });
        return;
      }
      // Single-tenant : pas de préfixe slug — toujours /manager.
      window.location.href = '/manager';
    } catch {
      setStatus({ kind: 'error', message: t('errorInvalidCredentials') });
    }
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
