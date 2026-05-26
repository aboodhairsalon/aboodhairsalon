/**
 * Logo System A One — glyphe A1 fusionné (D-010 / D-024).
 *
 * Utilisé sur les pages d'entrée de l'app tenant (signup, login) qui ont
 * adopté la nouvelle DA noir + vert pomme. Glyphe inline depuis le SVG
 * officiel ; wordmark en HTML/Inter Tight.
 */

interface BrandLogoProps {
  variant?: 'mark' | 'lockup';
  size?: number;
  className?: string;
}

function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size * (280 / 440)}
      height={size}
      viewBox="0 0 280 440"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <g fill="#FAFAFA">
        <path d="M 0 400 L 60 400 L 175 60 L 115 60 Z" />
        <rect x="50" y="240" width="125" height="36" />
        <rect x="175" y="0" width="48" height="400" />
        <rect x="140" y="400" width="120" height="36" />
      </g>
      <path d="M 120 80 L 175 0 L 175 60 L 145 100 Z" fill="#A3E635" />
    </svg>
  );
}

export function BrandLogo({ variant = 'lockup', size = 30, className = '' }: BrandLogoProps) {
  return (
    <span
      className={`inline-flex items-center gap-3 ${className}`}
      style={{ fontFamily: 'var(--font-inter-tight), sans-serif' }}
    >
      <Mark size={size} />
      {variant === 'lockup' && (
        <span className="flex flex-col leading-none">
          <span className="text-[16px] font-bold tracking-[-0.03em] text-[#FAFAFA]">
            System A One
          </span>
          <span
            className="mt-1.5 text-[7px] uppercase tracking-[0.26em] text-[#71717A]"
            style={{ fontFamily: 'var(--font-jetbrains), monospace' }}
          >
            System · Solution · Optimisation
          </span>
        </span>
      )}
    </span>
  );
}
