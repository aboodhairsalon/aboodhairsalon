export type Currency = 'EUR' | 'USD' | 'GBP' | 'CHF' | 'EGP' | 'MAD' | 'TND' | 'AED';

const LOCALES: Record<Currency, string> = {
  EUR: 'fr-FR',
  USD: 'en-US',
  GBP: 'en-GB',
  CHF: 'de-CH',
  EGP: 'fr-FR', // français + symbole EGP (livre égyptienne)
  MAD: 'fr-MA',
  TND: 'fr-TN',
  AED: 'ar-AE',
};

export interface CurrencyMeta {
  code: Currency;
  label: string;
  symbol: string;
}

export const CURRENCIES: CurrencyMeta[] = [
  { code: 'EGP', label: 'Livre égyptienne', symbol: '£E' },
  { code: 'EUR', label: 'Euro', symbol: '€' },
  { code: 'USD', label: 'Dollar US', symbol: '$' },
  { code: 'GBP', label: 'Livre sterling', symbol: '£' },
  { code: 'CHF', label: 'Franc suisse', symbol: 'CHF' },
  { code: 'MAD', label: 'Dirham marocain', symbol: 'DH' },
  { code: 'TND', label: 'Dinar tunisien', symbol: 'DT' },
  { code: 'AED', label: 'Dirham émirati', symbol: 'AED' },
];

/**
 * Format an integer amount of cents into a localized currency string.
 * Tous les montants sont stockés en centimes (integer) — voir CLAUDE.md §ARGENT.
 *
 * Le paramètre `localeOverride` (optionnel) permet de respecter la langue
 * choisie par l'utilisateur côté UI (next-intl) plutôt que la locale
 * historique attachée à la devise. Cas typique : un salon en EGP avec un
 * client qui a basculé en `ar` → on veut « ٢٥٫٩٩ ج.م.‏ » et non
 * « 25,99 EGP » format fr-FR. Audit T5.6.
 *
 * @example fmtMoney(2599, 'EUR') // "25,99 €"
 * @example fmtMoney(2599, 'EGP') // "25,99 EGP" (locale dérivée de la devise)
 * @example fmtMoney(2599, 'EGP', 'en-EG') // "EGP 25.99"
 * @example fmtMoney(2599, 'EGP', 'ar-EG') // "٢٥٫٩٩ ج.م.‏"
 */
export function fmtMoney(
  cents: number,
  currency: Currency = 'EUR',
  localeOverride?: string,
): string {
  const locale = localeOverride ?? LOCALES[currency];
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Parse a user-typed money string into cents. Accepts "12,34", "12.34", "12", "12 €".
 * Throws on invalid input.
 */
export function parseMoneyToCents(input: string): number {
  const cleaned = input.replace(/[^\d,.-]/g, '').replace(',', '.');
  const value = Number.parseFloat(cleaned);
  if (Number.isNaN(value)) {
    throw new Error(`Invalid money input: "${input}"`);
  }
  return Math.round(value * 100);
}
