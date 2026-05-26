/**
 * /cashier/login — Server Component wrapper.
 *
 * Lit le tenant depuis les headers x-tenant-* injectés par le middleware
 * (URL /{slug}/cashier/login réécrite en /cashier/login).
 *
 * Charge la liste du staff côté serveur pour :
 *  1. Éviter un useEffect + appel RPC depuis le navigateur.
 *  2. Garantir que tenantId est disponible pour la Server Action
 *     `loginCashierByName` sans jamais transiter par le navigateur sous
 *     forme de claim auto-signé.
 *
 * En accès direct /cashier/login (sans slug middleware), staffList sera vide
 * et un message "Contactez la direction" s'affiche.
 */
import { headers } from 'next/headers';
import { fetchTenantLogo } from '../../_data/tenant-brand';
import { fetchCashierStaff } from '../login-actions';
import { CashierLoginForm } from './CashierLoginForm';

export default async function CashierLoginPage() {
  const headersList = await headers();
  const tenantId = headersList.get('x-tenant-id') ?? '';
  const slug = headersList.get('x-tenant-slug') ?? '';
  const tenantSource = headersList.get('x-tenant-source') as
    | 'custom_domain'
    | 'subdomain'
    | 'path'
    | null;

  const [staffList, logoUrl] = await Promise.all([
    fetchCashierStaff(tenantId),
    fetchTenantLogo(tenantId),
  ]);

  return (
    <CashierLoginForm
      staffList={staffList}
      tenantId={tenantId}
      slug={slug}
      tenantSource={tenantSource}
      logoUrl={logoUrl}
    />
  );
}
