'use client';

/**
 * Enregistre le service worker en production uniquement.
 *
 * Le SW (`/sw.js`) met en cache les assets statiques pour des chargements
 * rapides après installation. Désactivé en dev pour éviter les caches
 * obsolètes pendant le HMR. L'échec d'enregistrement n'est pas bloquant.
 */
import { useEffect } from 'react';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // Non bloquant — l'app fonctionne sans SW.
    });
  }, []);
  return null;
}
