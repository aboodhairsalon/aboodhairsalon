'use client';

/**
 * TrialBanner — bandeau d'avertissement quand l'essai gratuit du tenant
 * approche / a expiré (audit T5.27).
 *
 * Politique :
 *  - J-3 → J0  : bandeau orange « Votre essai expire dans X jours »
 *  - J0 dépassé : bandeau rouge « Essai expiré, contactez-nous »
 *  - > J3 ou trial_ends_at NULL : rien (cas par défaut, ne pas polluer l'UI)
 *
 * Volontairement non bloquant côté Pre-launch (Stripe Billing pas encore
 * branché). C'est un signal visuel pour que le fondateur sache qui doit
 * être contacté. Quand le billing sera intégré, on pourra durcir vers
 * un blocage des Server Actions sensibles.
 */
import { AlertTriangle, Clock } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useTenantOrNull } from '../_components/TenantProvider';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function TrialBanner() {
  const session = useTenantOrNull();
  const t = useTranslations('manager.trial');
  const locale = useLocale();

  const trialEndsAt = session?.tenant.trial_ends_at;
  // Affiche uniquement si le tenant a un trial actif (plan trial + date posée).
  // Les tenants déjà passés en plan payant n'ont plus de trial_ends_at sensible.
  if (!trialEndsAt) return null;
  const endTs = Date.parse(trialEndsAt);
  if (Number.isNaN(endTs)) return null;

  const now = Date.now();
  const remainingMs = endTs - now;
  const remainingDays = Math.ceil(remainingMs / MS_PER_DAY);

  // Plus de 3 jours restants → silence radio.
  if (remainingDays > 3) return null;

  const expired = remainingDays <= 0;

  // Date formatée en respect de la locale UI.
  const bcp47 = locale === 'ar' ? 'ar-EG' : locale === 'en' ? 'en-US' : 'fr-FR';
  const formattedDate = new Date(endTs).toLocaleDateString(bcp47, {
    day: 'numeric',
    month: 'long',
  });

  const bg = expired ? 'rgba(199, 93, 69, 0.10)' : 'rgba(208, 140, 79, 0.10)';
  const border = expired ? 'rgba(199, 93, 69, 0.30)' : 'rgba(208, 140, 79, 0.30)';
  const fg = expired ? '#A4453D' : '#7A5320';
  const Icon = expired ? AlertTriangle : Clock;

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 text-xs sm:px-6"
      style={{ background: bg, borderBottom: `1px solid ${border}`, color: fg }}
      role="status"
      aria-live="polite"
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
      <span className="flex-1">
        {expired
          ? t('expired')
          : remainingDays === 1
            ? t('expiresTomorrow', { date: formattedDate })
            : t('expiresIn', { count: remainingDays, date: formattedDate })}
      </span>
      <a
        href="mailto:hadadzak@gmail.com?subject=Activer%20abonnement"
        className="mono font-semibold underline-offset-2 hover:underline"
      >
        {t('contactCta')}
      </a>
    </div>
  );
}
