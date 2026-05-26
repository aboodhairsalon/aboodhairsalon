/**
 * StaffPhoto — avatar partagé d'un membre du staff.
 *
 * Présentationnel pur (pas de state, pas de `'use client'`) : il rend soit la
 * photo de profil (data URL), soit le cercle à initiales teinté.
 *
 * Le `className` porte la taille + la taille de texte (ex. `h-12 w-12 text-base`)
 * — il est appliqué aussi bien à l'image qu'au cercle de repli.
 */
import Image from 'next/image';

export function StaffPhoto({
  photoUrl,
  initials,
  tone,
  className = 'h-12 w-12 text-base',
}: {
  photoUrl?: string | null;
  initials: string;
  tone: string;
  className?: string;
}) {
  if (photoUrl) {
    return (
      <Image
        src={photoUrl}
        alt={initials}
        width={120}
        height={120}
        unoptimized
        className={`${className} shrink-0 rounded-full object-cover`}
        style={{ border: `1px solid ${tone}` }}
      />
    );
  }

  return (
    <div
      className={`${className} flex shrink-0 items-center justify-center rounded-full font-bold`}
      style={{ background: `${tone}25`, color: tone, border: `1px solid ${tone}` }}
    >
      {initials}
    </div>
  );
}
