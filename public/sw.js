const CACHE_NAME = "cueflow-shell-v5";
/**
 * Cue media the operator has asked to keep, filled by `lib/offline.ts` from the page rather than
 * here. Separate from the shell so clearing one does not throw away the other, and so a version
 * bump of the shell does not silently delete a show somebody prepared for tonight.
 *
 * This worker is served as a static file, so it cannot import the page's copy of the name. Bumping
 * one alone would leave this reading a bucket nobody fills, so `offline.test.ts` reads this line
 * and fails if the two ever differ.
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

/**
 * The cached copy, cut to the bytes the player asked for.
 *
 * `<audio crossorigin>` seeks with a Range header, and the Cache API matches on URL alone, so the
 * held entry comes back as a whole 200. Chromium tolerates that and refetches on every seek; Safari
 * and iOS reject any answer to a range request that is not a 206, so the file is on the device and
 * the cue still will not play, which is the exact failure this cache exists to prevent.
 */
async function slice(held, header) {
  const body = await held.arrayBuffer();
  const size = body.byteLength;
  const asked = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  const unsatisfiable = () => new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  if (!asked) return unsatisfiable();

  const [, from, to] = asked;
  // "bytes=-500" is the last 500 bytes, not a range starting at zero.
  const start = from === "" ? Math.max(0, size - Number(to)) : Number(from);
  const end = from === "" || to === "" ? size - 1 : Math.min(Number(to), size - 1);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= size) return unsatisfiable();

  const headers = new Headers(held.headers);
  headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  headers.set("Content-Length", String(end - start + 1));
  headers.set("Accept-Ranges", "bytes");
  return new Response(body.slice(start, end + 1), { status: 206, statusText: "Partial Content", headers });
}

async function serveMedia(request) {
  try {
    const cache = await caches.open(MEDIA_CACHE);
    // Matched by URL, not by the Request: the entry was stored from a plain fetch, and asking with
    // this request's own headers invites a miss on a header the player added.
    const held = await cache.match(request.url);
    if (held) {
      const range = request.headers.get("range");
      return range ? await slice(held, range) : held;
    }
  } catch {
    // A cache that cannot be read is no worse than one that has nothing: go to the network.
  }
  return fetch(request);
}

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET") return;

  // Cache first, and only from the media cache: these are immutable by URL (every upload gets a
  // fresh uuid), and during a show the held copy is the one to trust over a flaky connection.
  if (url.origin !== self.location.origin) {
    if (!isKeptMedia(url)) return;
    event.respondWith(serveMedia(request));
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
