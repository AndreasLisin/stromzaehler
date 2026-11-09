// Stromzähler – Service Worker: App öffnet auch ohne Netz.
// API-Anfragen (workers.dev) werden NIE zwischengespeichert – Daten liegen nur in der App (IndexedDB) und im Backend.
const CACHE = 'stromzaehler-v1';
const APP = ['./', './index.html', './manifest.json', './icon-180.png', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];
const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(APP);
    try { await c.add(new Request(CDN, { mode: 'cors' })); } catch (_) { /* wird beim nächsten Laden nachgeholt */ }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.href === CDN) {
    // feste Version → Cache zuerst
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => { const cl = res.clone(); caches.open(CACHE).then((c) => c.put(req, cl)); return res; })));
    return;
  }
  if (url.origin !== self.location.origin) return; // API & alles Fremde: direkt ans Netz
  // eigene Dateien: Netz zuerst (damit Updates sofort ankommen), sonst Cache
  e.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) { const cl = res.clone(); caches.open(CACHE).then((c) => c.put(req, cl)); }
      return res;
    } catch (_) {
      return (await caches.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error());
    }
  })());
});
