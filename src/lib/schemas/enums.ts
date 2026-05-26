import { z } from 'zod';

/**
 * Enum constants — mirror les PostgreSQL types du fichier migrations.
 * Toute valeur ajoutée ici doit l'être en parallèle en SQL.
 */
export const TENANT_PLAN = ['starter', 'pro', 'business'] as const;
export const TENANT_STATUS = ['trial', 'active', 'past_due', 'canceled', 'suspended'] as const;
export const BARBER_ROLE = ['apprentice', 'barber', 'senior', 'master'] as const;
export const TIME_OFF_KIND = ['vacation', 'sick', 'training', 'unpaid', 'other'] as const;
export const PRODUCT_MOVEMENT_KIND = ['sale', 'restock', 'adjustment', 'loss', 'return'] as const;
export const BOOKING_STATUS = ['upcoming', 'in_chair', 'done', 'cancelled', 'no_show'] as const;
export const BOOKING_SOURCE = [
  'client_app',
  'cashier',
  'walk_in',
  'manager',
  'waitlist',
  'widget',
] as const;
export const SALE_METHOD = ['card', 'cash', 'mobile', 'gift_card', 'split', 'comp'] as const;
export const SALE_STATUS = ['pending', 'completed', 'refunded', 'voided'] as const;
export const SALE_ITEM_KIND = ['service', 'product', 'discount', 'gift_card_redeem'] as const;
export const CLIENT_LINK_STATUS = ['active', 'banned', 'opted_out'] as const;
export const GIFT_CARD_STATUS = ['active', 'redeemed', 'expired', 'voided'] as const;
export const LOYALTY_EVENT_KIND = ['earned', 'redeemed', 'adjusted', 'expired'] as const;

export const TenantPlan = z.enum(TENANT_PLAN);
export const TenantStatus = z.enum(TENANT_STATUS);
export const BarberRole = z.enum(BARBER_ROLE);
export const TimeOffKind = z.enum(TIME_OFF_KIND);
export const ProductMovementKind = z.enum(PRODUCT_MOVEMENT_KIND);
export const BookingStatus = z.enum(BOOKING_STATUS);
export const BookingSource = z.enum(BOOKING_SOURCE);
export const SaleMethod = z.enum(SALE_METHOD);
export const SaleStatus = z.enum(SALE_STATUS);
export const SaleItemKind = z.enum(SALE_ITEM_KIND);
export const ClientLinkStatus = z.enum(CLIENT_LINK_STATUS);
export const GiftCardStatus = z.enum(GIFT_CARD_STATUS);
export const LoyaltyEventKind = z.enum(LOYALTY_EVENT_KIND);

export type TenantPlan = z.infer<typeof TenantPlan>;
export type TenantStatus = z.infer<typeof TenantStatus>;
export type BookingStatus = z.infer<typeof BookingStatus>;
export type BookingSource = z.infer<typeof BookingSource>;
export type SaleMethod = z.infer<typeof SaleMethod>;
export type SaleStatus = z.infer<typeof SaleStatus>;
export type SaleItemKind = z.infer<typeof SaleItemKind>;
export type BarberRole = z.infer<typeof BarberRole>;
