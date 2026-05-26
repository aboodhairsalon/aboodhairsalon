import { z } from 'zod';
import { cents } from './index';
import { SaleItemKind, SaleMethod, SaleStatus } from './enums';

const uuid = z.string().uuid();

export const SaleSchema = z
  .object({
    id: uuid,
    location_id: uuid.nullable(),
    barber_id: uuid.nullable(),
    cashier_id: uuid.nullable(),
    client_id: uuid.nullable(),
    booking_id: uuid.nullable(),
    offline_client_id: uuid.nullable(),
    status: SaleStatus,
    method: SaleMethod,
    subtotal_cents: cents,
    discount_cents: cents,
    tax_cents: cents,
    tip_cents: cents,
    total_cents: cents,
    payment_intent_id: z.string().nullable(),
    receipt_email_sent: z.boolean(),
    notes: z.string().nullable(),
    created_at: z.string().datetime(),
    completed_at: z.string().datetime().nullable(),
    updated_at: z.string().datetime(),
  })
  .refine(
    (s) => s.total_cents === s.subtotal_cents - s.discount_cents + s.tax_cents + s.tip_cents,
    {
      message: 'total_cents must equal subtotal − discount + tax + tip',
      path: ['total_cents'],
    },
  );
export type Sale = z.infer<typeof SaleSchema>;

export const SaleItemSchema = z.object({
  id: uuid,
  sale_id: uuid,
  kind: SaleItemKind,
  service_id: uuid.nullable(),
  product_id: uuid.nullable(),
  name: z.string().min(1),
  qty: z.number().int().positive(),
  unit_price_cents: z.number().int(), // signé : remise = négatif
  total_cents: z.number().int(),
  created_at: z.string().datetime(),
});
export type SaleItem = z.infer<typeof SaleItemSchema>;
