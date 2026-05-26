/**
 * Templates emails Resend / React Email.
 *
 * Chaque template exporte un composant React qui peut être rendu en HTML
 * via `@react-email/render` puis envoyé via le SDK Resend depuis l'app
 * appelante. Aucune logique d'envoi ici — le package est pur templates.
 */
export { ReceiptEmail } from './templates/Receipt';
export type { ReceiptEmailProps, ReceiptEmailItem } from './templates/Receipt';
