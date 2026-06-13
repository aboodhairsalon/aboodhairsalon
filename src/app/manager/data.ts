import 'server-only';
/**
 * Chargement des collections du tenant (staff, services, products) côté
 * serveur, pour le layout /manager.
 *
 * Lecture via la session du user → RLS filtre par tenant_id. Aucun risque
 * de fuite cross-tenant.
 *
 * Les rows DB (snake_case) sont projetées vers les types front (camelCase
 * + centimes) attendus par les composants existants — évite de refactorer
 * tout `/manager/page.tsx`.
 */
import { createAdminClient, type Database } from '@/db';
import type { CashierShift, Product, Service, Staff, StaffRole } from '../_data/mock';

type StaffRow = Database['public']['Tables']['staff']['Row'];
type ServiceRow = Database['public']['Tables']['services']['Row'];
type ProductRow = Database['public']['Tables']['products']['Row'];
type GalleryRow = Database['public']['Tables']['tenant_gallery']['Row'];

const SERVICE_ICONS = ['scissors', 'razor', 'crown', 'shield', 'star', 'sparkle'] as const;
type ServiceIcon = (typeof SERVICE_ICONS)[number];

function toServiceIcon(raw: string | null): ServiceIcon {
  return (SERVICE_ICONS as readonly string[]).includes(raw ?? '')
    ? (raw as ServiceIcon)
    : 'scissors';
}

export type ManagerCollections = {
  staff: Staff[];
  services: Service[];
  products: Product[];
  gallery: { id: string; photoUrl: string; caption: string | null }[];
};

/**
 * Charge staff + services + products du tenant courant.
 * `tenantId` est passé explicitement (déjà résolu par requireTenant()).
 */
export async function getManagerCollections(_tenantId: string): Promise<ManagerCollections> {
  // Admin client (pas la session) : sinon les policies RLS *_public_read ne
  // remontent QUE les lignes is_active=true → les prestations/produits
  // DÉSACTIVÉS disparaissaient de l'admin (impossible de les réactiver).
  // Symétrique du fix crud-actions.ts. requireTenant() en amont gate l'accès.
  const supabase = createAdminClient();

  const staffRes = await supabase
    .from('staff')
    .select('*')
    
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  // is_active=true uniquement : un service/produit « supprimé » avec
  // historique est archivé (is_active=false) côté deleteService/deleteProduct
  // — il ne doit plus apparaître dans l'admin (cohérent avec « supprimé »),
  // tout en restant en DB pour préserver les références RDV/ventes.
  const servicesRes = await supabase
    .from('services')
    // Embed M:N service_barbers → liste des coiffeurs autorisés par prestation.
    .select('*, service_barbers(barber_id)')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  const productsRes = await supabase
    .from('products')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  const galleryRes = await supabase
    .from('tenant_gallery')
    .select('id, photo_url, caption, sort_order')
    
    .order('sort_order', { ascending: true });

  const staff: Staff[] = ((staffRes.data as StaffRow[] | null) ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    initials: r.initials,
    tone: r.tone,
    isActive: r.is_active,
    phone: r.phone ?? undefined,
    email: r.email ?? undefined,
    photoUrl: r.photo_url ?? null,
    roles: (r.roles as StaffRole[] | null) ?? ['barber'],
    // `shift` est stocké en text libre côté DB ; on le projette vers le type
    // CashierShift (les valeurs écrites proviennent toujours du selecteur UI).
    shift: (r.shift as CashierShift | null) ?? undefined,
    commissionBp: r.commission_bp ?? undefined,
    // Compte de connexion Caisse lié (null = aucun accès configuré).
    cashierUserId: r.user_id ?? null,
    category: r.category ?? undefined,
  }));

  const services: Service[] = (
    (servicesRes.data as (ServiceRow & { service_barbers?: { barber_id: string }[] })[] | null) ??
    []
  ).map((r) => ({
    id: r.id,
    name: r.name,
    duration: r.duration_min,
    priceCents: r.price_cents,
    icon: toServiceIcon(r.icon),
    desc: r.description ?? '',
    category: r.category ?? undefined,
    barberIds: (r.service_barbers ?? []).map((sb) => sb.barber_id),
  }));

  const products: Product[] = ((productsRes.data as ProductRow[] | null) ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    priceCents: r.price_cents,
    costCents: r.cost_cents ?? 0,
    stock: r.stock,
    low: r.low_threshold,
    sku: r.sku,
  }));

  const gallery = (
    (galleryRes.data as Pick<GalleryRow, 'id' | 'photo_url' | 'caption' | 'sort_order'>[] | null) ??
    []
  ).map((r) => ({
    id: r.id,
    photoUrl: r.photo_url,
    caption: r.caption,
  }));

  return { staff, services, products, gallery };
}
