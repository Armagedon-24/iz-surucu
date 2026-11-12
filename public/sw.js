/* İzSürücü service worker — uygulama kabuğu çevrimdışı da açılsın.
 *
 * Strateji:
 *  - /_next/static/* (hash'li, değişmez) → cache-first
 *  - gezinmeler (sayfa)                  → network-first, düşerse önbellekteki kabuk
 *  - /api/*                              → her zaman ağ (asla önbelleklenmez)
 *  - diğer same-origin GET (ikon, font)  → stale-while-revalidate
 */
const VERSION = 'izsurucu-v1';
const CORE = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/logo.png',
  '/logo.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || network;
}

async function networkFirstShell(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put('/', res.clone());
    return res;
  } catch {
    return (await cache.match(req)) || (await cache.match('/')) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST/PUT (AI analizi vb.) doğrudan ağa
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // analiz uçları her zaman ağ

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(networkFirstShell(req));
    return;
  }
  event.respondWith(staleWhileRevalidate(req));
});
