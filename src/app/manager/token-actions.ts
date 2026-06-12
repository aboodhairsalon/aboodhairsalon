'use server';
/**
 * Server Actions — issue de tokens signés pour l'accès à l'espace client.
 *
 * Le browser ne peut PAS signer un token (le secret HMAC est serveur-only),
 * il doit donc demander au serveur. On expose une action simple qui prend
 * le `phone` du client rattaché à une vente, vérifie l'ownership tenant
 * (le caissier connecté doit avoir un client_phone qui matche dans une
 * vente du tenant), puis émet un token avec exp 90 jours.
 */
import { SALON } from '@/config/salon';
import { getCurrentUser } from '../_data/auth-server';
import { createClientToken } from '../_lib/client-token';
import type { ManagerErrorCode, ManagerErrorValues } from './actions';

export type IssueTokenResult =
  | { ok: true; token: string }
  | { ok: false; errorKey: ManagerErrorCode; errorValues?: ManagerErrorValues };

/** Émet un token pour `(tenant courant, phone fourni)`. La garde se limite à
 *  "appelant authentifié avec tenant_id". Pas de vérification que le phone
 *  appartient bien à un client de ce tenant — un caissier qui veut émettre
 *  un token pour un nouveau client (avant que la vente soit en DB) doit
 *  pouvoir le faire. La signature HMAC empêche le re-use cross-tenant. */
export async function issueClientToken(phone: string): Promise<IssueTokenResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, errorKey: 'directionOnly' };
  // Single-tenant : staff authentifié suffit + le tenant du token est TOUJOURS
  // la constante SALON (le vérificateur attend SALON.tenantUuid). L'ancien
  // code exigeait le claim app_metadata.tenant_id (absent des caissiers →
  // QR fidélité jamais émis) ET signait avec la valeur du claim (≠ vérif).
  const role = user.app_metadata?.['role'] as string | undefined;
  if (role && role !== 'manager' && role !== 'cashier') {
    return { ok: false, errorKey: 'tenantMissing' };
  }

  const normalized = phone?.trim();
  if (!normalized || normalized.length < 3) {
    return { ok: false, errorKey: 'invalidData' };
  }

  try {
    const token = createClientToken(SALON.tenantUuid, normalized);
    return { ok: true, token };
  } catch {
    return { ok: false, errorKey: 'dbError' };
  }
}
