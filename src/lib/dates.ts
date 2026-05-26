import { format, parseISO } from 'date-fns';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';

export const DEFAULT_TIMEZONE = 'Europe/Paris';

/**
 * Convert a UTC ISO string into a Date in the tenant timezone.
 * Always use this instead of `new Date(isoString)` for tenant-facing logic.
 */
export function toTenantTime(iso: string, timezone: string = DEFAULT_TIMEZONE): Date {
  return toZonedTime(parseISO(iso), timezone);
}

/**
 * Format a UTC ISO string in the tenant timezone with a date-fns format string.
 */
export function fmtTenantDate(
  iso: string,
  fmt: string,
  timezone: string = DEFAULT_TIMEZONE,
): string {
  return formatInTimeZone(parseISO(iso), timezone, fmt);
}

/**
 * Format today's date as YYYY-MM-DD in the tenant timezone.
 */
export function todayInTenant(timezone: string = DEFAULT_TIMEZONE): string {
  return formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd');
}

export { format, parseISO };
