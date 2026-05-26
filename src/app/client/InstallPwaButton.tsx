'use client';

/**
 * InstallPwaPopup — popup modal « Ajouter à l'écran d'accueil » côté client.
 *
 * Comportement :
 *  - S'affiche AUTOMATIQUEMENT en bottom sheet (mobile) / center modal (desktop)
 *    après un délai de ~3 s sur le 1er chargement.
 *  - Chrome / Edge (Android + desktop) : on attend `beforeinstallprompt`
 *    avant d'ouvrir le popup → on est sûr que l'install est techniquement
 *    possible (manifest valide, HTTPS, SW actif). Clic « Installer » →
 *    déclenche le prompt natif.
 *  - iOS Safari : pas d'API native. Le popup montre un tutoriel pas-à-pas
 *    (icône Partage → Ajouter à l'écran d'accueil).
 *  - Déjà installé (`display-mode: standalone`) : popup masqué pour toujours.
 *  - Dismiss : suppression localStorage pour 7 jours (anti-harcèlement).
 *
 * Composant entièrement autoporteur — pas besoin de prop ni d'orchestrateur,
 * il décide tout seul s'il doit s'afficher.
 */
import { Smartphone, Share, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'sysA_pwa_install_dismissed_at';
// Ré-affiche le popup après 7 jours si l'utilisateur l'a fermé. Évite le
// harcèlement tout en laissant une 2e chance — un client qui décline en
// avril revoit le popup en mai (typique pour passer un seuil de friction).
const SUPPRESS_MS = 7 * 24 * 60 * 60 * 1000;
// Délai avant l'apparition automatique du popup install.
//
// AVANT (BUG audit pre-launch) : 2800ms = popup blocking sur iOS dès qu'un
// visiteur marketing arrivait — il voyait la modale install AVANT même
// d'avoir vu le logo / le nom / les services du salon. Friction immédiate
// catastrophique → bounce rate massif sur les visiteurs marketing.
//
// FIX : 45 s. Le visiteur a eu le temps de scroll, comprendre l'offre, et
// peut-être commencé à réserver. À ce stade un prompt install est pertinent
// (engagement réel mesuré, pas une supposition au cold-start).
const AUTO_OPEN_DELAY_MS = 45000;

export function InstallPwaButton({ salonName }: { salonName: string }) {
  const t = useTranslations('client.pwa');
  const [promptEvt, setPromptEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [open, setOpen] = useState(false);
  /** Mode du popup : 'install' (Chrome — prompt natif disponible), 'ios'
   *  (Safari iOS — tutoriel pas-à-pas), ou 'in-app' (navigateur intégré
   *  Instagram/FB/WhatsApp où aucune install n'est possible — on demande
   *  d'ouvrir dans le navigateur système). Audit T5.12. */
  const [mode, setMode] = useState<'install' | 'ios' | 'in-app' | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Détecte si la PWA est déjà installée → on n'affiche jamais le popup.
    const mql = window.matchMedia('(display-mode: standalone)');
    const standalone =
      mql.matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    setIsStandalone(standalone);
    if (standalone) return;

    // Anti-spam : suppression de 7 jours si l'utilisateur a déjà fermé.
    const dismissedAt = Number(localStorage.getItem(DISMISSED_KEY) ?? '0');
    if (dismissedAt && Date.now() - dismissedAt < SUPPRESS_MS) return;

    // Détection iOS Safari (UA detection).
    const ua = window.navigator.userAgent;
    const iOS =
      /iPad|iPhone|iPod/.test(ua) && !(window as Window & { MSStream?: unknown }).MSStream;

    // Détection navigateurs in-app (Instagram, FB, WhatsApp, Twitter, LinkedIn).
    // Dans ces contextes, l'install PWA n'est techniquement pas possible :
    // - Pas d'événement `beforeinstallprompt` (Chrome wrapper en lecture seule)
    // - Pas d'option « Ajouter à l'écran d'accueil » dans le menu Safari iOS
    // Le tutoriel pas-à-pas est trompeur → on affiche un message dédié qui
    // explique d'ouvrir le lien dans Safari/Chrome. Audit T5.12.
    const inAppBrowser =
      /\b(Instagram|FBAN|FBAV|FB_IAB|FB4A|WhatsApp|Twitter|LinkedInApp|Line\/)/i.test(ua);
    if (inAppBrowser) {
      const timer = setTimeout(() => {
        setMode('in-app');
        setOpen(true);
      }, AUTO_OPEN_DELAY_MS);
      return () => clearTimeout(timer);
    }

    // Sur iOS, pas d'événement natif → on ouvre directement le popup mode
    // tutoriel après le délai.
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (iOS) {
      timer = setTimeout(() => {
        setMode('ios');
        setOpen(true);
      }, AUTO_OPEN_DELAY_MS);
    }

    // Sur Chrome/Edge, on attend `beforeinstallprompt` avant d'ouvrir.
    // L'event ne se déclenche que si la page satisfait les critères PWA
    // (manifest, HTTPS, service worker, jamais installée, etc.). Sans cet
    // event on n'affiche RIEN — éviter une promesse d'install qu'on ne peut
    // pas tenir.
    const handler = (e: Event) => {
      e.preventDefault();
      setPromptEvt(e as BeforeInstallPromptEvent);
      // Petit délai pour ne pas afficher au tout 1er paint.
      timer = setTimeout(() => {
        setMode('install');
        setOpen(true);
      }, AUTO_OPEN_DELAY_MS);
    };
    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  if (isStandalone || !open || !mode) return null;

  const handleInstall = async () => {
    if (!promptEvt) return;
    await promptEvt.prompt();
    const choice = await promptEvt.userChoice;
    if (choice.outcome === 'accepted') {
      // Accepté — on ferme et on ne réaffiche plus (l'install termine le job)
      setOpen(false);
    } else {
      // Dismissed depuis le prompt natif → on respecte sa décision pour 7j
      localStorage.setItem(DISMISSED_KEY, String(Date.now()));
      setOpen(false);
    }
    setPromptEvt(null);
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    setOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ background: 'rgba(15,13,10,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={handleDismiss}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pwa-popup-title"
    >
      <div
        className="fade-up w-full max-w-md overflow-hidden rounded-t-3xl bg-white sm:rounded-3xl"
        style={{ color: '#18160F', boxShadow: '0 -8px 48px rgba(0,0,0,0.22)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Bouton close discret en haut */}
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t('dismissBtn')}
          className="btn-press absolute end-3 top-3 z-10 rounded-full p-1.5"
          style={{ color: '#8A8478' }}
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>

        {mode === 'in-app' ? (
          // === Mode navigateur in-app (Instagram, FB, WhatsApp…) ===
          // L'install n'est pas possible dans ces wrappers. On demande
          // d'ouvrir dans Safari/Chrome système. Audit T5.12.
          <div className="p-7 text-center">
            <div
              className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl"
              style={{ background: '#1A1714', color: '#FFFFFF' }}
            >
              <Share className="h-8 w-8" strokeWidth={1.5} />
            </div>
            <h3 id="pwa-popup-title" className="display mb-2 text-2xl">
              {t('inAppTitle')}
            </h3>
            <p className="mb-5 text-sm" style={{ color: '#5A554C' }}>
              {t('inAppSubtitle', { name: salonName })}
            </p>
            <ol className="space-y-2.5 text-left text-sm" style={{ color: '#3A3630' }}>
              <li className="flex items-start gap-3">
                <span
                  className="mono flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                  style={{ background: '#F4F3F0', color: '#1A1714' }}
                >
                  1
                </span>
                <span>{t('inAppStep1')}</span>
              </li>
              <li className="flex items-start gap-3">
                <span
                  className="mono flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                  style={{ background: '#F4F3F0', color: '#1A1714' }}
                >
                  2
                </span>
                <span>{t('inAppStep2')}</span>
              </li>
            </ol>
            <button
              type="button"
              onClick={handleDismiss}
              className="btn-press mt-6 w-full rounded-xl py-3 text-sm font-semibold"
              style={{ background: '#1A1714', color: '#FFFFFF' }}
            >
              {t('iosCloseBtn')}
            </button>
          </div>
        ) : mode === 'install' ? (
          // === Mode Chrome / Android — prompt natif ===
          <div className="p-7 text-center">
            <div
              className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl"
              style={{ background: '#1A1714', color: '#FFFFFF' }}
            >
              <Smartphone className="h-8 w-8" strokeWidth={1.5} />
            </div>
            <h3 id="pwa-popup-title" className="display mb-2 text-2xl">
              {t('title')}
            </h3>
            <p className="mb-6 text-sm" style={{ color: '#5A554C' }}>
              {t('subtitle', { name: salonName })}
            </p>
            <button
              type="button"
              onClick={handleInstall}
              className="btn-press w-full rounded-xl py-3.5 text-sm font-semibold"
              style={{ background: '#1A1714', color: '#FFFFFF' }}
            >
              {t('installBtn')}
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              className="mono mt-3 w-full text-[10px] uppercase tracking-wider"
              style={{ color: '#A8A49C' }}
            >
              {t('laterBtn')}
            </button>
          </div>
        ) : (
          // === Mode iOS Safari — tutoriel pas-à-pas ===
          <div className="p-7">
            <div
              className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl"
              style={{ background: '#1A1714', color: '#FFFFFF' }}
            >
              <Smartphone className="h-8 w-8" strokeWidth={1.5} />
            </div>
            <h3 id="pwa-popup-title" className="display mb-2 text-center text-2xl">
              {t('iosTitle')}
            </h3>
            <p className="mb-5 text-center text-sm" style={{ color: '#5A554C' }}>
              {t('subtitle', { name: salonName })}
            </p>
            <ol className="space-y-3.5 text-sm" style={{ color: '#3A3630' }}>
              <li className="flex items-start gap-3">
                <span
                  className="mono flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                  style={{ background: '#F4F3F0', color: '#1A1714' }}
                >
                  1
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {t('iosStep1Before')}
                  <span
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md"
                    style={{ background: '#F4F3F0' }}
                  >
                    <Share className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </span>
                  {t('iosStep1After')}
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span
                  className="mono flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                  style={{ background: '#F4F3F0', color: '#1A1714' }}
                >
                  2
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {t('iosStep2Before')}
                  <span
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md"
                    style={{ background: '#F4F3F0' }}
                  >
                    <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </span>
                  {t('iosStep2After')}
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span
                  className="mono flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                  style={{ background: '#F4F3F0', color: '#1A1714' }}
                >
                  3
                </span>
                <span>{t('iosStep3')}</span>
              </li>
            </ol>
            <button
              type="button"
              onClick={handleDismiss}
              className="btn-press mt-6 w-full rounded-xl py-3 text-sm font-semibold"
              style={{ background: '#1A1714', color: '#FFFFFF' }}
            >
              {t('iosCloseBtn')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
