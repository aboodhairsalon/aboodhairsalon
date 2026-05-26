/**
 * Re-exports des composants UI primitifs partagés.
 *
 * Garde la même surface API que l'ancien `@/components` pour minimiser le diff
 * sur les imports lors du découplage. Le helper `cn` est ré-exporté depuis
 * `@/lib/utils/cn` (rangé en lib/ pour rester technologiquement neutre).
 */
export { cn } from '@/lib/utils/cn';
export { Tag } from './Tag';
export { Btn, BtnLink } from './Btn';
export { Card } from './Card';
export { Divider } from './Divider';
export { StripeBar } from './StripeBar';
export { Modal } from './Modal';
export { Input } from './Input';
