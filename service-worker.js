const CACHE_NAME = "pooja-textiles-v2";

const urlsToCache = [
  "/fashiontryon/poojatextiles/",
  "/fashiontryon/poojatextiles/index.html",
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

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request);
    })
  );
});