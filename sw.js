/* Narrative Forge service worker — offline app shell.
   GitHub API calls always go to the network (never cached). */
const CACHE = "narrative-forge-v3";
const SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./manifest.webmanifest",
  "./js/app.js",
  "./js/util.js",
  "./js/store.js",
  "./js/github.js",
  "./js/dialogue.js",
  "./js/map.js",
  "./js/tree.js",
  "./js/quests.js",
  "./js/docs.js",
  "./js/validate.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./sample-data/index.json",
  "./sample-data/deepmark_duergars_maren.json",
  "./sample-data/deepmark_duergars_florian.json",
  "./sample-data/custom_quests.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Never intercept API / cross-origin writes — always live.
  if (url.hostname.endsWith("github.com") || url.hostname.endsWith("githubusercontent.com")) {
    return; // default network handling
  }
  if (e.request.method !== "GET") return;

  // Same-origin app assets: cache-first, fall back to network, then refresh cache.
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const network = fetch(e.request)
        .then((resp) => {
          if (resp && resp.ok && url.origin === self.location.origin) {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
