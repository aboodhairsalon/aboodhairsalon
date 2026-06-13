/**
 * Mock data pour l'expérience démo des 3 espaces (jalons 3-5 réels).
 * Tous les montants en centimes (integer) — cf. /docs/CLAUDE.md §ARGENT.
 *
 * Source visuelle : /docs/reference/barbershop_app.jsx (immuable).
 */
export const todayStr = () => new Date().toISOString().split('T')[0]!;
export const addDaysISO = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0]!;
};

export interface Service {
  id: string;
  name: string;
  duration: number;
  priceCents: number;
  icon: 'scissors' | 'razor' | 'crown' | 'shield' | 'star' | 'sparkle';
  desc: string;
  /** Section personnalisée (optionnelle) — null/undefined = sans section. */
  category?: string;
  /** Coiffeurs (staff.id) autorisés à réaliser cette prestation.
   *  Liste VIDE = tous les coiffeurs peuvent la faire (défaut). Sinon, seuls
   *  ces coiffeurs sont proposés à la réservation + affichés en caisse. */
  barberIds: string[];
}

export interface Product {
  id: string;
  name: string;
  /** Prix de vente en centimes. */
  priceCents: number;
  /** Prix d'achat (touche) en centimes — 0 si non renseigné. */
  costCents: number;
  stock: number;
  low: number;
  sku: string;
}

/**
 * Modèle unifié : une personne du salon = 1 entrée `Staff` avec ses rôles.
 * Cf. D-021 dans /docs/DECISIONS.md.
 *
 * Polyvalence native : Antoine peut être barbier ET caissier (`roles: ['barber','cashier']`).
 * L'UI montre 2 sections (Barbiers / Caissiers) qui sont 2 vues filtrées de cette unique liste.
 *
 * Au jalon 1 DB : table `staff` + colonne `roles staff_role[]` (Postgres array).
 */
export type StaffRole = 'barber' | 'cashier';

export interface Staff {
  id: string;
  name: string;
  initials: string;
  tone: string;
  isActive: boolean;
  phone?: string;
  email?: string;
  /** Photo de profil (data URL) — remplace l'avatar à initiales. */
  photoUrl?: string | null;
  /** Au moins 1 rôle. Une personne avec aucun rôle est supprimée. */
  roles: StaffRole[];
  /** Plage horaire si `roles` contient `'cashier'`. */
  shift?: CashierShift;
  /** Commission en basis points (4000 = 40 %). Pertinent pour les barbiers. */
  commissionBp?: number;
  /**
   * Compte de connexion Caisse lié (migration 0010 + Server Action
   * `createCashierAccess`). Renseigné pour un tenant réel uniquement :
   *  - `string`    → la personne a un accès /cashier (email + mot de passe).
   *  - `null`      → aucun accès configuré.
   *  - `undefined` → mode démo (la notion d'accès ne s'applique pas).
   */
  cashierUserId?: string | null;
  /** Section personnalisée (optionnelle) — null/undefined = sans section. */
  category?: string;
}

export const STAFF_TONES = [
  { value: '#D08C4F', label: 'Cuivre' },
  { value: '#8BAE6E', label: 'Sauge' },
  { value: '#C97D8A', label: 'Rose' },
  { value: '#7BA4B3', label: 'Pétrole' },
  { value: '#A89A7E', label: 'Sable' },
  { value: '#B85C3C', label: 'Brique' },
  { value: '#9B7BBF', label: 'Violet' },
  { value: '#C9A85E', label: 'Miel' },
] as const;

// Type "vue Barbier" — un barbier est un membre du staff avec le rôle `'barber'`
export type Barber = Staff;

// Type "vue Caissier"
export interface Cashier extends Staff {
  shift: CashierShift;
}

/**
 * Vues filtrées + projetées pour les composants existants.
 * Garantit l'invariant : un `Barber` a `'barber' ∈ roles`.
 */
export function barbersOf(staff: Staff[]): Barber[] {
  return staff.filter((s) => s.roles.includes('barber'));
}

export function cashiersOf(staff: Staff[]): Cashier[] {
  return staff
    .filter((s) => s.roles.includes('cashier'))
    .map((s) => ({ ...s, shift: s.shift ?? 'Pleine journée' }));
}

export type BookingStatus = 'upcoming' | 'in-chair' | 'done' | 'cancelled';

export interface BookingExtra {
  /** kind+id concaténés pour clé React stable */
  key: string;
  kind: 'service' | 'product';
  refId: string;
  name: string;
  priceCents: number;
  qty: number;
}

export type BookingSource =
  | 'client_app'
  | 'cashier'
  | 'walk_in'
  | 'manager'
  | 'waitlist'
  | 'widget';

export interface Booking {
  id: string;
  clientName: string;
  serviceId: string;
  barberId: string;
  date: string;
  time: string;
  status: BookingStatus;
  /** `true` si le RDV a été marqué `no_show` côté DB (le client n'est pas
   *  venu). Le mapping UI le présente comme `'cancelled'` (slot libéré)
   *  MAIS l'UI Mes RDV affiche un libellé distinct « Manqué » plutôt qu'
   *  « Annulé » qui prêtait à confusion (audit T2.6). */
  noShow?: boolean;
  paid: boolean;
  /** Montant du service de base (snapshot prix au moment du RDV) */
  amountCents: number;
  /** Suppléments ajoutés par le caissier au check-out (huile, coupe-extra, produits) */
  extras?: BookingExtra[];
  /** Provenance du RDV — `'walk_in'` distingue les passages spontanés démarrés
   *  directement en caisse (sans réservation préalable). Affiché en tag dans la
   *  section « Clients à encaisser ». */
  source?: BookingSource;
  /** Téléphone du client snapshot — exposé côté front pour permettre l'application
   *  du cashback à l'encaissement d'un RDV (PaymentModal en a besoin pour fetch
   *  le solde de fidélité). */
  clientPhone?: string;
}

/**
 * Helper : total du RDV = base + somme des extras (qty × price).
 */
export function bookingTotal(b: Booking): number {
  const extras = (b.extras ?? []).reduce((s, e) => s + e.priceCents * e.qty, 0);
  return b.amountCents + extras;
}

export type SaleMethod = 'card' | 'cash' | 'mobile';

export interface SaleItem {
  type: 'service' | 'product';
  name: string;
  priceCents: number;
  qty?: number;
  /** Coiffeur (staff.id) ayant réalisé CETTE prestation. Optionnel : les
   *  produits n'ont pas de coiffeur, et les ventes historiques non plus. */
  barberId?: string;
}

export interface Sale {
  id: string;
  date: string;
  time: string;
  items: SaleItem[];
  method: SaleMethod;
  totalCents: number;
  barberId: string;
  /** Nom du client rattaché à la vente — optionnel. */
  clientName?: string;
  /** Pourboire en centimes — tracé à part du chiffre d'affaires. */
  tipCents?: number;
  /** Vente intégralement remboursée. Reste affichée dans le log, retirée des
   *  KPIs CA. Pour un remboursement partiel, voir `refundedCents` ci-dessous :
   *  `refunded` reste `false` tant que `refundedCents < totalCents`. */
  refunded?: boolean;
  /** Horodatage ISO du dernier remboursement (partiel ou complet). */
  refundedAt?: string;
  /** Motif libre du DERNIER remboursement (saisi en caisse). En cas de
   *  refunds partiels multiples, seul le dernier motif est conservé. */
  refundReason?: string;
  /** Montant cumulé remboursé en centimes (refunds partiels empilés).
   *  - `0` : aucun remboursement.
   *  - `0 < x < totalCents` : remboursement partiel (sale.refunded === false,
   *    status DB reste `completed`). Le restant encaissable = totalCents − x.
   *  - `x === totalCents` : remboursement intégral (sale.refunded === true,
   *    status DB passe à `refunded`). */
  refundedCents?: number;
  /** Cashback débité de cette vente — déduit de totalCents (qui est NET cash).
   *  Le BRUT facturé reste accessible via `totalCents + cashbackRedeemedCents`.
   *  Utilisé par le flux refund pour recréditer proportionnellement. */
  cashbackRedeemedCents?: number;
}

export const INITIAL_SERVICES: Service[] = [
  {
    id: 's1',
    name: 'Coupe Homme',
    duration: 30,
    priceCents: 2500,
    icon: 'scissors',
    desc: 'Coupe sur-mesure, shampoing, finitions tondeuse',
    barberIds: [],
  },
  {
    id: 's2',
    name: 'Taille de Barbe',
    duration: 20,
    priceCents: 1800,
    icon: 'razor',
    desc: 'Sculpture, contour précis, huile à barbe',
    barberIds: [],
  },
  {
    id: 's3',
    name: 'Coupe + Barbe',
    duration: 45,
    priceCents: 3800,
    icon: 'crown',
    desc: 'La signature de la maison',
    barberIds: [],
  },
  {
    id: 's4',
    name: 'Rasage Royal',
    duration: 40,
    priceCents: 3500,
    icon: 'shield',
    desc: 'Serviette chaude, rasoir traditionnel',
    barberIds: [],
  },
  {
    id: 's5',
    name: 'Coupe Enfant (-12)',
    duration: 25,
    priceCents: 1800,
    icon: 'star',
    desc: 'Calme, patience, premier souvenir',
    barberIds: [],
  },
  {
    id: 's6',
    name: 'Coloration',
    duration: 60,
    priceCents: 4500,
    icon: 'sparkle',
    desc: 'Camouflage des gris, naturel garanti',
    barberIds: [],
  },
];

export const INITIAL_PRODUCTS: Product[] = [
  {
    id: 'p1',
    name: 'Pommade Mate',
    priceCents: 2200,
    costCents: 1100,
    stock: 14,
    low: 5,
    sku: 'POM-MAT',
  },
  {
    id: 'p2',
    name: 'Huile à Barbe',
    priceCents: 2800,
    costCents: 1400,
    stock: 3,
    low: 5,
    sku: 'OIL-BRD',
  },
  {
    id: 'p3',
    name: 'Shampoing Solide',
    priceCents: 1600,
    costCents: 800,
    stock: 22,
    low: 5,
    sku: 'SHP-SOL',
  },
  {
    id: 'p4',
    name: 'Cire Brillante',
    priceCents: 2400,
    costCents: 1200,
    stock: 8,
    low: 5,
    sku: 'CIR-BRI',
  },
  {
    id: 'p5',
    name: 'Peigne Bois Olivier',
    priceCents: 1800,
    costCents: 700,
    stock: 11,
    low: 3,
    sku: 'PGN-OLV',
  },
  {
    id: 'p6',
    name: 'Eau de Cologne 50ml',
    priceCents: 4200,
    costCents: 2100,
    stock: 6,
    low: 4,
    sku: 'COL-050',
  },
];

export const CASHIER_SHIFTS = [
  'Matin (09h–13h)',
  'Après-midi (14h–19h)',
  'Pleine journée',
  'Soir (16h–20h)',
  'Weekend',
] as const;
export type CashierShift = (typeof CASHIER_SHIFTS)[number];

/**
 * Équipe seed.
 * - Antoine : maître barbier, polyvalent (tient aussi la caisse le matin) → `roles: ['barber','cashier']`
 * - Karim & Léo : barbiers purs
 * - Sofia & Nadia : caissières dédiées
 *
 * Antoine en polyvalent illustre le cas le plus courant en salon indépendant.
 */
export const INITIAL_STAFF: Staff[] = [
  {
    id: 'st-1',
    name: 'Antoine',
    initials: 'A',
    tone: '#D08C4F',
    isActive: true,
    phone: '06 12 34 56 78',
    email: 'antoine@maison-lefevre.fr',
    roles: ['barber', 'cashier'],
    shift: 'Matin (09h–13h)',
    commissionBp: 4500,
  },
  {
    id: 'st-2',
    name: 'Karim',
    initials: 'K',
    tone: '#8BAE6E',
    isActive: true,
    phone: '06 23 45 67 89',
    email: 'karim@maison-lefevre.fr',
    roles: ['barber'],
    commissionBp: 4000,
  },
  {
    id: 'st-3',
    name: 'Léo',
    initials: 'L',
    tone: '#C97D8A',
    isActive: true,
    phone: '06 34 56 78 90',
    email: 'leo@maison-lefevre.fr',
    roles: ['barber'],
    commissionBp: 4000,
  },
  {
    id: 'st-4',
    name: 'Sofia',
    initials: 'S',
    tone: '#C9A85E',
    isActive: true,
    phone: '06 45 67 89 12',
    email: 'sofia@maison-lefevre.fr',
    roles: ['cashier'],
    shift: 'Pleine journée',
  },
  {
    id: 'st-5',
    name: 'Nadia',
    initials: 'N',
    tone: '#9B7BBF',
    isActive: true,
    phone: '06 56 78 90 23',
    email: 'nadia@maison-lefevre.fr',
    roles: ['cashier'],
    shift: 'Après-midi (14h–19h)',
  },
];

/**
 * localStorage key for the "barber on duty at the till".
 * Sync entre /manager Équipe et /cashier (header AppHeader).
 */
export const ACTIVE_CASHIER_KEY = 'systema:active-cashier-id';

/**
 * Profil du salon — éditable depuis /manager Paramètres, propagé via AppHeader.
 * Au jalon réel : `tenants` + `tenant_branding` + `tenant_settings` en DB.
 */
import type { Currency } from '@/lib/money';

export interface SalonProfile {
  name: string;
  /** Nom du responsable / gérant — affiché dans l'en-tête Direction. */
  managerName: string;
  tagline: string;
  logoDataUrl: string | null;
  brandPrimary: string;
  /** Devise affichée dans tout le tenant (prix, KPIs, encaissements). */
  currency: Currency;
  address: string;
  city: string;
  zip: string;
  branch: string;
  phone: string;
  email: string;
  website: string;
  instagram: string;
  hours: string;
  /** Lien Google Maps de partage (épingle exacte). Si vide, l'UI client tombe
   *  sur la recherche par adresse. */
  mapsUrl: string;
  /** Taux cashback en basis points (250 = 2,5 %). Borné [0, 1500]. */
  cashbackRateBp: number;
  /** Taux TVA en basis points (2000 = 20 %). 0 = pas de TVA affichée. Borné [0, 3000].
   *  Audit T5.25 — la colonne existait en DB mais n'était jamais lue. */
  taxRateBp: number;
  /** Adresse expéditeur emails transactionnels custom (ex. noreply@aboodhairsalon.com).
   *  Vide = fallback noreply@system-aone.com. Nécessite DNS vérifié dans Resend. */
  emailFromAddress: string;
}

export const SALON_PROFILE_KEY = 'systema:salon-profile';

export const INITIAL_SALON_PROFILE: SalonProfile = {
  name: 'Maison Lefèvre',
  managerName: '',
  tagline: 'Barbier — depuis 1947',
  logoDataUrl: null,
  brandPrimary: '#D08C4F',
  currency: 'EGP',
  address: '47 rue Oberkampf',
  city: 'Paris',
  zip: '75011',
  branch: '',
  phone: '01 43 38 12 47',
  email: 'contact@maison-lefevre.fr',
  website: 'maison-lefevre.fr',
  instagram: '@maison.lefevre',
  hours: 'Mar–Ven · 09h–19h · Sam · 09h–18h',
  mapsUrl: '',
  cashbackRateBp: 250,
  taxRateBp: 0,
  emailFromAddress: '',
};

export const INITIAL_BOOKINGS: Booking[] = [
  {
    id: 'r1',
    clientName: 'Marc Dupont',
    serviceId: 's3',
    barberId: 'st-1',
    date: todayStr(),
    time: '09:30',
    status: 'done',
    paid: true,
    amountCents: 3800,
  },
  {
    id: 'r2',
    clientName: 'Lucas Martin',
    serviceId: 's1',
    barberId: 'st-2',
    date: todayStr(),
    time: '10:30',
    status: 'done',
    paid: true,
    amountCents: 2500,
  },
  {
    id: 'r3',
    clientName: 'Hugo Bernard',
    serviceId: 's2',
    barberId: 'st-1',
    date: todayStr(),
    time: '11:00',
    status: 'in-chair',
    paid: false,
    amountCents: 1800,
  },
  {
    id: 'r4',
    clientName: 'Yanis Petit',
    serviceId: 's4',
    barberId: 'st-3',
    date: todayStr(),
    time: '14:00',
    status: 'upcoming',
    paid: false,
    amountCents: 3500,
  },
  {
    id: 'r5',
    clientName: 'Théo Robert',
    serviceId: 's3',
    barberId: 'st-1',
    date: todayStr(),
    time: '15:30',
    status: 'upcoming',
    paid: false,
    amountCents: 3800,
  },
  {
    id: 'r6',
    clientName: 'Adam Lefevre',
    serviceId: 's1',
    barberId: 'st-2',
    date: todayStr(),
    time: '17:00',
    status: 'upcoming',
    paid: false,
    amountCents: 2500,
  },
  {
    id: 'r7',
    clientName: 'Sami Garcia',
    serviceId: 's5',
    barberId: 'st-3',
    date: addDaysISO(1),
    time: '10:00',
    status: 'upcoming',
    paid: false,
    amountCents: 1800,
  },
  {
    id: 'r8',
    clientName: 'Noah Roux',
    serviceId: 's3',
    barberId: 'st-1',
    date: addDaysISO(1),
    time: '14:30',
    status: 'upcoming',
    paid: false,
    amountCents: 3800,
  },
];

export const INITIAL_SALES: Sale[] = [
  {
    id: 'sa1',
    date: todayStr(),
    time: '09:55',
    items: [{ type: 'service', name: 'Coupe + Barbe', priceCents: 3800 }],
    method: 'card',
    totalCents: 3800,
    barberId: 'st-1',
  },
  {
    id: 'sa2',
    date: todayStr(),
    time: '10:58',
    items: [
      { type: 'service', name: 'Coupe Homme', priceCents: 2500 },
      { type: 'product', name: 'Pommade Mate', priceCents: 2200 },
    ],
    method: 'card',
    totalCents: 4700,
    barberId: 'st-2',
  },
];

export const CURRENT_CLIENT = { name: 'Marc Dupont' };
