import { z } from 'zod';
import { cents, slug } from './index';
import { TenantPlan, TenantStatus } from './enums';

const uuid = z.string().uuid();
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'expected hex color like #D08C4F');

export const TenantSchema = z.object({
  id: uuid,
  slug,
  name: z.string().min(1).max(80),
  plan: TenantPlan,
  status: TenantStatus,
  trial_ends_at: z.string().datetime().nullable(),
  currency: z.string().length(3),
  timezone: z.string(),
  locale: z.string(),
  stripe_customer_id: z.string().nullable(),
  stripe_subscription_id: z.string().nullable(),
  stripe_connect_account_id: z.string().nullable(),
  stripe_connect_status: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Tenant = z.infer<typeof TenantSchema>;

export const TenantBrandingSchema = z.object({
  id: uuid,
  logo_url: z.string().url().nullable(),
  favicon_url: z.string().url().nullable(),
  brand_primary: hex,
  brand_glow: hex,
  brand_deep: hex,
  custom_domain: z.string().nullable(),
  custom_domain_verified_at: z.string().datetime().nullable(),
  footer_signature_enabled: z.boolean(),
  font_display: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type TenantBranding = z.infer<typeof TenantBrandingSchema>;

export const DepositPolicySchema = z.object({
  enabled: z.boolean(),
  amount_cents: cents,
  percent: z.number().int().min(0).max(100),
});
export type DepositPolicy = z.infer<typeof DepositPolicySchema>;

export const CancellationPolicySchema = z.object({
  min_hours: z.number().int().min(0).max(168),
  fee_cents: cents,
});
export type CancellationPolicy = z.infer<typeof CancellationPolicySchema>;

export const BusinessHourSchema = z.object({
  dow: z.number().int().min(0).max(6),
  open: z.string().regex(/^\d{2}:\d{2}$/),
  close: z.string().regex(/^\d{2}:\d{2}$/),
});
export type BusinessHour = z.infer<typeof BusinessHourSchema>;

export const HolidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string(),
});
export type Holiday = z.infer<typeof HolidaySchema>;

export const TenantSettingsSchema = z.object({
  id: uuid,
  tax_rate_bp: z.number().int().min(0).max(10000),
  legal_name: z.string().nullable(),
  legal_address: z.string().nullable(),
  legal_siret: z.string().nullable(),
  legal_tva_number: z.string().nullable(),
  deposit_policy: DepositPolicySchema,
  cancellation_policy: CancellationPolicySchema,
  business_hours: z.array(BusinessHourSchema),
  holidays: z.array(HolidaySchema),
  sms_enabled: z.boolean(),
  loyalty_enabled: z.boolean(),
  loyalty_ratio: z.number().int().positive(),
  loyalty_redeem_threshold: z.number().int().positive(),
  reminder_sms_hours: z.number().int().nonnegative(),
  reminder_email_hours: z.number().int().nonnegative(),
  cleanup_minutes: z.number().int().min(0).max(60),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type TenantSettings = z.infer<typeof TenantSettingsSchema>;
