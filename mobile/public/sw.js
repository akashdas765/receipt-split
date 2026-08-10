// Hand-rolled, minimal service worker — cache the app shell (index.html +
// the current build's hashed JS/CSS) for offline load and installability.
// No runtime caching strategy beyond that (no API response caching, no
// image caching) — deliberately narrow scope, matching this codebase's
// preference for small hand-rolled solutions over a full Workbox setup
// (see src/utils/pdfjsLoader.js, shared/verifyFirebaseToken.js for the
// same pattern elsewhere).
//
// IMPORTANT: bump CACHE_NAME on any deploy that should invalidate the old
// cache. This is a manual step — there's no build-time versioning wired up.
//
// IMPORTANT: once registered, a service worker keeps running across tab
// closes/reopens until explicitly replaced. Removing this feature later
// requires shipping a sw.js that unregisters itself (self.registration.
// unregister()), not just deleting this file — deleting it server-side does
// not un-register it from browsers that already have it installed.
const CACHE_NAME = 'receiptsplit-shell-v1';

const SHELL_URLS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for navigation requests, so a logged-in user always gets the
// latest index.html when online — critical because index.html references
// the *current* build's hashed asset filenames; serving a stale cached
// index.html would point at hashes the server no longer has. Falls back to
// the cached shell only when offline.
//
// Everything else (hashed JS/CSS/assets) is cache-first, which is safe
// specifically because Vite content-hashes filenames per build: a cached
// /assets/index-abc123.js is either byte-identical to what the server would
// return, or belongs to an index.html that's no longer served (in which
// case the network-first navigation above already fetched a new
// index.html with new hashed filenames, so the old asset is never
// requested again).
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html'))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
