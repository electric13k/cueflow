const CACHE_NAME = "cueflow-shell-v4";
const SHELL = ["./", "./index.html"];

const isCacheableAsset = url => url.origin === self.location.origin &&
  (url.pathname.includes("/assets/") || url.pathname.includes("/demo/") ||
    /\.(?:svg|png|jpg|jpeg|webp|gif|avif|woff2?|css|js)$/i.test(url.pathname));
const isImmutableAsset = url => url.pathname.includes("/assets/") || /\.(?:woff2?|avif|webp|png|jpg|jpeg|gif)$/i.test(url.pathname);

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    Promise.all([
      self.registration.navigationPreload?.enable?.().catch(() => undefined),
      caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("cueflow-shell-") && key !== CACHE_NAME).map(key => caches.delete(key)))),
    ]).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (event.preloadResponse || fetch(request)).then(response => {
        const copy = response.clone();
        void caches.open(CACHE_NAME).then(cache => cache.put("./index.html", copy));
        return response;
      }).catch(() => caches.match("./index.html")),
    );
    return;
  }

  if (!isCacheableAsset(url)) return;
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached && isImmutableAsset(url)) return cached;
      const fresh = fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      });
      return cached || fresh;
    }),
  );
});
