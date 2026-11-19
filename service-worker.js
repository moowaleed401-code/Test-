/* Service worker — same-origin files only.
   Firebase, Cloudinary and Google Fonts stay under the browser's normal cache policy. */
const CACHE = 'anwar-shell-v20';
const SHELL = [
  './', './index.html', './admin.js', './firebase-app.js', './kiosk-app.js',
  './enhancements.css', './enhancements.js', './design-system.css',
  './reference-ui-migration.css', './manifest.webmanifest', './logo-fallback.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.all(SHELL.map(url => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isCacheable(response) {
  if (!response || !response.ok || response.status !== 200 || response.type !== 'basic') return false;
  const cacheControl = (response.headers.get('Cache-Control') || '').toLowerCase();
  return !/(?:no-store|private)/.test(cacheControl);
}

async function cacheResponse(request, response) {
  if (!isCacheable(response)) return;
  const cache = await caches.open(CACHE);
  const requestUrl = new URL(request.url);
  const keys = await cache.keys();
  await Promise.all(keys.filter(key => {
    const cachedUrl = new URL(key.url);
    return cachedUrl.pathname === requestUrl.pathname && cachedUrl.search !== requestUrl.search;
  }).map(key => cache.delete(key)));
  await cache.put(request, response.clone());
}

async function cachedResponse(request) {
  return (await caches.match(request)) ||
    (await caches.match(request, { ignoreSearch: true })) ||
    (await caches.match(new URL(request.url).pathname, { ignoreSearch: true }));
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/__/')) return; // Firebase Hosting reserved endpoints

  // Network-first: updates are used immediately; cache is the offline fallback.
  // Cache writes are awaited inside respondWith, avoiding late waitUntil() calls.
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      // A cache quota / storage failure must never hide a successful network response.
      try { await cacheResponse(request, response); } catch (cacheError) {
        // Keep the live response usable even when offline storage is unavailable.
      }
      return response;
    } catch (error) {
      return (await cachedResponse(request)) || Response.error();
    }
  })());
});
