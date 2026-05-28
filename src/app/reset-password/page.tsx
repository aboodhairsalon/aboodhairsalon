/**
 * /reset-password — Server Component wrapper.
 *
 * Charge le logo du salon (`tenant_branding.logo_url`) puis rend le formulaire
 * client. Thème clair « booking » via AuthShell — symétrique de /login.
 */
import { fetchSalonLogo } from '../_data/tenant-brand';
import { ResetPasswordForm } from './ResetPasswordForm';

export default async function ResetPasswordPage() {
  const logoUrl = await fetchSalonLogo();
  return <ResetPasswordForm logoUrl={logoUrl} />;
}
