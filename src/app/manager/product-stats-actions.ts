'use server';
/**
 * Server Actions — statistiques de performance des produits.
 *
 * Agrège les lignes `sale_items` du tenant (uniquement les ventes
 * `completed`, sinon une vente remboursée gonflerait artificiellement les
 * tops vendeurs) et croise avec `products` pour le coût d'achat → marge en
 * % et marge en valeur.
 *
 * Fenêtre par défaut : 30 jours, mais l'appelant peut passer un offset
 * différent (ex. dashboard Direction qui affiche "ce mois" / "ce trimestre").
 *
 * Bypass RLS via admin client — re-gardé par `requireTenant()` pour qu'aucun
 * tenantId arbitraire ne fasse fuiter les chiffres d'un autre salon.
 */
import { createAdminClient } from '@/db';
import { requireTenant } from '../_data/auth-server';
import { rlManagerRead } from '../_lib/rate-limit';
import type { ManagerErrorCode, ManagerErrorValues } from './actions';

export type ProductStatRow = {
  productId: string | null; // null = produit supprimé entre temps
  name: string;
  sku: string | null;
  qtySold: number;
  revenueCents: number;
  costCents: number;
  /** Marge en valeur = revenue - cost ; peut être négative si prix vente < cost. */
  marginCents: number;
  /** Marge en pourcentage du CA (0–100, arrondi entier). Null si CA = 0. */
  marginPct: number | null;
};

export type GetProductStatsResult =
  | { ok: true; rows: ProductStatRow[]; periodDays: number }
  | { ok: false; errorKey: ManagerErrorCode; errorValues?: ManagerErrorValues };

/**
 * Charge les stats produit du tenant sur les `periodDays` derniers jours.
 *
 * @param tenantId   — UUID du tenant (revérifié contre la session).
 * @param periodDays — Fenêtre glissante en jours (défaut 30).
 */
export async function getProductStats(
  tenantId: string,
  periodDays = 30,
): Promise<GetProductStatsResult> {
  if (!tenantId) return { ok: false, errorKey: 'tenantMissing' };
  const ctx = await requireTenant();
  if (ctx.tenant.id !== tenantId) {
    return { ok: false, errorKey: 'tenantNotAuthorized' };
  }
  // Rate-limit lecture manager (audit T4.2).
  if (!(await rlManagerRead(ctx.user.id))) {
    return { ok: false, errorKey: 'dbError', errorValues: { message: 'rate_limited' } };
  }
  const days = Math.max(1, Math.min(365, Math.round(periodDays)));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Borne inférieure : minuit (UTC) il y a `days - 1` jours.
  const now = new Date();
  const windowStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)),
  ).toISOString();

  // 1. D'abord, lister les sales completed dans la fenêtre — c'est le filtre
  //    sélectif qui réduit la cardinalité (vs charger TOUS les sale_items
  //    historiques puis filtrer côté JS, qui faisait timeout/mémoire sur
  //    les gros tenants — bug DoS identifié par l'audit).
  const salesRes = await admin
    .from('sales')
    .select('id')
    
    .eq('status', 'completed')
    .gte('created_at', windowStart);

  if (salesRes.error) {
    return {
      ok: false,
      errorKey: 'dbError',
      errorValues: { message: (salesRes.error as { message?: string }).message ?? '' },
    };
  }
  const saleIds = ((salesRes.data as { id: string }[]) ?? []).map((r) => r.id);
  if (saleIds.length === 0) {
    return { ok: true, rows: [], periodDays: days };
  }

  // 2. Charger sale_items + catalogue produits en parallèle.
  //    `in('sale_id', saleIds)` borne strictement le volume — pas de scan
  //    full-table contrairement à la précédente requête joint.
  const [itemsRes, productsRes] = await Promise.all([
    admin
      .from('sale_items')
      .select('product_id, name, qty, unit_price_cents, total_cents, sale_id')
      
      .eq('kind', 'product')
      .in('sale_id', saleIds),
    admin.from('products').select('id, name, sku, cost_cents'),
  ]);

  if (itemsRes.error) {
    return {
      ok: false,
      errorKey: 'dbError',
      errorValues: { message: (itemsRes.error as { message?: string }).message ?? '' },
    };
  }
  if (productsRes.error) {
    return {
      ok: false,
      errorKey: 'dbError',
      errorValues: { message: (productsRes.error as { message?: string }).message ?? '' },
    };
  }

  type ProductRow = { id: string; name: string; sku: string | null; cost_cents: number | null };
  const productById = new Map<string, ProductRow>();
  for (const p of (productsRes.data as ProductRow[]) ?? []) productById.set(p.id, p);

  type ItemRow = {
    product_id: string | null;
    name: string;
    qty: number | null;
    unit_price_cents: number | null;
    total_cents: number | null;
    sale_id: string;
  };

  // 3. Agrégation par product_id (ou name si product_id orphelin).
  //    Plus de filtre côté JS sur le statut/date — les sale_ids viennent
  //    déjà du SELECT filtré ligne 67-71.
  type Bucket = {
    productId: string | null;
    name: string;
    sku: string | null;
    cost: number;
    qty: number;
    revenue: number;
  };
  const buckets = new Map<string, Bucket>();

  for (const it of (itemsRes.data as ItemRow[]) ?? []) {
    const pid = it.product_id;
    const ref: ProductRow | undefined = pid ? productById.get(pid) : undefined;
    const key = pid ?? `__orphan_${it.name}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.qty += it.qty ?? 0;
      existing.revenue += it.total_cents ?? 0;
    } else {
      buckets.set(key, {
        productId: pid,
        name: ref?.name ?? it.name,
        sku: ref?.sku ?? null,
        cost: ref?.cost_cents ?? 0,
        qty: it.qty ?? 0,
        revenue: it.total_cents ?? 0,
      });
    }
  }

  // 3. Calcul marge + tri par CA décroissant.
  const rows: ProductStatRow[] = Array.from(buckets.values())
    .map((b) => {
      const totalCost = b.cost * b.qty;
      const margin = b.revenue - totalCost;
      const marginPct = b.revenue > 0 ? Math.round((margin / b.revenue) * 100) : null;
      return {
        productId: b.productId,
        name: b.name,
        sku: b.sku,
        qtySold: b.qty,
        revenueCents: b.revenue,
        costCents: totalCost,
        marginCents: margin,
        marginPct,
      };
    })
    .sort((a, b) => b.revenueCents - a.revenueCents);

  return { ok: true, rows, periodDays: days };
}
