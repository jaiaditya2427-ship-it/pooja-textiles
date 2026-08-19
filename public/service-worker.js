// Bump this on every deploy that changes app code — it forces old
// caches (and the stale index.html/JS they hold) to be thrown away.
const CACHE_NAME = "pooja-textiles-v4";

const urlsToCache = [
  "/fashiontryon/poojatextiles/manifest.json",
  "/fashiontryon/poojatextiles/icon-192.png",
  "/fashiontryon/poojatextiles/icon-512.png"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );

  self.clients.claim();
});

// Network-first for everything: always try to fetch the latest version
// first (so new deploys show up immediately), and only fall back to the
// cache if the network request fails (e.g. offline).
self.addEventListener("fetch", (event) => {
  const req = event.request;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      })
      .catch(() => caches.match(req))
  );
});