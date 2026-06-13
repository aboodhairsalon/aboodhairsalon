'use client';
/**
 * Hook d'état réseau — `navigator.onLine` + événements `online`/`offline`.
 *
 * Note : `navigator.onLine` indique l'accès au réseau local, pas forcément à
 * Internet (un wifi sans passerelle peut renvoyer `true`). C'est suffisant ici
 * car la vraie source de vérité reste l'échec de l'appel serveur (try/catch
 * côté caisse) ; ce hook ne sert qu'à l'UX (bandeau) et à déclencher la synchro.
 */
import { useEffect, useState } from 'react';

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    // Re-sync l'état au montage (au cas où il aurait changé avant l'abonnement).
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
