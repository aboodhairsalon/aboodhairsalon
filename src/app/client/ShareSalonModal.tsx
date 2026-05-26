'use client';

/**
 * Modale de partage du salon — espace Client.
 *
 * Affiche l'URL de réservation, un bouton Copier (presse-papier), un bouton
 * Partager… (Web Share API, masqué quand l'API n'est pas dispo), et un QR
 * code généré côté client à partir de l'URL.
 *
 * Aucun appel serveur : tout est local au navigateur du visiteur.
 */
import { Copy, QrCode, Share2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Btn, Modal } from '@/components';

export function ShareSalonModal({
  open,
  onClose,
  salonName,
  slug,
}: {
  open: boolean;
  onClose: () => void;
  /** Nom du salon — utilisé dans le titre/texte de partage. */
  salonName: string;
  /** Slug du tenant — sert à composer l'URL de réservation. */
  slug: string;
}) {
  const t = useTranslations('client.share');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);

  // URL DE PARTAGE — format `/r/{slug}` (fresh URL pattern dédié au sharing).
  //
  // Pourquoi `/r/` et pas juste `/{slug}` ?
  // WhatsApp/Facebook ont un cache CENTRAL de previews par URL (TTL ~7-30j).
  // Quand `/{slug}` a été crawlé une 1ère fois pendant que le root layout
  // avait `robots: noindex`, leur cache a stocké « pas de preview valide »
  // pour CETTE URL — et continue de servir ce fallback même après notre fix.
  // Sans accès Facebook Debugger (= besoin d'un compte FB), impossible de
  // purger ce cache manuellement.
  //
  // Le pattern `/r/{slug}` est une URL VIERGE que WhatsApp n'a jamais
  // crawlée → fresh crawl forcé → preview correcte du 1er coup. Le middleware
  // rewrite interne `/r/aboodhairsalon` → `/client` (avec headers tenant
  // injectés), donc le visiteur voit exactement la même page qu'avec
  // l'URL canonique.
  //
  // L'URL canonique `/{slug}` reste utilisable pour les QR codes imprimés,
  // les business cards, et la saisie manuelle — c'est juste son cache
  // WhatsApp qui est temporairement cassé (s'auto-régénère dans 7-30j).
  const url = typeof window !== 'undefined' && slug ? `${window.location.origin}/r/${slug}` : '';

  // Détection de la Web Share API au montage (uniquement côté client).
  useEffect(() => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      setCanShare(true);
    }
  }, []);

  // Génère le QR à l'ouverture de la modale ; nettoie à la fermeture.
  useEffect(() => {
    if (!open || !url) {
      setQrDataUrl(null);
      return;
    }
    let alive = true;
    QRCode.toDataURL(url, { width: 240, margin: 1 })
      .then((dataUrl) => {
        if (alive) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (alive) setQrDataUrl(null);
      });
    return () => {
      alive = false;
    };
  }, [open, url]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
    setTimeout(() => setCopyState('idle'), 2000);
  };

  const handleShare = async () => {
    try {
      await navigator.share({
        title: t('shareTitle', { salonName }),
        text: t('shareText', { salonName }),
        url,
      });
    } catch {
      // L'utilisateur a annulé le partage, ou la feuille a échoué — silencieux.
    }
  };

  const copyLabel =
    copyState === 'copied' ? t('copyOk') : copyState === 'error' ? t('copyError') : t('copyBtn');

  return (
    <Modal open={open} onClose={onClose} title={t('title')}>
      <div className="space-y-5">
        <p className="text-ink-mute text-sm">{t('description')}</p>

        {/* URL en clair (sélectionnable) */}
        <div className="border-line bg-bg-soft text-ink mono break-all rounded-sm border p-3 text-xs">
          {url || '…'}
        </div>

        {/* Actions */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Btn variant="secondary" icon={Copy} onClick={handleCopy} full>
            {copyLabel}
          </Btn>
          {canShare && (
            <Btn icon={Share2} onClick={handleShare} full>
              {t('shareBtn')}
            </Btn>
          )}
        </div>

        {/* QR code */}
        {qrDataUrl && (
          <div className="border-line flex flex-col items-center gap-2 border-t pt-5">
            <div className="mono text-ink-soft flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em]">
              <QrCode className="h-3 w-3" strokeWidth={1.5} />
              {t('qrLabel')}
            </div>
            <img
              src={qrDataUrl}
              alt={t('qrAlt', { salonName })}
              className="border-line h-48 w-48 rounded-sm border"
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
