import { z } from 'zod';
import { email, phone } from './index';
import { BarberRole } from './enums';

const uuid = z.string().uuid();
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const ProfileSchema = z.object({
  id: uuid,
  email,
  full_name: z.string().nullable(),
  phone: phone.nullable(),
  avatar_url: z.string().url().nullable(),
  locale: z.string(),
  marketing_opt_in: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const BarberSchema = z.object({
  id: uuid,
  location_id: uuid.nullable(),
  profile_id: uuid.nullable(),
  display_name: z.string().min(1).max(80),
  initials: z.string().min(1).max(3),
  tone: hex,
  role: BarberRole,
  bio: z.string().nullable(),
  photo_url: z.string().url().nullable(),
  commission_bp: z.number().int().min(0).max(10000),
  is_active: z.boolean(),
  sort_order: z.number().int().nonnegative(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Barber = z.infer<typeof BarberSchema>;

export const ClientSchema = z.object({
  id: uuid,
  profile_id: uuid.nullable(),
  display_name: z.string().min(1).max(80),
  phone: phone.nullable(),
  email: email.nullable(),
  notes: z.string().nullable(),
  tags: z.array(z.string()),
  total_spent_cents: z.number().int().nonnegative(),
  visits_count: z.number().int().nonnegative(),
  loyalty_points: z.number().int().nonnegative(),
  reliability_score: z.number().int().min(0).max(100),
  banned: z.boolean(),
  first_seen_at: z.string().datetime(),
  last_seen_at: z.string().datetime(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Client = z.infer<typeof ClientSchema>;
