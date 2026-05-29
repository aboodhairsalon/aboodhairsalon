/**
 * /client/set-password — page de définition / réinitialisation du mot de passe
 * client, atteinte via le lien signé envoyé par email (`?rt=<token>`).
 *
 * Server Component : lit le token de l'URL + le logo, rend la coquille d'auth
 * (AuthShell, même DA que les pages de connexion) avec le formulaire client.
 */
import { AuthShell } from '../../_components/auth-ui';
import { fetchSalonLogo } from '../../_data/tenant-brand';
import { SetPasswordForm } from './SetPasswordForm';

export const dynamic = 'force-dynamic';

export default async function ClientSetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const token = typeof sp['rt'] === 'string' ? sp['rt'] : '';
  const logoUrl = await fetchSalonLogo();

  return (
    <AuthShell
      roleLabel="Espace Client"
      title="Votre mot de passe"
      subtitle="Choisissez un mot de passe pour sécuriser l'accès à votre compte (rendez-vous, cashback)."
      logoUrl={logoUrl}
    >
      <SetPasswordForm token={token} />
    </AuthShell>
  );
}
