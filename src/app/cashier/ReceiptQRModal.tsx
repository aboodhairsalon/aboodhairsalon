'use client';

/**
 * ReceiptQRModal — modale post-paiement de la Caisse.
 *
 * Affichée juste après l'encaissement quand un client est rattaché à la vente.
 * Présente :
 *  - Un résumé de la vente (total + items)
 *  - Un QR code à scanner par le client → ouvre `/{slug}/client?p={phone}`
 *    L'espace Client détecte le paramètre `p`, pose le téléphone en
 *    localStorage et bascule sur l'onglet « Profil » avec la facture +
 *    les nouveaux points de fidélité.
 *  - Un bouton « Fermer » pour passer à la vente suivante
 *
 * Sécurité : pas de token d'authentification dans l'URL — l'identifiant
 * client reste son numéro de téléphone (cohérent avec le reste du flow
 * /client). Le QR n'est utile que dans la fenêtre de temps physique au
 * comptoir, donc l'exposition est négligeable.
 */
import { Check, Download, Mail, Phone, QrCode } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import { useEffect, useState, useTransition } from 'react';
import { Btn, Modal } from '@/components';
import { useFmtMoney } from '../_data/local-state';
import { useTenantOrNull } from '../_components/TenantProvider';
import { useToast } from '../_components/Toast';
import { downloadReceiptPdf } from '../_lib/receipt-pdf';
import { sendReceiptEmail } from '../manager/email-actions';
import { issueClientToken } from '../manager/token-actions';

function toBcp47(locale: string): string {
  return locale === 'ar' ? 'ar-EG' : locale === 'en' ? 'en-US' : 'fr-FR';
}

export interface ReceiptQRClient {
  phone: string;
  firstName: string | null;
  lastName: string | null;
}

export interface ReceiptQRItem {
  name: string;
  qty: number;
  priceCents: number;
}

export function ReceiptQRModal({
  open,
  onClose,
  client,
  totalCents,
  itemsLabel,
  items,
  saleId,
  method,
  tipCents,
  slug,
}: {
  open: boolean;
  onClose: () => void;
  client: ReceiptQRClient | null;
  totalCents: number;
  /** Une ligne descriptive de la vente (« Coupe + Shampoing »). */
  itemsLabel: string;
  /** Liste détaillée des articles — utilisée pour le PDF. */
  items: ReceiptQRItem[];
  /** ID local ou DB de la vente — utilisé pour le PDF (filename + N°). */
  saleId: string;
  /** Mode de paiement — affiché dans le PDF. */
  method: 'card' | 'cash' | 'mobile';
  /** Pourboire éventuel — ajouté au total dans le PDF. */
  tipCents?: number;
  /** Slug du tenant — sert à composer l'URL du QR. */
  slug: string;
}) {
  const t = useTranslations('cashier.receiptQR');
  const tPdf = useTranslations('cashier.receiptPdf');
  const tLog = useTranslations('cashier.log');
  const tErrors = useTranslations('manager.errors');
  const locale = useLocale();
  const bcp47 = toBcp47(locale);
  const fmt = useFmtMoney();
  const toast = useToast();
  const session = useTenantOrNull();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [tokenUrl, setTokenUrl] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [sendingEmail, startEmailSend] = useTransition();

  // URL canonique pour le QR — signée serveur-side (token HMAC) au lieu de
  // l'ancienne forme `?p=PHONE` qui exposait le téléphone en clair dans les
  // logs / referrers. Le serveur signe `{tenant, phone, exp 90j}`, le client
  // ne peut PAS forger un token sans le secret. Fallback `?p=` retiré.
  useEffect(() => {
    if (!open || !client || !slug) {
      setTokenUrl(null);
      return;
    }
    let alive = true;
    void issueClientToken(client.phone).then((res) => {
      if (!alive) return;
      if (res.ok && typeof window !== 'undefined') {
        setTokenUrl(`${window.location.origin}/${slug}/client?t=${encodeURIComponent(res.token)}`);
      }
    });
    return () => {
      alive = false;
    };
  }, [open, client, slug]);
  const url = tokenUrl ?? '';

  // Génère le QR à chaque ouverture (et nettoie à la fermeture pour libérer
  // l'image en mémoire). Taille fixe 260px — assez grand pour scan facile
  // depuis 20-30 cm. Attendre le tokenUrl résolu (re-render auto via state).
  useEffect(() => {
    if (!open || !url) {
      setQrDataUrl(null);
      return;
    }
    let alive = true;
    QRCode.toDataURL(url, { width: 260, margin: 1, color: { dark: '#18160F', light: '#FFFFFF' } })
      .then((data) => {
        if (alive) setQrDataUrl(data);
      })
      .catch(() => {
        if (alive) setQrDataUrl(null);
      });
    return () => {
      alive = false;
    };
  }, [open, url]);

  const displayName = client
    ? [client.firstName, client.lastName].filter(Boolean).join(' ').trim() || client.phone
    : '';

  const methodLabel =
    method === 'card'
      ? tLog('methodShortCard')
      : method === 'cash'
        ? tLog('methodShortCash')
        : tLog('methodShortMobile');

  const handleSendEmail = () => {
    if (!saleId || saleId.startsWith('local-')) return;
    startEmailSend(async () => {
      const res = await sendReceiptEmail({
        saleId,
        locale: locale === 'ar' || locale === 'en' ? locale : 'fr',
      });
      if (res.ok) {
        setEmailSent(true);
        toast.success(t('emailSentToast'));
      } else {
        toast.error(tErrors(res.errorKey as 'dbError', res.errorValues));
      }
    });
  };

  const handleDownloadPdf = () => {
    downloadReceiptPdf(
      {
        saleId,
        dateIso: new Date().toISOString(),
        time: new Date().toTimeString().slice(0, 5),
        items,
        totalCents,
        tipCents,
        method,
        methodLabel,
        currency: session?.tenant.currency ?? 'EUR',
        clientName: displayName || null,
        qrDataUrl,
        qrCaption: url || null,
      },
      {
        name: session?.tenant.name ?? '',
        logoDataUrl: session?.branding.logo_url ?? null,
        addressStreet: session?.settings.address_street ?? null,
        addressCity: session?.settings.address_city ?? null,
        addressZip: session?.settings.address_zip ?? null,
        branch: session?.settings.branch ?? null,
        phone: session?.settings.contact_phone ?? null,
        email: session?.settings.contact_email ?? null,
        website: session?.settings.contact_website ?? null,
        tagline: session?.settings.tagline ?? null,
      },
      {
        documentTitle: tPdf('documentTitle'),
        saleNumber: tPdf('saleNumber'),
        method: tPdf('method'),
        client: tPdf('client'),
        subtotal: tPdf('subtotal'),
        tip: tPdf('tip'),
        total: tPdf('total'),
        qty: tPdf('qty'),
        unitPrice: tPdf('unitPrice'),
        lineTotal: tPdf('lineTotal'),
        itemDesc: tPdf('itemDesc'),
        qrHint: tPdf('qrHint'),
        refundedStamp: tPdf('refundedStamp'),
        printedOn: tPdf('printedOn'),
        bcp47,
      },
    );
  };

  return (
    <Modal open={open} onClose={onClose} title={t('title')}>
      <div className="flex flex-col items-center gap-5 py-2 text-center">
        {/* Icône de validation */}
        <div className="border-brand-primary bg-brand-primary/10 flex h-14 w-14 items-center justify-center rounded-full border-2">
          <Check className="text-brand-primary h-7 w-7" strokeWidth={2} />
        </div>

        {/* Total payé */}
        <div>
          <div className="mono text-ink-soft text-[10px] uppercase tracking-[0.25em]">
            {t('totalLabel')}
          </div>
          <div className="display text-brand-primary mono mt-1 text-4xl">{fmt(totalCents)}</div>
          {itemsLabel && <div className="text-ink-mute mt-1.5 max-w-xs text-xs">{itemsLabel}</div>}
        </div>

        {/* Bloc client + QR — affiché uniquement quand un client est attaché */}
        {client ? (
          <>
            <div className="border-line w-full border-t" />
            <div className="w-full">
              <div className="mb-2 text-center">
                <div className="text-ink text-sm font-semibold">{displayName}</div>
                <div className="text-ink-soft mono mt-0.5 inline-flex items-center gap-1.5 text-[11px]">
                  <Phone className="h-3 w-3" strokeWidth={1.5} />
                  {client.phone}
                </div>
              </div>

              {/* QR code */}
              <div className="border-line bg-surface mx-auto flex h-[280px] w-[280px] items-center justify-center rounded-sm border p-2.5">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt={t('qrAlt', { name: displayName })}
                    className="h-full w-full"
                  />
                ) : (
                  <QrCode className="text-ink-soft h-16 w-16 animate-pulse" strokeWidth={1} />
                )}
              </div>

              <p className="text-ink-mute mx-auto mt-3 max-w-xs text-xs leading-relaxed">
                <strong className="text-ink">{t('scanCta')}</strong>
                {t('scanHint')}
              </p>
            </div>
          </>
        ) : (
          <p className="text-ink-mute max-w-xs text-xs">{t('noClient')}</p>
        )}

        {/* Bouton email — visible si le client est rattaché (= a un téléphone)
            ET si la vente a un ID DB stable (pas encore propagé pendant le
            premier instant qui suit l'encaissement, mais le bouton se débloque
            automatiquement quand createDirectSale renvoie l'ID). */}
        {client && saleId && !saleId.startsWith('local-') && (
          <div className="w-full">
            <Btn
              variant="secondary"
              icon={Mail}
              onClick={handleSendEmail}
              disabled={sendingEmail || emailSent}
              full
            >
              {emailSent ? t('emailSentBtn') : sendingEmail ? t('emailSendingBtn') : t('emailBtn')}
            </Btn>
          </div>
        )}

        <div className="grid w-full grid-cols-2 gap-2 pt-2">
          <Btn variant="secondary" icon={Download} onClick={handleDownloadPdf} full>
            {t('downloadPdfBtn')}
          </Btn>
          <Btn full onClick={onClose}>
            {t('nextSaleBtn')}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
