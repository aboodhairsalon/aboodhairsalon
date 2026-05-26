/**
 * /cashier/login — Server Component wrapper.
 *
 * Single-tenant : pas de résolution de slug — l'identifiant `SALON.slug`
 * sert de tenantId stable pour les actions login (rate-limit key) et
 * la liste du staff est chargée directement depuis la table unique `staff`.
 *
 * Charge la liste du staff côté serveur pour :
 *  1. Éviter un useEffect + appel RPC depuis le navigateur.
 *  2. Garantir que tenantId est disponible pour la Server Action
 *     `loginCashierByName` sans jamais transiter par le navigateur sous
 *     forme de claim auto-signé.
 */
import { SALON } from '@/config/salon';
import { fetchSalonLogo } from '../../_data/tenant-brand';
import { fetchCashierStaff } from '../login-actions';
import { CashierLoginForm } from './CashierLoginForm';

export default async function CashierLoginPage() {
  const tenantId = SALON.slug;
  const [staffList, logoUrl] = await Promise.all([
    fetchCashierStaff(tenantId),
    fetchSalonLogo(),
  ]);

  return (
    <CashierLoginForm staffList={staffList} tenantId={tenantId} logoUrl={logoUrl} />
  );
}
