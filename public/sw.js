const CACHE_NAME = "cueflow-shell-v5";
/**
 * Cue media the operator has asked to keep, filled by `lib/offline.ts` from the page rather than
 * here. Separate from the shell so clearing one does not throw away the other, and so a version
 * bump of the shell does not silently delete a show somebody prepared for tonight.
 */
const MEDIA_CACHE = "cueflow-media-v1";
const SHELL = ["./", "./index.html"];

/**
 * Uploaded audio lives on the storage host, which is a different origin, and this worker used to
 * return early on anything cross-origin. So the shell loaded offline and every cue was silent --
 * an app that opens perfectly and cannot make a noise, discovered at the worst possible moment.
 */
const isKeptMedia = url => /\/storage\/v1\/object\/public\//.test(url.pathname);

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
      // Only old shells. The media cache is the operator's, and is cleared from the app, never here.
      caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("cueflow-shell-") && key !== CACHE_NAME).map(key => caches.delete(key)))),
    ]).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET") return;

  // Cache first, and only from the media cache: these are immutable by URL (every upload gets a
  // fresh uuid), and during a show the held copy is the one to trust over a flaky connection.
  if (url.origin !== self.location.origin) {
    if (!isKeptMedia(url)) return;
    event.respondWith(
      caches.open(MEDIA_CACHE)
        .then(cache => cache.match(request))
        .then(held => held || fetch(request))
        .catch(() => fetch(request)),
    );
    return;
  }

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
