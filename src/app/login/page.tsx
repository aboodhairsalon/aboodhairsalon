/**
 * /login — Server Component wrapper.
 *
 * Lit le slug du tenant depuis le header x-tenant-slug injecté par le
 * middleware quand l'URL est /{slug}/login (réécrite en /login).
 * En accès direct /login (hors contexte tenant), slug est vide — la
 * LoginForm redirige alors vers /manager après authentification.
 */
import { headers } from 'next/headers';
import { fetchTenantLogo } from '../_data/tenant-brand';
import { LoginForm } from './LoginForm';

export default async function LoginPage() {
  const headersList = await headers();
  const slug = headersList.get('x-tenant-slug') ?? '';
  const tenantId = headersList.get('x-tenant-id') ?? '';
  const tenantSource = headersList.get('x-tenant-source') as
    | 'custom_domain'
    | 'subdomain'
    | 'path'
    | null;
  const logoUrl = await fetchTenantLogo(tenantId);
  return <LoginForm slug={slug} tenantSource={tenantSource} logoUrl={logoUrl} />;
}
