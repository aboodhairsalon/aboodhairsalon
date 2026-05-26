'use client';

/**
 * Bouton « Installer l'app » — capture l'événement `beforeinstallprompt`
 * (Android/Chrome) et expose un trigger explicite. Sur iOS, ouvre un petit
 * pavé d'aide « Ajouter à l'écran d'accueil ». Disparaît silencieusement
 * quand l'app est déjà installée (mode standalone) ou que ni l'événement
 * ni iOS ne s'appliquent.
 */
import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Btn } from '@/components';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

export function InstallPWA() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosTip, setIosTip] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    setIsStandalone(standalone);

    const ua = window.navigator.userAgent;
    setIsIos(/iPad|iPhone|iPod/.test(ua));

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (isStandalone) return null;
  if (!installEvent && !isIos) return null;

  const handleClick = async () => {
    if (installEvent) {
      await installEvent.prompt();
      setInstallEvent(null);
      return;
    }
    if (isIos) {
      setIosTip((v) => !v);
    }
  };

  return (
    <div className="relative inline-block">
      <Btn variant="secondary" size="sm" icon={Download} onClick={handleClick}>
        Installer
      </Btn>
      {iosTip && (
        <div className="border-line-hi bg-surface text-ink absolute end-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-sm border p-3 text-xs shadow-lg">
          <p className="mb-1 font-semibold">Ajouter à l&apos;écran d&apos;accueil</p>
          <p className="text-ink-mute">
            Sur iOS : ouvre la feuille de partage de Safari, puis « Sur l&apos;écran d&apos;accueil
            ».
          </p>
        </div>
      )}
    </div>
  );
}
