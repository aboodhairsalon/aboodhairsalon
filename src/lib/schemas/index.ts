/**
 * Zod schemas partagés front/back.
 * Les schémas métier (Tenant, Booking, Sale, etc.) seront ajoutés au jalon 1
 * en miroir des migrations Supabase.
 */
import { z } from 'zod';

export { z };

export const cents = z.number().int().nonnegative();
export const slug = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9](-?[a-z0-9])*$/, 'slug must be lowercase alphanumeric with dashes');

export const email = z.string().email();
export const phone = z.string().regex(/^\+?[0-9 .()-]{6,}$/, 'invalid phone number');

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
export const isoTime = z.string().regex(/^\d{2}:\d{2}$/, 'expected HH:mm');

export * from './enums';
export * from './tenant';
export * from './people';
export * from './catalog';
export * from './booking';
export * from './sales';
