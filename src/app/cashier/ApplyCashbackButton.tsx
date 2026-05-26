'use client';

/**
 * ApplyCashbackButton — affiche le solde cashback disponible d'un client et
 * un bouton pour l'appliquer sur la vente courante.
 *
 * À intégrer dans tout endroit où on a un client attaché à une vente (panel
 * POS, ReceiptQRModal post-paiement, modal pré-encaissement…). Le composant
 * gère seul son cycle : fetch du solde au mount, débit du montant choisi,
 * callback `onRedeemed(amountCents)` pour que le parent ajuste son total.
 *
 * Sécurité : la logique de débit (TOCTOU-safe UPDATE atomique) est côté
 * serveur dans `cashback-actions.ts`. Le composant n'envoie qu'un input
 * validé + Zod.
 */
import { Wallet } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';

import { useFmtMoney } from '../_data/local-state';
import { useToast } from '../_components/Toast';
import { getCashbackBalance, redeemCashbackForSale } from './cashback-actions';

interface ApplyCashbackButtonProps {
  tenantId: string;
  phone: string;
  /** Montant de la vente en cours — sert à plafonner le débit cashback
   *  (on ne peut pas appliquer plus que le total de la vente). */
  saleTotalCents: number;
  /** Callback déclenché après redemption réussie. Le parent ajuste son
   *  affichage de total + persiste l'info que ce montant a été utilisé. */
  onRedeemed: (amountCents: number) => void;
}

export function ApplyCashbackButton({
  tenantId,
  phone,
  saleTotalCents,
  onRedeemed,
}: ApplyCashbackButtonProps) {
  const t = useTranslations('cashier.cashback');
  const tErrors = useTranslations('cashier.errors');
  const fmt = useFmtMoney();
  const toast = useToast();
  const [availableCents, setAvailableCents] = useState<number | null>(null);
  const [redeemed, setRedeemed] = useState(false);
  const [pending, startTransition] = useTransition();

  // Charge le solde au mount + à chaque changement de client
  useEffect(() => {
    if (!tenantId || !phone) {
      setAvailableCents(null);
      return;
    }
    let alive = true;
    void getCashbackBalance(tenantId, phone).then((res) => {
      if (!alive) return;
      if (res.ok) {
        setAvailableCents(res.availableCents);
      } else {
        setAvailableCents(0);
      }
    });
    return () => {
      alive = false;
    };
  }, [tenantId, phone]);

  // Montant qu'on va appliquer = min(disponible, total vente). Pas la peine
  // de donner X EGP de cashback si la vente fait Y < X — on appliquerait X
  // mais Y serait facturé 0 et il resterait du cashback inutilisé.
  const applyCents = availableCents !== null ? Math.min(availableCents, saleTotalCents) : 0;

  if (availableCents === null) return null; // loading
  if (availableCents === 0) return null; // pas de solde → caché
  if (redeemed) {
    return (
      <div
        className="border-line bg-surface-elev flex items-center gap-2 rounded-sm border px-3 py-2 text-xs"
        style={{ color: '#2E7D32' }}
      >
        <Wallet className="h-3.5 w-3.5" strokeWidth={1.8} />
        {t('appliedLabel', { amount: fmt(applyCents) })}
      </div>
    );
  }

  const handleApply = () => {
    if (pending || applyCents <= 0) return;
    startTransition(async () => {
      const res = await redeemCashbackForSale({ tenantId, phone, amountCents: applyCents });
      if (res.ok) {
        setAvailableCents(res.remainingAvailableCents);
        setRedeemed(true);
        onRedeemed(applyCents);
        toast.success(t('appliedToast', { amount: fmt(applyCents) }));
      } else {
        toast.error(tErrors(res.errorKey as 'unknownError', res.errorValues));
      }
    });
  };

  return (
    <button
      type="button"
      onClick={handleApply}
      disabled={pending}
      className="border-line bg-surface-elev btn-press flex w-full items-center justify-between gap-2 rounded-sm border px-3 py-2.5 text-xs transition-colors hover:bg-white disabled:opacity-50"
    >
      <div className="flex items-center gap-2">
        <Wallet className="h-4 w-4" strokeWidth={1.8} style={{ color: '#E0A23D' }} />
        <div className="flex flex-col items-start">
          <span className="text-ink font-semibold">{t('availableLabel')}</span>
          <span className="text-ink-soft text-[10px]">{fmt(availableCents)}</span>
        </div>
      </div>
      <span className="mono text-ink rounded-sm bg-white px-2 py-1 text-[10px] font-bold">
        {pending ? '…' : t('applyBtn', { amount: fmt(applyCents) })}
      </span>
    </button>
  );
}
