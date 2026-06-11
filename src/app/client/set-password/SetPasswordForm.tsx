'use client';
/**
 * Formulaire de définition de mot de passe client. Consomme le token `rt`
 * (lien email signé) et appelle `setClientPassword`. En cas de succès, le
 * client est connecté (cookie de session posé côté serveur) → redirection
 * vers son espace.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AuthField, AuthButton } from '../../_components/auth-ui';
import { setClientPassword } from '../auth-actions';

export function SetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const t = useTranslations('client.setPassword');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError(t('errors.linkInvalid'));
      return;
    }
    if (pw.length < 8) {
      setError(t('errors.tooShort'));
      return;
    }
    if (pw !== confirm) {
      setError(t('errors.mismatch'));
      return;
    }
    setLoading(true);
    try {
      const res = await setClientPassword(token, pw);
      setLoading(false);
      if (res.ok) {
        router.push('/client');
        router.refresh();
        return;
      }
      setError(
        res.code === 'invalidToken'
          ? t('errors.linkInvalid')
          : res.code === 'weakPassword'
            ? t('errors.tooShort')
            : t('errors.generic'),
      );
    } catch {
      // Réseau / timeout : on évite de laisser le bouton bloqué sur loading.
      setLoading(false);
      setError(t('errors.generic'));
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <AuthField
        label={t('newPasswordLabel')}
        type="password"
        autoComplete="new-password"
        value={pw}
        onChange={(e) => {
          setPw(e.target.value);
          setError(null);
        }}
        placeholder="••••••••"
      />
      <AuthField
        label={t('confirmPasswordLabel')}
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => {
          setConfirm(e.target.value);
          setError(null);
        }}
        placeholder="••••••••"
        error={error ?? undefined}
      />
      <AuthButton type="submit" loading={loading} disabled={!pw || !confirm}>
        {t('submit')}
      </AuthButton>
    </form>
  );
}
