/*
 * OLIU tips — service worker. Keeps the tip page usable with no signal: every page and script it has fetched once is
 * kept, and served when the network fails. API calls are never cached here (the tip screen keeps its own list in
 * localStorage, and the outbox holds what could not be sent). Bump CACHE when the caching rules change.
 */
const CACHE = 'oliu-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/dev/') ||
    url.pathname.startsWith('/__dev/')
  )
    return;
  // Network first; the copy kept last time when the network fails. A navigation with nothing kept falls back to /tip.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches
            .open(CACHE)
            .then((c) => c.put(req, copy))
            .catch(() => undefined);
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        if (req.mode === 'navigate') {
          const tip = await caches.match('/tip');
          if (tip) return tip;
        }
        return new Response(
          'No connection and nothing kept yet. Open this page once with signal.',
          { status: 503, headers: { 'content-type': 'text/plain' } },
        );
      }),
  );
});
