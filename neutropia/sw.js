// Minimal service worker. Its job is twofold: make the game installable at all (a PWA needs a
// registered worker with a fetch handler), and keep the shell instantly available offline.
//
// It deliberately does NOT pre-cache the Unity build. A WebGL build of this game runs to tens or
// hundreds of megabytes, and pre-caching that would stall the first load and can blow past a
// browser's storage quota outright. The build is left to normal HTTP caching, which handles large
// immutable files well; only the small shell is managed here.
const SHELL = "neutropia-shell-v3";
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

  const isShell = FILES.some(f => url.pathname.endsWith(f.replace('./', '')));
  const isNavigation = e.request.mode === 'navigate';

  // Everything else - above all the Build/*.unityweb payloads - goes straight to the network,
  // untouched. It used to run through here too, and the catch below then answered a failed wasm
  // fetch with the cached index.html: Unity's loader received an HTML page where it expected
  // WebAssembly and died with "failed to load", on a page that was in fact perfectly reachable.
  // A cache built for a small shell has no business standing in front of a 23MB binary.
  if (!isShell && !isNavigation) { return; }

  // Network first, so a redeployed build is never served stale; the cache is only the fallback for
  // when there is genuinely no network.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (isShell && res.ok) {
          const copy = res.clone();
          caches.open(SHELL).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(hit => hit || (isNavigation ? caches.match('./index.html') : Response.error())))
  );
});
