/* Service worker — caches ONLY this site's own public files (same origin).
   Cloudinary / Firebase / Google Fonts are cross-origin and are deliberately NOT touched here:
   the browser's normal HTTP cache handles them, and no CORS/caching policy was verified for opaque copies. */
const CACHE = 'anwar-shell-v5';
const SHELL = ['./', './index.html', './boot.js', './admin.js', './firebase-app.js', './kiosk-app.js', './admin-rail.css', './admin-rail.js', './hero-transition.css', './hero-transition.js', './manifest.webmanifest', './logo.png'];
const NETWORK_TIMEOUT_MS = 4000; // slow connection: fall back to the cached copy instead of waiting forever

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      // one missing optional file must not make the whole install fail
      .then(cache => Promise.all(SHELL.map(u => cache.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Never store anything the server marked private / no-store, or anything that is not a plain successful response.
function cacheable(res) {
  if (!res || !res.ok || res.status !== 200 || res.type !== 'basic') return false;
  const cc = (res.headers.get('Cache-Control') || '').toLowerCase();
  return !/no-store|private/.test(cc);
}

// Keep one entry per file: a new ?v=… replaces the old one instead of piling up release after release.
async function putFresh(req, res) {
  const cache = await caches.open(CACHE);
  const url = new URL(req.url);
  const old = await cache.keys();
  await Promise.all(old.filter(k => {
    const u = new URL(k.url);
    return u.pathname === url.pathname && u.search !== url.search;
  }).map(k => cache.delete(k)));
  await cache.put(req, res);
}

function networkFirst(req, event) {
  return new Promise(resolve => {
    let settled = false;
    const fromCache = () => caches.match(req, { ignoreSearch: false }).then(c => c || caches.match(new URL(req.url).pathname, { ignoreSearch: true }));
    const timer = setTimeout(() => {
      fromCache().then(c => { if (c && !settled) { settled = true; resolve(c); } });
    }, NETWORK_TIMEOUT_MS);
    fetch(req).then(res => {
      clearTimeout(timer);
      if (cacheable(res)) event.waitUntil(putFresh(req, res.clone()));
      if (!settled) { settled = true; resolve(res); }
    }).catch(() => {
      clearTimeout(timer);
      fromCache().then(c => { if (!settled) { settled = true; resolve(c || Response.error()); } });
    });
  });
}

function staleWhileRevalidate(req, event) {
  return caches.match(req).then(cached => {
    const network = fetch(req).then(res => {
      if (cacheable(res)) event.waitUntil(putFresh(req, res.clone()));
      return res;
    }).catch(() => cached);
    return cached || network;
  });
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;       // Cloudinary, Firebase, fonts: never cached here
  if (url.pathname.startsWith('/__/')) return;           // Firebase Hosting reserved paths (auth helpers)

  // App code: always try the network first so updates arrive; cached copy only when offline or very slow.
  const isAppFile = req.mode === 'navigate' || url.pathname.endsWith('/') || /\.(html|js|webmanifest)$/.test(url.pathname);
  event.respondWith(isAppFile ? networkFirst(req, event) : staleWhileRevalidate(req, event));
});
