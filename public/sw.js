// Kill-switch service worker.
// The previous drag-drop dashboard registered a service worker that aggressively cached the page.
// This replacement unregisters itself and wipes all caches, so the live site is never stale again.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (_) {}
    try {
      await self.registration.unregister();
    } catch (_) {}
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const c of clients) c.navigate(c.url);
    } catch (_) {}
  })());
});

self.addEventListener('fetch', (event) => {
  // Pass through to network — do NOT cache anything.
  event.respondWith(fetch(event.request));
});
