import { z } from 'zod';
import { cents } from './index';

const uuid = z.string().uuid();

export const ServiceSchema = z.object({
  id: uuid,
  name: z.string().min(1).max(80),
  description: z.string().nullable(),
  duration_min: z.number().int().min(5).max(480),
  price_cents: cents,
  icon: z.string(),
  category: z.string().nullable(),
  is_active: z.boolean(),
  requires_deposit: z.boolean(),
  sort_order: z.number().int().nonnegative(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Service = z.infer<typeof ServiceSchema>;

export const ProductSchema = z.object({
  id: uuid,
  sku: z.string().min(1).max(48),
  name: z.string().min(1).max(80),
  description: z.string().nullable(),
  price_cents: cents,
  cost_cents: cents.nullable(),
  stock: z.number().int().nonnegative(),
  low_threshold: z.number().int().nonnegative(),
  is_active: z.boolean(),
  image_url: z.string().url().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Product = z.infer<typeof ProductSchema>;
