import 'server-only';
/**
 * Hachage de mot de passe client — `crypto.scrypt` (Node intégré).
 *
 * Pourquoi scrypt et pas une lib externe (bcrypt/argon2) :
 *  - Intégré à Node → zéro dépendance, zéro build natif (sûr sur Vercel).
 *  - Memory-hard, recommandé pour le hachage de mots de passe (OWASP).
 *  - Même module `crypto` que la signature des tokens — cohérent.
 *
 * Format stocké : `scrypt$<saltHex>$<hashHex>`. Le sel (16 octets aléatoires)
 * est unique par mot de passe ; le hash dérivé fait 64 octets. La comparaison
 * est constant-time (timingSafeEqual) pour ne pas leaker via le timing.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEYLEN = 64;
const SALT_BYTES = 16;

/** Hache un mot de passe en clair → chaîne stockable `scrypt$salt$hash`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES).toString('hex');
  const derived = await scrypt(password, salt, KEYLEN);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

/** Vérifie un mot de passe en clair contre un hash stocké. Constant-time. */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = parts[1]!;
  const expectedHex = parts[2]!;
  let expected: Buffer;
  try {
    expected = Buffer.from(expectedHex, 'hex');
  } catch {
    return false;
  }
  const derived = await scrypt(password, salt, KEYLEN);
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

/** Politique de mot de passe minimale (≥ 8 caractères). Renvoie true si OK. */
export function isPasswordStrongEnough(password: string): boolean {
  return typeof password === 'string' && password.length >= 8;
}
