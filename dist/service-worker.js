// Bump this on every deploy that changes app code — it forces old
// caches (and the stale index.html/JS they hold) to be thrown away.
const CACHE_NAME = "pooja-textiles-v3";

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

// Network-first for navigation/HTML/JS/CSS: always try to fetch the latest
// version first (so new deploys show up immediately), and only fall back to
// the cache if the network request fails (e.g. offline). This is what was
// missing before — the old "cache-first" strategy meant returning users kept
// getting a permanently stale index.html + JS bundle no matter how many times
// the app was redeployed.
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