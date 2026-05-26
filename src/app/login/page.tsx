/**
 * /login — Server Component wrapper.
 *
 * Single-tenant : pas de résolution de slug — la page sert toujours le
 * salon courant et redirige vers /manager après authentification.
 * Le logo du salon est chargé depuis `salon_settings` via `fetchSalonLogo()`.
 */
import { fetchSalonLogo } from '../_data/tenant-brand';
import { LoginForm } from './LoginForm';

export default async function LoginPage() {
  const logoUrl = await fetchSalonLogo();
  return <LoginForm logoUrl={logoUrl} />;
}
