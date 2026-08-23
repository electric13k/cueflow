const CACHE_NAME = "cueflow-shell-v5";
const SHELL = ["./", "./index.html"];

const isCacheableAsset = url => url.origin === self.location.origin &&
  (url.pathname.includes("/assets/") || url.pathname.includes("/demo/") ||
    /\.(?:svg|png|jpg|jpeg|webp|gif|avif|woff2?|css|js|mp3|wav|ogg|m4a|mp4|webm)$/i.test(url.pathname));
const isImmutableAsset = url => url.pathname.includes("/assets/") || /\.(?:woff2?|avif|webp|gif)$/i.test(url.pathname);
const put = (request, response) => {
  if (!response || !response.ok) return response;
  void caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
  return response;
};

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
      (event.preloadResponse || fetch(request)).then(response => put("./index.html", response)).catch(() => caches.match("./index.html")),
    );
    return;
  }

  if (!isCacheableAsset(url)) return;
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached && isImmutableAsset(url)) return cached;
      const fresh = fetch(request).then(response => put(request, response));
      if (!cached) return fresh;
      event.waitUntil(fresh.catch(() => undefined));
      return cached;
    }),
  );
});
