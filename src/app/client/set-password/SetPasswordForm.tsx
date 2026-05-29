'use client';
/**
 * Formulaire de définition de mot de passe client. Consomme le token `rt`
 * (lien email signé) et appelle `setClientPassword`. En cas de succès, le
 * client est connecté (cookie de session posé côté serveur) → redirection
 * vers son espace.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthField, AuthButton } from '../../_components/auth-ui';
import { setClientPassword } from '../auth-actions';

export function SetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError('Lien invalide ou expiré. Redemandez un email de réinitialisation.');
      return;
    }
    if (pw.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    if (pw !== confirm) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setLoading(true);
    const res = await setClientPassword(token, pw);
    setLoading(false);
    if (res.ok) {
      router.push('/client');
      router.refresh();
      return;
    }
    setError(
      res.code === 'invalidToken'
        ? 'Lien invalide ou expiré. Redemandez un email de réinitialisation.'
        : res.code === 'weakPassword'
          ? 'Mot de passe trop faible (au moins 8 caractères).'
          : 'Une erreur est survenue. Réessayez.',
    );
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <AuthField
        label="Nouveau mot de passe"
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
        label="Confirmer le mot de passe"
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
        Enregistrer le mot de passe
      </AuthButton>
    </form>
  );
}
