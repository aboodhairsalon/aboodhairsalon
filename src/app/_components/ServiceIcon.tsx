import { Coffee, Crown, Scissors, ShieldCheck, Sparkles } from 'lucide-react';
import type { Service } from '../_data/mock';

const ICONS = {
  scissors: Scissors,
  razor: Scissors,
  crown: Crown,
  shield: ShieldCheck,
  star: Coffee,
  sparkle: Sparkles,
} as const;

interface ServiceIconProps {
  iconKey: Service['icon'];
  className?: string;
}

export function ServiceIcon({ iconKey, className = 'w-5 h-5' }: ServiceIconProps) {
  const Icon = ICONS[iconKey] ?? Scissors;
  return <Icon className={className} strokeWidth={1.5} />;
}
