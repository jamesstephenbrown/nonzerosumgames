// Minimal service worker. Its job is twofold: make the game installable at all (a PWA needs a
// registered worker with a fetch handler), and keep it available offline.
//
// It deliberately does NOT pre-cache the Unity build. A WebGL build of this game runs to tens of
// megabytes, and fetching that at install would stall the first load. Everything is network first,
// and what comes back is kept as the copy to fall back on when there is no network.
//
// ONE BUILD KEPT, NOT EVERY BUILD EVER (30 Sep). The test that was meant to keep the build out of here
// matched everything: './' stripped of './' is '', and every path ends with ''. So every build a player
// ever loaded was kept - about 25MB each, under one cache name, never let go - in the same storage the
// game's progress lives in, which a browser short of space may clear. Each build's files carry its
// stamp (?v=), so a stamped file coming in now clears out the files of every other stamp; and the cache
// has a new name, so the old one, with everything piled up in it, is emptied when this one activates.
const SHELL = 'neutropia-v5';
const FILES = ['./', './index.html', './manifest.webmanifest',
               './play/icon-192.png', './play/icon-512.png', './play/apple-touch-icon.png'];

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

// A build's file has come in: whatever is kept under any other build's stamp goes.
function keepOnly (cache, url) {
  const stamp = url.searchParams.get('v');
  if (!stamp) { return; }
  return cache.keys().then(keys => Promise.all(keys
    .filter(k => { const v = new URL(k.url).searchParams.get('v'); return v && v !== stamp; })
    .map(k => cache.delete(k))));
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') { return; }
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) { return; }
  // The game's update check (play/version.txt) has to reach the server, and there is nothing to keep.
  if (url.pathname.endsWith('/version.txt')) { return; }
  const isNavigation = e.request.mode === 'navigate';

  // Network first, so a redeployed build is never served stale; the cache is only the fallback for
  // when there is genuinely no network. A build file that is not kept is answered with an error, never
  // with a page: Unity's loader handed an HTML page where it expected WebAssembly dies with "failed to
  // load", on a page that was in fact perfectly reachable - which is what this once did.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL)
            .then(c => c.put(e.request, copy).then(() => keepOnly(c, url)))
            .catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(hit => hit || (isNavigation ? caches.match('./index.html') : Response.error())))
  );
});
