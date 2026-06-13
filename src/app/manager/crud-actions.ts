'use server';
/**
 * Server Actions CRUD — staff, services, products.
 *
 * Toutes passent par la session du user (RLS isole par tenant_id).
 * `revalidatePath('/manager')` après chaque mutation → le layout recharge
 * les collections fraîches.
 *
 * Convention de retour : `{ ok: true, id? }` ou `{ ok: false, errorKey, errorValues? }`.
 * Les codes sont résolus côté client via `useTranslations('manager.errors.*')` —
 * aucune chaîne FR ne traverse le boundary serveur → client.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Database } from '@/db';
import { createAdminClient } from '@/db';
import { requireTenant } from '../_data/auth-server';

// FIX critique : les CRUD (staff, services, products) tournaient sur
// getServerSupabase() (session, RLS-enforced). En single-tenant Aboodhairsalon
// le JWT manager n'a pas (ou plus) le claim `tenant_id` dans app_metadata →
// la policy RLS bloquait silencieusement les UPDATE (0 ligne affectée, pas
// d'erreur PG) → modifs prix/durée ne prenaient pas effet. Symétrique du
// fix booking-actions.ts. Sécurité conservée via requireTenant().

// @supabase/ssr v0.5.x a des trous d'inférence quand le schéma est volumineux :
// `.from(table).insert(obj)` infère le paramètre comme `never` au lieu du type
// `Insert` de la table. On caste l'OBJET vers son type Insert exact (pas `never`)
// pour conserver le type-check sur les champs tout en contournant le bug d'inférence.
type StaffInsert = Database['public']['Tables']['staff']['Insert'];
type ServiceInsert = Database['public']['Tables']['services']['Insert'];
type ProductInsert = Database['public']['Tables']['products']['Insert'];

/** Codes d'erreur émis par les mutations CRUD. */
export type CrudErrorCode =
  | 'invalidData'
  | 'nameRequired'
  | 'skuRequired'
  | 'rolesRequired'
  | 'invalidColor'
  | 'skuTaken'
  | 'dbError';

export type CrudErrorValues = Record<string, string | number>;

export type MutationResult =
  | { ok: true; id?: string }
  | { ok: false; errorKey: CrudErrorCode; errorValues?: CrudErrorValues };

/** Convertit un message Zod (utilisé comme code) en CrudErrorCode reconnu. */
function zodMessageToCode(message: string | undefined): CrudErrorCode {
  const known: CrudErrorCode[] = ['nameRequired', 'skuRequired', 'rolesRequired', 'invalidColor'];
  return (known as readonly string[]).includes(message ?? '')
    ? (message as CrudErrorCode)
    : 'invalidData';
}

// Helper Zod : trim + max + accepte string vide / absente → null.
// Utilisé pour les data URLs (photo de profil), qui peuvent être très longues.
const nullableString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v === '' || v == null ? null : v));

// =============================================================================
// STAFF
// =============================================================================

const StaffSchema = z.object({
  name: z.string().trim().min(1, 'nameRequired').max(80),
  initials: z.string().trim().min(1).max(3),
  tone: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'invalidColor'),
  isActive: z.boolean().optional(),
  photoUrl: nullableString(3_000_000),
  phone: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => v || null),
  email: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => v || null),
  roles: z.array(z.enum(['barber', 'cashier'])).min(1, 'rolesRequired'),
  shift: z
    .string()
    .trim()
    .max(60)
    .nullable()
    .optional()
    .transform((v) => v || null),
  commissionBp: z.number().int().min(0).max(10000).optional(),
  category: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => v || null),
});

export type StaffInput = z.input<typeof StaffSchema>;

export async function createStaff(input: StaffInput): Promise<MutationResult> {
  const ctx = await requireTenant();
  const supabase = createAdminClient();
  const parsed = StaffSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errorKey: zodMessageToCode(parsed.error.errors[0]?.message) };
  }
  const d = parsed.data;
  // Objet typé `StaffInsert` (type-check complet des champs) puis `as never` au
  // call-site pour contourner l'inférence `.insert(never)` de @supabase/ssr.
  const row: StaffInsert = {
    tenant_id: ctx.tenant.id,
    name: d.name,
    initials: d.initials.toUpperCase(),
    tone: d.tone,
    phone: d.phone,
    email: d.email,
    photo_url: d.photoUrl ?? null,
    roles: d.roles,
    shift: d.shift,
    commission_bp: d.commissionBp ?? 4000,
    category: d.category,
  };
  const { data, error } = await supabase
    .from('staff')
    .insert(row as never)
    .select('id')
    .single();
  if (error) return { ok: false, errorKey: 'dbError', errorValues: { message: error.message } };
  revalidatePath('/manager');
  return { ok: true, id: (data as { id: string }).id };
}

export async function updateStaff(id: string, input: StaffInput): Promise<MutationResult> {
  await requireTenant();
  const supabase = createAdminClient();
  const parsed = StaffSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errorKey: zodMessageToCode(parsed.error.errors[0]?.message) };
  }
  const d = parsed.data;
  const { error } = await supabase
    .from('staff')
    .update({
      name: d.name,
      initials: d.initials.toUpperCase(),
      tone: d.tone,
      is_active: d.isActive ?? true,
      phone: d.phone,
      email: d.email,
      photo_url: d.photoUrl ?? null,
      roles: d.roles,
      shift: d.shift,
      commission_bp: d.commissionBp ?? 4000,
      category: d.category,
    } as never)
    .eq('id', id);
  if (error) return { ok: false, errorKey: 'dbError', errorValues: { message: error.message } };
  revalidatePath('/manager');
  return { ok: true };
}

export async function setStaffActive(id: string, isActive: boolean): Promise<MutationResult> {
  await requireTenant();
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('staff')
    .update({ is_active: isActive } as never)
    .eq('id', id);
  if (error) return { ok: false, errorKey: 'dbError', errorValues: { message: error.message } };
  revalidatePath('/manager');
  return { ok: true };
}

export async function deleteStaff(id: string): Promise<MutationResult> {
  await requireTenant();
  const supabase = createAdminClient();
  const { error } = await supabase.from('staff').delete().eq('id', id);
  if (error) return { ok: false, errorKey: 'dbError', errorValues: { message: error.message } };
  revalidatePath('/manager');
  return { ok: true };
}

// =============================================================================
// SERVICES
// =============================================================================

const ServiceSchema = z.object({
  name: z.string().trim().min(1, 'nameRequired').max(80),
  duration: z.number().int().min(5).max(480),
  priceCents: z.number().int().min(0),
  icon: z.enum(['scissors', 'razor', 'crown', 'shield', 'star', 'sparkle']),
  desc: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => v || null),
  category: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => v || null),
  // Coiffeurs (staff.id) autorisés à réaliser la prestation. Vide = tous.
  // L'UI n'envoie que des staff.id valides ; la FK service_barbers→staff
  // rejette de toute façon un id invalide.
  barberIds: z.array(z.string().uuid()).max(50).optional().default([]),
});

export type ServiceInput = z.input<typeof ServiceSchema>;

export async function createService(input: ServiceInput): Promise<MutationResult> {
  const ctx = await requireTenant();
  const supabase = createAdminClient();
  const parsed = ServiceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errorKey: zodMessageToCode(parsed.error.errors[0]?.message) };
  }
  const d = parsed.data;
  const row: ServiceInsert = {
    tenant_id: ctx.tenant.id,
    name: d.name,
    duration_min: d.duration,
    price_cents: d.priceCents,
    icon: d.icon,
    description: d.desc,
    category: d.category,
  };
  const { data, error } = await supabase
    .from('services')
    .insert(row as never)
    .select('id')
    .single();
  if (error) return { ok: false, errorKey: 'dbError', errorValues: { message: error.message } };
  const serviceId = (data as { id: string }).id;

  // Assignations coiffeurs (M:N). Vide → on n'insère rien (= tous les coiffeurs).
  if (d.barberIds.length > 0) {
    const sbRows = d.barberIds.map((barberId) => ({
      service_id: serviceId,
      barber_id: barberId,
      tenant_id: ctx.tenant.id,
    }));
    const { error: sbErr } = await supabase.from('service_barbers').insert(sbRows as never);
    if (sbErr) return { ok: false, errorKey: 'dbError', errorValues: { message: sbErr.message } };
  }

  revalidatePath('/manager');
  return { ok: true, id: serviceId };
}

export async function updateService(id: string, input: ServiceInput): Promise<MutationResult> {
  const ctx = await requireTenant();
  const supabase = createAdminClient();
  const parsed = ServiceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errorKey: zodMessageToCode(parsed.error.errors[0]?.message) };
  }
  const d = parsed.data;
  const { error } = await supabase
    .from('services')
    .update({
      name: d.name,
      duration_min: d.duration,
      price_cents: d.priceCents,
      icon: d.icon,
      description: d.desc,
      category: d.category,
    } as never)
    .eq('id', id);
  if (error) return { ok: false, errorKey: 'dbError', errorValues: { message: error.message } };

  // Remplace l'ensemble des assignations coiffeurs : on efface puis on réinsère
  // (delete-then-insert). Pas transactionnel mais idempotent : un échec d'insert
  // laisse la liste vide (= tous), un retry recolle. Vide → reste effacé.
  const { error: delErr } = await supabase.from('service_barbers').delete().eq('service_id', id);
  if (delErr) return { ok: false, errorKey: 'dbError', errorValues: { message: delErr.message } };
  if (d.barberIds.length > 0) {
    const sbRows = d.barberIds.map((barberId) => ({
      service_id: id,
      barber_id: barberId,
      tenant_id: ctx.tenant.id,
    }));
    const { error: insErr } = await supabase.from('service_barbers').insert(sbRows as never);
    if (insErr) return { ok: false, errorKey: 'dbError', errorValues: { message: insErr.message } };
  }

  revalidatePath('/manager');
  return { ok: true };
}

/**
 * Réordonne les prestations en mettant `sort_order = index` pour chaque ID.
 * Mirror de `reorderGalleryPhotos` — call avec la liste complète des IDs
 * dans le nouvel ordre voulu. Les rangées non listées gardent leur sort_order
 * (en pratique tu envoies TOUS les services pour rester cohérent).
 */
export async function reorderServices(serviceIds: string[]): Promise<MutationResult> {
  await requireTenant();
  const admin = createAdminClient();

  const idsValid = z.array(z.string().uuid()).min(0).max(200).safeParse(serviceIds);
  if (!idsValid.success) return { ok: false, errorKey: 'invalidData' };

  // Updates en parallèle — chaque ligne reçoit son nouveau sort_order = index.
  // En cas d'erreur partielle on retourne la première erreur ; les updates déjà
  // passés restent commités (acceptable : un retry côté UI suffit, l'ordre reste
  // cohérent même s'il diffère du voulu).
  const updates = idsValid.data.map((id, idx) =>
    admin
      .from('services')
      .update({ sort_order: idx } as never)
      .eq('id', id),
  );

  const results = await Promise.all(updates);
  const firstErr = results.find((r) => r.error);
  if (firstErr?.error) {
    return {
      ok: false,
      errorKey: 'dbError',
      errorValues: { message: firstErr.error.message },
    };
  }
  revalidatePath('/manager');
  return { ok: true };
}

export async function deleteService(id: string): Promise<MutationResult> {
  await requireTenant();
  const supabase = createAdminClient();
  // Suppression intelligente : on tente le DELETE réel. Si le service est
  // référencé par des RDV (bookings.service_id), Postgres lève une violation
  // de clé étrangère (23503) — on bascule alors en ARCHIVAGE (is_active=false).
  // Le service disparaît du booking client, de la caisse ET de l'admin, mais
  // les RDV historiques gardent leur référence intacte. Empêche l'erreur DB
  // brute « violates foreign key constraint bookings_service_id_fkey ».
  const { error } = await supabase.from('services').delete().eq('id', id);
  if (error) {
    const isFk =
      (error as { code?: string }).code === '23503' || /foreign key|violates/i.test(error.message ?? '');
    if (isFk) {
      const { error: archErr } = await supabase
        .from('services')
        .update({ is_active: false } as never)
        .eq('id', id);
      if (archErr)
        return { ok: false, errorKey: 'dbError', errorValues: { message: archErr.message } };
      revalidatePath('/manager');
      return { ok: true };
    }
    return { ok: false, errorKey: 'dbError', errorValues: { message: error.message } };
  }
  revalidatePath('/manager');
  return { ok: true };
}

// =============================================================================
// PRODUCTS
// =============================================================================

const ProductSchema = z.object({
  name: z.string().trim().min(1, 'nameRequired').max(80),
  sku: z.string().trim().min(1, 'skuRequired').max(40),
  priceCents: z.number().int().min(0),
  /** Prix d'achat (touche) en centimes — optionnel, 0 si absent. */
  costCents: z.number().int().min(0).optional().default(0),
  stock: z.number().int().min(0),
  low: z.number().int().min(0),
});

export type ProductInput = z.input<typeof ProductSchema>;

export async function createProduct(input: ProductInput): Promise<MutationResult> {
  const ctx = await requireTenant();
  const supabase = createAdminClient();
  const parsed = ProductSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errorKey: zodMessageToCode(parsed.error.errors[0]?.message) };
  }
  const d = parsed.data;
  const row: ProductInsert = {
    tenant_id: ctx.tenant.id,
    name: d.name,
    sku: d.sku.toUpperCase(),
    price_cents: d.priceCents,
    cost_cents: d.costCents ?? 0,
    stock: d.stock,
    low_threshold: d.low,
  };
  const { data, error } = await supabase
    .from('products')
    .insert(row as never)
    .select('id')
    .single();
  if (error) {
    if (error.message.includes('products_tenant_id_sku_key')) {
      return { ok: false, errorKey: 'skuTaken', errorValues: { sku: d.sku } };
    }
    return { ok: false, errorKey: 'dbError', errorValues: { message: error.message } };
  }
  revalidatePath('/manager');
  return { ok: true, id: (data as { id: string }).id };
}

export async function updateProduct(id: string, input: ProductInput): Promise<MutationResult> {
  await requireTenant();
  const supabase = createAdminClient();
  const parsed = ProductSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errorKey: zodMessageToCode(parsed.error.errors[0]?.message) };
  }
  const d = parsed.data;
  const { error } = await supabase
    .from('products')
    .update({
      name: d.name,
      sku: d.sku.toUpperCase(),
      price_cents: d.priceCents,
      cost_cents: d.costCents ?? 0,
      stock: d.stock,
      low_threshold: d.low,
    } as never)
    .eq('id', id);
  if (error) {
    if (error.message.includes('products_tenant_id_sku_key')) {
      return { ok: false, errorKey: 'skuTaken', errorValues: { sku: d.sku } };
    }
    return { ok: false, errorKey: 'dbError', errorValues: { message: error.message } };
  }
  revalidatePath('/manager');
  return { ok: true };
}

export async function deleteProduct(id: string): Promise<MutationResult> {
  await requireTenant();
  const supabase = createAdminClient();
  // Idem deleteService : DELETE réel, sinon ARCHIVAGE (is_active=false) si le
  // produit est référencé (sale_items / product_movements). L'historique des
  // ventes reste intact.
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) {
    const isFk =
      (error as { code?: string }).code === '23503' || /foreign key|violates/i.test(error.message ?? '');
    if (isFk) {
      const { error: archErr } = await supabase
        .from('products')
        .update({ is_active: false } as never)
        .eq('id', id);
      if (archErr)
        return { ok: false, errorKey: 'dbError', errorValues: { message: archErr.message } };
      revalidatePath('/manager');
      return { ok: true };
    }
    return { ok: false, errorKey: 'dbError', errorValues: { message: error.message } };
  }
  revalidatePath('/manager');
  return { ok: true };
}
