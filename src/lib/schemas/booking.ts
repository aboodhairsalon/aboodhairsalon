import { z } from 'zod';
import { cents, email, phone } from './index';
import { BookingSource, BookingStatus } from './enums';

const uuid = z.string().uuid();

export const BookingSchema = z.object({
  id: uuid,
  location_id: uuid.nullable(),
  service_id: uuid,
  barber_id: uuid,
  client_id: uuid.nullable(),
  client_display_name: z.string().min(1),
  client_phone: phone.nullable(),
  client_email: email.nullable(),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  status: BookingStatus,
  source: BookingSource,
  amount_cents: cents,
  deposit_cents: cents,
  paid: z.boolean(),
  payment_intent_id: z.string().nullable(),
  cancellation_reason: z.string().nullable(),
  notes: z.string().nullable(),
  reminder_sent_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Booking = z.infer<typeof BookingSchema>;

/** Payload accepté côté Server Action pour créer un booking. */
export const CreateBookingInputSchema = BookingSchema.pick({
  service_id: true,
  barber_id: true,
  starts_at: true,
  client_display_name: true,
  client_phone: true,
  client_email: true,
  notes: true,
}).extend({
  client_id: uuid.optional(),
});
export type CreateBookingInput = z.infer<typeof CreateBookingInputSchema>;
