/**
 * Route publique GET /client/booking/{id}/ics
 *
 * Sert un fichier iCalendar (VEVENT) pour qu'un client puisse ajouter son
 * RDV à son calendrier (Apple Calendar, Google Calendar, Outlook…). Format
 * iCalendar RFC 5545.
 *
 * Sécurité : pas d'authentification — un fichier .ics ne fuite que les infos
 * que le client connaît déjà (sa propre réservation). En single-tenant, il
 * n'y a plus de risque d'enumeration cross-tenant : tous les bookings
 * appartiennent au même salon.
 *
 * Headers :
 *  - Content-Type: text/calendar (déclenche l'ouverture native iOS/Android)
 *  - Content-Disposition: attachment → force le download sur desktop
 *  - Cache-Control: no-store (les annulations doivent invalider la copie)
 */
import { SALON } from '@/config/salon';
import { createAdminClient } from '@/db';

export const dynamic = 'force-dynamic';

/** Échappe les caractères spéciaux selon RFC 5545 (virgule, point-virgule,
 *  newline, backslash). */
function escapeIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

/** Formate un Date en YYYYMMDDTHHMMSSZ (UTC, format iCalendar). */
function toIcsDateUtc(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}` +
    `${pad(d.getUTCMonth() + 1)}` +
    `${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}` +
    `${pad(d.getUTCMinutes())}` +
    `${pad(d.getUTCSeconds())}Z`
  );
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: bookingId } = await context.params;
  const tenantName = SALON.name;

  // Validation basique du UUID (defense contre injection / path traversal).
  if (!bookingId || !/^[0-9a-f-]{36}$/i.test(bookingId)) {
    return new Response('Invalid booking id', { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Joins booking + service + barber pour avoir tous les libellés.
  const bookingRes = await admin
    .from('bookings')
    .select(
      'id, starts_at, ends_at, status, client_display_name, services(name), staff(name)',
    )
    .eq('id', bookingId)
    .maybeSingle();

  if (bookingRes.error || !bookingRes.data) {
    return new Response('Booking not found', { status: 404 });
  }
  const booking = bookingRes.data as {
    id: string;
    starts_at: string;
    ends_at: string;
    status: string;
    client_display_name: string | null;
    services: { name: string } | null;
    staff: { name: string } | null;
  };

  if (booking.status === 'cancelled') {
    // RFC 5545 : on peut servir un VEVENT avec STATUS:CANCELLED pour que
    // le calendrier supprime automatiquement l'event s'il était déjà importé.
  }

  const startUtc = new Date(booking.starts_at);
  const endUtc = new Date(booking.ends_at);
  const nowUtc = new Date();
  const serviceName = booking.services?.name ?? 'Rendez-vous';
  const barberName = booking.staff?.name ?? '';

  const summary = `${serviceName} · ${tenantName}`;
  const descriptionParts = [
    `Salon : ${tenantName}`,
    barberName ? `Barbier : ${barberName}` : '',
    booking.client_display_name ? `Au nom de : ${booking.client_display_name}` : '',
  ].filter(Boolean);
  const description = descriptionParts.join('\n');
  const location = SALON.slug;

  // VCALENDAR / VEVENT minimal RFC 5545. PRODID identifie le salon.
  // UID = booking.id pour qu'un re-import fasse un update et pas un duplicate.
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${tenantName}//Client Booking//FR`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${booking.id}@${SALON.slug}`,
    `DTSTAMP:${toIcsDateUtc(nowUtc)}`,
    `DTSTART:${toIcsDateUtc(startUtc)}`,
    `DTEND:${toIcsDateUtc(endUtc)}`,
    `SUMMARY:${escapeIcs(summary)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    `LOCATION:${escapeIcs(location)}`,
    `STATUS:${booking.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    // Reminder 1h avant — un des arguments de vente du calendrier vs SMS.
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT1H',
    `DESCRIPTION:${escapeIcs(summary)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  const ics = lines.join('\r\n') + '\r\n';

  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="rdv-${booking.id.slice(0, 8)}.ics"`,
      'Cache-Control': 'no-store',
    },
  });
}
