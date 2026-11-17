// QIWAI Service Worker — cache shell tinh, API luon goi mang
const CACHE_NAME = 'qiwai-v39';
const SHELL = ['/', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // API: luon network, khong cache (du lieu song can real-time)
  if (url.pathname.startsWith('/api/')) return;

  // Trang HTML: network-first (luon lay ban moi nhat, cache chi la fallback offline)
  // Static khac: cache-first, fallback network
  if (e.request.mode === 'navigate') {
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(e.request);
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
          }
          return res;
        } catch (err) {
          return (await caches.match('/')) || Response.error();
        }
      })()
    );
    return;
  }
  e.respondWith(
    (async () => {
      const cached = await caches.match(e.request);
      if (cached) return cached;
      try {
        const res = await fetch(e.request);
        if (res.ok && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        }
        return res;
      } catch (err) {
        const fallback = await caches.match(e.request);
        return fallback || Response.error();
      }
    })()
  );
});
