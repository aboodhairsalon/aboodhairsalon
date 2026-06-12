'use server';
/**
 * Server Actions — onglet Clients du Manager.
 *
 *  - `getManagerClients`   : liste des profils + métriques agrégées
 *  - `updateClientProfile` : édition d'une fiche client (identité)
 *  - `getClientHistory`    : historique des RDV d'un client
 *
 * Métriques agrégées de `getManagerClients` :
 *  - Nombre de visites (bookings paid=true)
 *  - Total dépensé (centimes)
 *  - Points de fidélité (1 pt / EGP dépensé = floor(total_cents / 100))
 *  - Date du dernier passage
 *
 * Utilise le client admin (bypass RLS) pour les requêtes cross-table.
 * La garde auth est gérée par le layout /manager (requireTenant) ; les
 * actions d'écriture / de détail revérifient le tenant via requireTenant().
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient } from '@/db';
import { SALON } from '@/config/salon';
import { requireTenant } from '../_data/auth-server';
import { utcIsoToZonedParts } from '../_lib/timezone';
import { rlManagerRead } from '../_lib/rate-limit';
import type { ManagerErrorCode, ManagerErrorValues } from './actions';

// Type d'erreur réutilisé depuis manager/actions.ts pour rester homogène —
// codes + valeurs d'interpolation résolus côté client via `useTranslations`.
type ErrResult = { ok: false; errorKey: ManagerErrorCode; errorValues?: ManagerErrorValues };

export type ManagerClient = {
  id: string;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  email: string | null;
  visitCount: number;
  totalSpentCents: number;
  points: number;
  lastVisitDate: string | null; // 'YYYY-MM-DD' ou null
  createdAt: string;
};

export type GetClientsResult = { ok: true; clients: ManagerClient[] } | ErrResult;

/**
 * Charge les profils clients du tenant avec métriques agrégées.
 *
 * @param tenantId — UUID du tenant ; revérifié contre la session.
 */
export async function getManagerClients(tenantId: string): Promise<GetClientsResult> {
  if (!tenantId) return { ok: false, errorKey: 'tenantMissing' };

  // Single-tenant : pas de guard cross-tenant. `requireTenant()` suffit pour
  // vérifier l'auth manager. Le paramètre `tenantId` est conservé pour ne pas
  // casser les call-sites mais sa valeur est inerte (== SALON.slug).
  const ctx = await requireTenant();

  // Rate-limit lecture manager (audit T4.2).
  if (!(await rlManagerRead(ctx.user.id))) {
    return { ok: false, errorKey: 'dbError', errorValues: { message: 'rate_limited' } };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // 1. Profils clients
  const { data: profiles, error: profilesErr } = await admin
    .from('client_profiles')
    .select('id, phone, first_name, last_name, date_of_birth, email, created_at')
    
    .order('created_at', { ascending: false });

  if (profilesErr) {
    return {
      ok: false,
      errorKey: 'loadClientsFailed',
      errorValues: { message: (profilesErr as { message?: string }).message ?? '' },
    };
  }

  // 2. Bookings payés pour métriques (groupés par client_phone)
  const { data: bookings } = await admin
    .from('bookings')
    .select('client_phone, amount_cents, starts_at')
    
    .eq('paid', true);

  // Agrégation par téléphone
  type BookingRow = { client_phone: string; amount_cents: number; starts_at: string };
  const metrics = new Map<string, { count: number; totalCents: number; lastDate: string | null }>();

  for (const b of (bookings as BookingRow[]) ?? []) {
    const phone = b.client_phone;
    if (!phone) continue;
    const existing = metrics.get(phone) ?? { count: 0, totalCents: 0, lastDate: null };
    const bDate = b.starts_at ? b.starts_at.split('T')[0]! : null;
    metrics.set(phone, {
      count: existing.count + 1,
      totalCents: existing.totalCents + (b.amount_cents ?? 0),
      lastDate:
        bDate && (!existing.lastDate || bDate > existing.lastDate) ? bDate : existing.lastDate,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clients: ManagerClient[] = ((profiles as any[]) ?? []).map((p) => {
    const m = metrics.get(p.phone as string) ?? { count: 0, totalCents: 0, lastDate: null };
    return {
      id: p.id as string,
      phone: p.phone as string,
      firstName: (p.first_name as string | null) ?? null,
      lastName: (p.last_name as string | null) ?? null,
      dateOfBirth: (p.date_of_birth as string | null) ?? null,
      email: (p.email as string | null) ?? null,
      visitCount: m.count,
      totalSpentCents: m.totalCents,
      points: Math.floor(m.totalCents / 100),
      lastVisitDate: m.lastDate,
      createdAt: p.created_at as string,
    };
  });

  return { ok: true, clients };
}

// =============================================================================
// updateClientProfile — édition d'une fiche client (identité uniquement)
// =============================================================================

/**
 * Champs éditables d'une fiche client. Le téléphone est exclu (clé d'identité,
 * cf. profile-actions) ; les points et visites sont calculés, non stockés.
 */
const ClientProfileSchema = z.object({
  id: z.string().uuid('Client invalide.'),
  firstName: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => v || null),
  lastName: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => v || null),
  // Pas de validation stricte du format e-mail — aligné sur StaffSchema.email.
  email: z
    .string()
    .trim()
    .max(160)
    .optional()
    .transform((v) => v || null),
  // Date au format 'YYYY-MM-DD' (depuis <input type="date">) ou null.
  dateOfBirth: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)),
});

export type ClientProfileInput = z.input<typeof ClientProfileSchema>;

/**
 * Met à jour l'identité d'un profil client (prénom, nom, naissance, e-mail).
 *
 * Le filtre `tenant_id` de l'UPDATE est la frontière de sécurité : un `id`
 * arbitraire ne peut jamais toucher la fiche d'un autre salon.
 */
export async function updateClientProfile(
  input: ClientProfileInput,
): Promise<{ ok: true } | ErrResult> {
  const ctx = await requireTenant();

  const parsed = ClientProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errorKey: 'invalidData' };
  }
  const d = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Lire l'email ACTUEL avant l'update pour détecter un changement et
  // pouvoir notifier l'ancienne adresse + log dans audit_log (T3.3).
  const { data: existingRow } = await admin
    .from('client_profiles')
    .select('email')
    .eq('id', d.id)
    
    .maybeSingle();
  const oldEmail = ((existingRow as { email?: string | null } | null)?.email ?? '').trim();
  const newEmail = (d.email ?? '').trim();
  const emailChanged =
    oldEmail.toLowerCase() !== newEmail.toLowerCase() && oldEmail.length > 0 && newEmail.length > 0;

  const { error } = await admin
    .from('client_profiles')
    .update({
      first_name: d.firstName,
      last_name: d.lastName,
      date_of_birth: d.dateOfBirth,
      email: d.email,
    })
    .eq('id', d.id)
    ;

  if (error) {
    return {
      ok: false,
      errorKey: 'dbError',
      errorValues: { message: (error as { message?: string }).message ?? '' },
    };
  }

  // Effets de bord post-update — best-effort, n'échouent pas le succès.
  if (emailChanged) {
    // Audit log : trace l'opération + acteur + diff pour pouvoir investiguer
    // un éventuel détournement de compte. La colonne `diff` est JSONB donc
    // on stocke un objet { from, to } pour la lisibilité.
    void admin.from('audit_log').insert({
      tenant_id: ctx.tenant.id,
      actor_id: ctx.user.id,
      table_name: 'client_profiles',
      row_id: d.id,
      // CHECK DB : operation IN ('INSERT','UPDATE','DELETE') — l'ancienne
      // valeur 'email_changed' violait la contrainte et l'insert (void)
      // échouait silencieusement → AUCUNE trace d'audit. Le type d'événement
      // vit dans diff.event à la place.
      operation: 'UPDATE',
      diff: { event: 'email_changed', from: oldEmail, to: newEmail },
    });

    // Notif à l'ancienne adresse — sans bloquer la réponse. Si Resend pas
    // configuré (env manquant), échec silencieux acceptable car l'audit log
    // garde la trace.
    void notifyOldEmailOfChange({
      oldEmail,
      newEmail,
      tenantId: ctx.tenant.id,
      tenantName: ctx.tenant.name,
    });
  }

  revalidatePath('/manager');
  return { ok: true };
}

/** Envoie à l'ancien email un message « votre email a changé chez X » pour
 *  que le client puisse alerter le salon si ce n'est pas lui qui l'a
 *  demandé. Best-effort : si Resend pas configuré ou échec réseau, on
 *  laisse passer (l'audit_log conserve la trace pour investigation). */
async function notifyOldEmailOfChange(args: {
  oldEmail: string;
  newEmail: string;
  tenantId: string;
  tenantName: string;
}): Promise<void> {
  const resendKey = process.env['RESEND_API_KEY'];
  if (!resendKey) return;
  const { resolveFromHeader } = await import('../_lib/email-sender');
  const fromHeader = await resolveFromHeader(args.tenantId, args.tenantName);
  try {
    const { Resend } = (await import('resend')) as { Resend: new (k: string) => unknown };
    const resend = new Resend(resendKey) as {
      emails: {
        send: (a: {
          from: string;
          to: string[];
          subject: string;
          text: string;
          tags?: { name: string; value: string }[];
        }) => Promise<{ error: { message: string } | null }>;
      };
    };
    // Masque l'email cible pour ne pas le fuiter dans le message si quelqu'un
    // sniffe les transactions (ex. fwd to wrong inbox). On affiche juste le
    // domaine du nouvel email.
    const newEmailMasked = (() => {
      const at = args.newEmail.indexOf('@');
      if (at < 1) return '***';
      const local = args.newEmail.slice(0, at);
      const domain = args.newEmail.slice(at);
      return `${local[0]}***${domain}`;
    })();
    await resend.emails.send({
      from: fromHeader,
      to: [args.oldEmail],
      subject: `Votre email a été modifié chez ${args.tenantName}`,
      text:
        `Bonjour,\n\n` +
        `L'adresse email associée à votre compte chez ${args.tenantName} vient d'être modifiée vers ${newEmailMasked}.\n\n` +
        `Si vous êtes à l'origine de ce changement, vous pouvez ignorer ce message.\n\n` +
        `Si ce n'est PAS vous, contactez le salon immédiatement pour faire annuler la modification.\n\n` +
        `— ${args.tenantName}`,
      tags: [{ name: 'type', value: 'email-change-notif' }],
    });
  } catch {
    // best-effort, on n'échoue pas la mutation client à cause d'un email
  }
}

// =============================================================================
// getClientHistory — historique des RDV d'un client
// =============================================================================

export type ClientVisit = {
  id: string;
  date: string; // 'YYYY-MM-DD'
  time: string; // 'HH:mm' (UTC)
  serviceName: string;
  barberName: string;
  status: string;
  amountCents: number;
  paid: boolean;
};

export type GetClientHistoryResult = { ok: true; visits: ClientVisit[] } | ErrResult;

/**
 * Liste tous les RDV d'un client (identifié par son téléphone), du plus
 * récent au plus ancien. Joint `services` et `staff` pour les libellés.
 *
 * @param tenantId — UUID du tenant ; revérifié contre la session.
 * @param phone    — téléphone du client (clé d'identité, cf. profile-actions).
 */
export async function getClientHistory(
  tenantId: string,
  phone: string,
): Promise<GetClientHistoryResult> {
  if (!tenantId) return { ok: false, errorKey: 'tenantMissing' };
  // Single-tenant : pas de guard cross-tenant. `requireTenant()` suffit pour
  // vérifier l'auth manager.
  const ctx = await requireTenant();
  // Rate-limit lecture manager (audit T4.2).
  if (!(await rlManagerRead(ctx.user.id))) {
    return { ok: false, errorKey: 'dbError', errorValues: { message: 'rate_limited' } };
  }
  if (!phone?.trim()) return { ok: true, visits: [] };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data, error } = await admin
    .from('bookings')
    .select('id, starts_at, amount_cents, paid, status, services(name), staff(name)')
    
    .eq('client_phone', phone.trim())
    .order('starts_at', { ascending: false });

  if (error) {
    return {
      ok: false,
      errorKey: 'dbError',
      errorValues: { message: (error as { message?: string }).message ?? '' },
    };
  }

  type BookingRow = {
    id: string;
    starts_at: string;
    amount_cents: number | null;
    paid: boolean | null;
    status: string | null;
    services: { name?: string } | null;
    staff: { name?: string } | null;
  };

  const visits: ClientVisit[] = ((data as BookingRow[]) ?? []).map((row) => {
    // Heure locale salon (Le Caire), pas UTC — cf. audit timezone.
    const zoned = utcIsoToZonedParts(row.starts_at, SALON.timezone);
    return {
      id: row.id,
      date: zoned.date,
      time: zoned.time,
      serviceName: row.services?.name ?? 'Prestation',
      barberName: row.staff?.name ?? 'Barbier',
      status: row.status ?? 'upcoming',
      amountCents: row.amount_cents ?? 0,
      paid: row.paid ?? false,
    };
  });

  return { ok: true, visits };
}
