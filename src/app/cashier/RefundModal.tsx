'use client';

/**
 * RefundModal — rembourse une vente depuis le log Caisse, total ou partiel.
 *
 * Le caissier voit le total facturé + le déjà-remboursé (si applicable), peut
 * ajuster le montant à rembourser (défaut = restant intégral), saisit un motif
 * facultatif, puis confirme. Si le montant = restant, la vente passe en
 * `refunded` ; sinon elle reste `completed` avec `refunded_cents` cumulé.
 *
 * Sécurité : la Server Action `refundSale` re-vérifie tenant + statut
 * `completed` + refunded_cents inchangé (TOCTOU) côté serveur — un client ne
 * peut pas double-rembourser même en spammant le bouton ou en envoyant un
 * montant trop élevé.
 */
import { AlertTriangle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { Btn, Modal } from '@/components';
import { useFmtMoney } from '../_data/local-state';
import type { Sale } from '../_data/mock';
import { refundSale } from '../manager/refund-actions';
import { useToast } from '../_components/Toast';

function toBcp47(locale: string): string {
  return locale === 'ar' ? 'ar-EG' : locale === 'en' ? 'en-US' : 'fr-FR';
}

/** 'YYYY-MM-DD' → date longue localisée. */
function fmtDateLong(iso: string, bcp47: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat(bcp47, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function RefundModal({
  sale,
  onClose,
  onRefunded,
}: {
  sale: Sale | null;
  onClose: () => void;
  /** Callback déclenché après succès — laisse au parent le soin de muter
   *  son état local (refunded ? totalement : partiellement, avec le nouveau
   *  cumul remboursé pour ré-afficher le restant si l'utilisateur rouvre). */
  onRefunded: (
    saleId: string,
    refundedAt: string,
    reason: string | null,
    refundedCents: number,
    fullyRefunded: boolean,
  ) => void;
}) {
  const t = useTranslations('cashier.log.refundModal');
  const tErrors = useTranslations('manager.errors');
  const locale = useLocale();
  const bcp47 = toBcp47(locale);
  const fmt = useFmtMoney();
  const toast = useToast();
  const [reason, setReason] = useState('');
  /** Montant saisi en unités (EGP/€…), vide = restant intégral. Texte plutôt
   *  que number pour autoriser la saisie partielle au clavier (l'utilisateur
   *  tape « 1 » puis « 0 » puis « 0 »). */
  const [amountInput, setAmountInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Reset complet à chaque nouvelle vente ouverte — sinon le motif et le
  // montant d'un refund précédent traînent dans la modale.
  useEffect(() => {
    if (sale) {
      setReason('');
      setAmountInput('');
      setError(null);
    }
  }, [sale?.id]);

  if (!sale) return null;

  // Une vente avec un ID `local-…` n'a pas encore atteint la DB (l'appel
  // createDirectSale est en cours OU vient de fail). Le Zod uuid() côté
  // serveur rejettera → on l'attrape ici pour donner un message
  // intelligible au lieu d'un générique « Données invalides ».
  const isLocal = sale.id.startsWith('local-');

  const alreadyRefunded = sale.refundedCents ?? 0;
  const remaining = sale.totalCents - alreadyRefunded;

  // Parse l'input : vide → restant intégral, sinon en cents (×100, arrondi).
  // Math.round évite les erreurs de virgule flottante sur ex. 12.30 → 1229.99…
  // .replace(',', '.') normalise la virgule décimale FR/EG → point — sinon
  // « 12,30 » parsait en 12 silencieusement (audit T2.11).
  const trimmed = amountInput.trim();
  const parsedCents =
    trimmed === '' ? remaining : Math.round(parseFloat(trimmed.replace(',', '.')) * 100);
  const parsedValid = Number.isFinite(parsedCents) && parsedCents > 0 && parsedCents <= remaining;
  const isPartial = parsedValid && parsedCents < remaining;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (isLocal) {
      setError(t('errorLocalSale'));
      return;
    }
    if (!parsedValid) {
      setError(t('errorAmountInvalid', { max: fmt(remaining) }));
      return;
    }
    startTransition(async () => {
      const res = await refundSale({
        saleId: sale.id,
        // On envoie undefined quand l'utilisateur n'a rien saisi → le serveur
        // rembourse le restant intégral. Sinon on envoie la valeur exacte.
        amountCents: trimmed === '' ? undefined : parsedCents,
        reason,
      });
      if (!res.ok) {
        setError(tErrors(res.errorKey as 'dbError', res.errorValues));
        return;
      }
      const now = new Date().toISOString();
      toast.success(res.fullyRefunded ? t('toastSuccess') : t('toastPartialSuccess'));
      onRefunded(sale.id, now, reason.trim() || null, res.refundedCents, res.fullyRefunded);
    });
  };

  return (
    <Modal open onClose={onClose} title={t('title')}>
      <form onSubmit={submit} className="space-y-4">
        <div className="border-red/30 bg-red/8 flex items-start gap-3 rounded-sm border p-3">
          <AlertTriangle className="text-red mt-0.5 h-4 w-4 flex-shrink-0" strokeWidth={1.75} />
          <p className="text-ink-mute text-xs leading-relaxed">{t('warning')}</p>
        </div>

        <div className="border-line bg-bg-soft rounded-sm border p-3">
          <div className="mono text-ink-soft mb-1.5 text-[9px] uppercase tracking-[0.2em]">
            {t('summaryLabel', { date: fmtDateLong(sale.date, bcp47), time: sale.time })}
          </div>
          <div className="text-ink mb-1 text-sm">{sale.items.map((i) => i.name).join(' + ')}</div>

          {/* Total + déjà-remboursé (si applicable) */}
          {alreadyRefunded > 0 ? (
            <>
              <div className="mt-2 flex items-baseline justify-between text-[11px]">
                <span className="text-ink-soft">{t('totalLabel')}</span>
                <span className="mono text-ink-mute">{fmt(sale.totalCents)}</span>
              </div>
              <div className="mt-1 flex items-baseline justify-between text-[11px]">
                <span className="text-ink-soft">{t('alreadyRefundedLabel')}</span>
                <span className="mono text-ink-mute">− {fmt(alreadyRefunded)}</span>
              </div>
              <div className="border-line mt-2 border-t pt-2">
                <div className="mono text-ink-soft text-[10px] uppercase tracking-wider">
                  {t('remainingLabel')}
                </div>
                <div className="display text-brand-primary mono mt-0.5 text-3xl">
                  {fmt(remaining)}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="mono text-ink-soft mt-2 text-[10px] uppercase tracking-wider">
                {t('amountLabel')}
              </div>
              <div className="display text-brand-primary mono text-3xl">{fmt(sale.totalCents)}</div>
            </>
          )}
        </div>

        {/* Champ « Montant à rembourser » — vide = restant intégral. */}
        <div>
          <label className="block">
            <span className="mono text-ink-soft mb-1.5 block text-[9px] uppercase tracking-[0.2em]">
              {t('refundAmountLabel')}
            </span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder={t('refundAmountPlaceholder', { max: fmt(remaining) })}
              className="border-line bg-bg-soft text-ink placeholder:text-ink-soft focus:border-brand-primary w-full rounded-sm border px-3 py-2.5 text-sm outline-none transition-colors"
            />
            <p className="text-ink-soft mt-1.5 text-[11px]">
              {isPartial
                ? t('helperPartial', { amount: fmt(parsedCents), max: fmt(remaining) })
                : t('helperFull', { max: fmt(remaining) })}
            </p>
          </label>
        </div>

        <div>
          <label className="block">
            <span className="mono text-ink-soft mb-1.5 block text-[9px] uppercase tracking-[0.2em]">
              {t('reasonLabel')}
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('reasonPlaceholder')}
              rows={2}
              maxLength={500}
              className="border-line bg-bg-soft text-ink placeholder:text-ink-soft focus:border-brand-primary w-full resize-none rounded-sm border px-3 py-2.5 text-sm outline-none transition-colors"
            />
          </label>
        </div>

        {error && (
          <p className="border-red/30 bg-red/10 text-red rounded-sm border px-3 py-2 text-xs">
            {error}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          {/* type="button" CRITIQUE : sans ça, un <button> dans un <form>
              prend type="submit" par défaut → cliquer Annuler déclenche le
              `submit` du form qui confirme le remboursement à la place de
              l'annuler. Cf. audit-2 finding E. */}
          <Btn type="button" variant="secondary" onClick={onClose} disabled={pending} full>
            {t('cancelBtn')}
          </Btn>
          <Btn type="submit" full disabled={pending || !parsedValid}>
            {pending
              ? t('submittingBtn')
              : isPartial
                ? t('submitPartialBtn', { amount: fmt(parsedCents) })
                : t('submitBtn')}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}
