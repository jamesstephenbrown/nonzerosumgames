// Minimal service worker. Its job is twofold: make the game installable at all (a PWA needs a
// registered worker with a fetch handler), and keep the shell instantly available offline.
//
// It deliberately does NOT pre-cache the Unity build. A WebGL build of this game runs to tens or
// hundreds of megabytes, and pre-caching that would stall the first load and can blow past a
// browser's storage quota outright. The build is left to normal HTTP caching, which handles large
// immutable files well; only the small shell is managed here.
const SHELL = 'neutropia-shell-v1';
const FILES = ['./', './index.html', './manifest.webmanifest',
               './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') { return; }
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) { return; }

  // Network first, so a redeployed build is never served stale from the shell cache; the cache is
  // only the fallback for when there is no network at all.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (FILES.some(f => url.pathname.endsWith(f.replace('./', '')))) {
          const copy = res.clone();
          caches.open(SHELL).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html')))
  );
});
