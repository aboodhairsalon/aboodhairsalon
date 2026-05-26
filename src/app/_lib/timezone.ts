/**
 * Helpers timezone — encode/decode des dates entre l'heure salon locale et UTC.
 *
 * Problème adressé : le schéma stocke les RDV en UTC (`timestamptz`), mais
 * l'UI les compose à partir d'une date locale (`YYYY-MM-DD`) + heure locale
 * (`HH:mm`) saisies par le client dans le timezone du salon. Avant ce module,
 * on faisait `new Date(\`${date}T${time}:00.000Z\`)` qui interprétait la
 * saisie comme UTC → un client qui réservait à 14h voyait en réalité 14h
 * UTC = 16h Le Caire pour Aboodhairsalon. La contrainte d'overlap testait
 * le mauvais créneau.
 *
 * Fix : convertir explicitement en utilisant le `tenants.timezone`
 * (IANA, ex. "Africa/Cairo", "Europe/Paris"). Les fonctions ci-dessous
 * marchent sur Edge runtime (Intl + DateTimeFormat partout supportés).
 *
 * Limitations connues :
 *  - Les transitions DST sont gérées par l'API Intl (correct).
 *  - Les dates ambiguës (DST fall-back, 1h locale qui existe deux fois)
 *    matchent la première occurrence — comportement Intl standard.
 */

/** Liste TZ par défaut si tenants.timezone est null. UTC évite les surprises. */
const DEFAULT_TZ = 'UTC';

/** Récupère l'offset (en minutes) du timezone par rapport à UTC pour une
 *  date donnée. Positif = à l'est de UTC (Le Caire +120, Paris +60).
 *
 *  Algorithme : on demande à Intl de formater une date connue dans le TZ
 *  cible, on parse les composants, puis on calcule la différence. Fastidieux
 *  mais c'est la seule façon edge-compatible sans dépendance externe. */
function getTimezoneOffsetMinutes(tz: string, utcMs: number): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = dtf.formatToParts(new Date(utcMs));
    const getPart = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((p) => p.type === type)?.value ?? 0);
    const y = getPart('year');
    const mo = getPart('month');
    const d = getPart('day');
    let h = getPart('hour');
    if (h === 24) h = 0; // Intl peut renvoyer 24:00 selon implémentation
    const mi = getPart('minute');
    const s = getPart('second');
    // Date.UTC nous donne l'instant UTC de la wall-clock locale
    const wallClockUtc = Date.UTC(y, mo - 1, d, h, mi, s);
    return (wallClockUtc - utcMs) / 60000;
  } catch {
    return 0;
  }
}

/**
 * Convertit `(date YYYY-MM-DD, time HH:mm, tz IANA)` en ISO UTC.
 *
 * Ex. `zonedToUtcIso('2026-05-23', '14:00', 'Africa/Cairo')`
 *     → `'2026-05-23T11:00:00.000Z'` (Cairo = UTC+3 fixed, pas de DST)
 */
export function zonedToUtcIso(date: string, time: string, tz: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  if (!y || !m || !d || h === undefined || mi === undefined) {
    // Garde-fou : on retombe sur l'interprétation UTC stricte si le format est
    // invalide. L'appelant aurait dû valider avant — mais on évite de crasher.
    return new Date(`${date}T${time}:00.000Z`).toISOString();
  }
  // Première approximation : on suppose UTC = wall clock, puis on corrige.
  const naiveUtc = Date.UTC(y, m - 1, d, h, mi, 0);
  const offsetMin = getTimezoneOffsetMinutes(tz || DEFAULT_TZ, naiveUtc);
  // Si offset = +180 (Le Caire), l'heure 14h locale est 14h - 3h = 11h UTC.
  const utcMs = naiveUtc - offsetMin * 60000;
  return new Date(utcMs).toISOString();
}

/** Inverse : extrait `(date locale, heure locale)` depuis un timestamp UTC. */
export function utcIsoToZonedParts(utcIso: string, tz: string): { date: string; time: string } {
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  try {
    const dtf = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || DEFAULT_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = dtf.formatToParts(d);
    const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
    return {
      date: `${get('year')}-${get('month')}-${get('day')}`,
      time: `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`,
    };
  } catch {
    return {
      date: d.toISOString().split('T')[0] ?? '',
      time: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`,
    };
  }
}

/** Formatte une date longue dans le TZ + locale fournis (ex. pour PDF/email). */
export function formatDateLong(utcIso: string, bcp47: string, tz: string): string {
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) return utcIso;
  return new Intl.DateTimeFormat(bcp47, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: tz || DEFAULT_TZ,
  }).format(d);
}

/** Convertit `tenants.locale` (ex. 'fr-FR') en TZ par défaut acceptable
 *  quand `tenants.timezone` est NULL. Pas une vraie inférence — juste un
 *  fallback raisonnable basé sur la langue. */
export function fallbackTimezoneFromLocale(locale?: string | null): string {
  if (!locale) return DEFAULT_TZ;
  const head = locale.toLowerCase().slice(0, 2);
  if (head === 'ar') return 'Africa/Cairo';
  if (head === 'fr') return 'Europe/Paris';
  return DEFAULT_TZ;
}
