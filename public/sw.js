/* global self, caches, clients */

// System A — Service Worker.
//
// Deux rôles :
//   1. Cache des assets statiques (next/static, /brand/*) pour des chargements
//      rapides après installation. Pas de file d'attente offline pour les
//      mutations (les ventes et encaissements exigent le serveur).
//
//   2. Push notifications (Web Push API) — affichage des notifications
//      reçues du serveur (nouvelle réservation, demande client…), avec
//      ouverture du lien associé au clic.
//
// Stratégie : cache-first pour les statiques, network pour le reste.

const CACHE_VERSION = 'sa-v2'; // bump après ajout du handler push
const STATIC_CACHE = CACHE_VERSION + '-static';

self.addEventListener('install', () => {
  // Active immédiatement la nouvelle version du SW.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.indexOf(CACHE_VERSION) !== 0).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Cache-first uniquement pour les assets statiques.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/brand/')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).then((networkResponse) => {
            if (networkResponse.ok) cache.put(request, networkResponse.clone());
            return networkResponse;
          });
        }),
      ),
    );
  }
});

// ── Push notifications ──────────────────────────────────────────────────────
//
// Le serveur envoie un payload JSON `{ title, body, url?, icon?, tag? }`.
// On affiche la notification ; le clic ouvre `url` (ou le manager par défaut).

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'System A', body: event.data.text() };
  }

  const title = payload.title || 'System A';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/brand/icon-192.png',
    badge: payload.badge || '/brand/icon-192.png',
    tag: payload.tag || 'system-a',
    data: { url: payload.url || '/' },
    // requireInteraction false → notification se ferme seule (UX moins agressif)
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      // Si un onglet existe déjà sur ce salon → focus, sinon nouvelle fenêtre.
      const existing = wins.find((w) => w.url.indexOf(self.location.origin) === 0);
      if (existing) {
        return existing.focus().then(() => existing.navigate(targetUrl).catch(() => {}));
      }
      return clients.openWindow(targetUrl);
    }),
  );
});
