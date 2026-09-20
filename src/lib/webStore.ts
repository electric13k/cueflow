import { contentPath } from "./compress";
import { ensureCueflowCache } from "./cache";

/**
 * Where the website keeps a show's media when there is no account and no network.
 *
 * The native shell got a disk store so a venue with no internet could still make a noise. The
 * website had no equivalent: an import with no account became a `blob:` URL, which belongs to one
 * document and is gone the moment the tab reloads, so a show built offline in a browser was silent
 * the second time it was opened. This is the browser's half of the same idea, content-addressed the
 * same way under the same SHA-256 names, so a show packed on one and unpacked on the other is the
 * same show rather than a copy of it.
 *
 * Cache Storage rather than IndexedDB, and that choice is the whole design. A `Response` in a cache
 * can be served back by the service worker under a stable same-origin URL, so `track.url` stays an
 * ordinary string every `<audio>`, `<img>` and `<video>` in the app already knows how to use, and
 * the worker answers Range requests out of it so seeking works on Safari. An IndexedDB blob would
 * have to become a fresh `blob:` URL on every load, which means every consumer of `track.url` would
 * need to learn about this file. None of them do.
 *
 * This bucket is NOT `cueflow-media-v1`. That one mirrors files that also exist in the cloud and
 * `forgetOffline()` empties it to give space back. What is in here is frequently the only copy there
 * is, so nothing empties it except a sweep that has been told exactly what to keep.
 */

/** Pinned by `webStore.test.ts` against the copy in `public/sw.js`, which cannot import this file. */
export const ASSET_CACHE = "cueflow-assets-v1";

/** Under BASE_URL so the worker's scope covers it on GitHub Pages as well as at a domain root. */
const base = () => {
  const b = import.meta.env.BASE_URL || "/";
  return b.endsWith("/") ? b : `${b}/`;
};

export const ASSET_PATH = "cf-asset/";

export const webAssetUrl = (hash: string, ext: string) => `${base()}${ASSET_PATH}${hash}${ext ? `.${ext}` : ""}`;

/** 64 lowercase hex, the same shape the Rust side validates, so one rule describes both stores. */
const HASH = /([0-9a-f]{64})/;

/** Whether this URL names something in this store. Used to decide what a sweep may delete. */
export const isWebAssetUrl = (url: string) => url.includes(ASSET_PATH) && HASH.test(url);

/** The hash inside one of this store's URLs, or null. Lets a keep list be built from track rows. */
export function hashFromWebUrl(url: string): string | null {
  if (!url.includes(ASSET_PATH)) return null;
  const found = HASH.exec(url.split("?")[0]);
  return found ? found[1] : null;
}

const caches_ = (): CacheStorage | null => {
  try { return typeof caches === "undefined" ? null : caches; } catch { return null; }
};

export const canWebStore = () => caches_() !== null;

async function bucket(): Promise<Cache | null> {
  try { return (await caches_()?.open(ASSET_CACHE)) ?? null; } catch { return null; }
}

/**
 * Ask the browser not to evict this origin.
 *
 * Cache Storage is best-effort by default and a browser under disk pressure is entitled to throw the
 * whole bucket away. That is survivable for a mirror of files that also live in the cloud; it is a
 * deleted show for the files in here. Chrome grants this silently on a site the user has engaged
 * with, Firefox prompts, Safari ignores it. Never throws, and the answer is advisory: a refusal is
 * not a reason to stop storing, only a reason not to promise permanence.
 */
export async function askToPersist(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch { return false; }
}

/** The same name the cloud and the native store would give these bytes. Null without WebCrypto. */
async function hashOf(blob: Blob, ext: string): Promise<string | null> {
  const path = await contentPath(blob, ext ? `asset.${ext}` : "asset");
  if (!path) return null;
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export type Kept = { hash: string; url: string };

/**
 * Hold these bytes under their own hash and hand back a URL that will still work tomorrow.
 *
 * Returns null rather than throwing whenever that promise cannot be kept, and the caller falls back
 * to what it did before. The two ways it cannot be kept are worth naming. Without Cache Storage
 * there is nowhere to put it. Without a service worker controlling the page there is nothing to
 * serve the URL, so it would 404 on the next load, which is a worse failure than a `blob:` URL
 * because it looks like it worked. `ensureCueflowCache` registers on the spot and waits for the
 * worker to claim the page: an operator importing a file into a show is asking for it to be kept,
 * which is a clearer instruction than any cookie banner, so this does not consult one.
 */
export async function keepAssetWeb(blob: Blob, ext: string): Promise<Kept | null> {
  const store = await bucket();
  if (!store) return null;
  const hash = await hashOf(blob, ext);
  if (!hash) return null;
  if (!(await ensureCueflowCache())) return null;

  const url = webAssetUrl(hash, ext);
  try {
    if (await store.match(url)) return { hash, url };
    await store.put(url, new Response(blob, {
      headers: {
        "Content-Type": blob.type || "application/octet-stream",
        "Content-Length": String(blob.size),
        // Declared here so the worker can answer a Range request without a second lookup.
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    }));
  } catch { return null; }
  void askToPersist();
  return { hash, url };
}

/** The extension is not always known at read time; a scan of the bucket finds the entry anyway. */
async function matchByHash(store: Cache, hash: string): Promise<Response | undefined> {
  for (const request of await store.keys()) {
    if (request.url.includes(`${ASSET_PATH}${hash}`)) return (await store.match(request)) ?? undefined;
  }
  return undefined;
}

/** The bytes back out, for packing a show up to take somewhere else. */
export async function readWebAsset(hash: string, ext: string): Promise<Blob | null> {
  const store = await bucket();
  if (!store) return null;
  try {
    const held = (await store.match(webAssetUrl(hash, ext))) ?? (await matchByHash(store, hash));
    return held ? await held.blob() : null;
  } catch { return null; }
}

/** Every hash this store is holding, whatever extension it was stored under. */
export async function webAssetHashes(): Promise<string[]> {
  const store = await bucket();
  if (!store) return [];
  try {
    return [...new Set((await store.keys()).map(r => hashFromWebUrl(r.url)).filter((h): h is string => !!h))];
  } catch { return []; }
}

/**
 * What this store costs, so a settings screen can say it out loud.
 *
 * Every entry is read to get its length, because Cache Storage exposes no size. Fine for a screen
 * somebody opened on purpose, and it would not be fine on any hot path.
 */
export async function webStoreUsage(): Promise<{ assets: number; bytes: number }> {
  const store = await bucket();
  if (!store) return { assets: 0, bytes: 0 };
  try {
    const keys = await store.keys();
    let bytes = 0;
    for (const request of keys) {
      const held = await store.match(request);
      if (!held) continue;
      const declared = Number(held.headers.get("Content-Length"));
      bytes += Number.isFinite(declared) && declared > 0 ? declared : (await held.blob()).size;
    }
    return { assets: keys.length, bytes };
  } catch { return { assets: 0, bytes: 0 }; }
}

/**
 * Drop everything whose hash is not in `keep`.
 *
 * The keep list goes through exactly as given, the same contract as the native sweep: a caller that
 * hands over a short list has decided to delete the rest. `assetsInUseWeb` is the only thing that
 * should ever build one, and it errs heavily towards keeping.
 */
export async function sweepWebAssets(keep: string[]): Promise<{ removed: number; freed: number }> {
  const store = await bucket();
  if (!store) return { removed: 0, freed: 0 };
  const wanted = new Set(keep);
  let removed = 0, freed = 0;
  try {
    for (const request of await store.keys()) {
      const hash = hashFromWebUrl(request.url);
      if (!hash || wanted.has(hash)) continue;
      const held = await store.match(request);
      const size = held ? (Number(held.headers.get("Content-Length")) || (await held.blob()).size) : 0;
      if (await store.delete(request)) { removed++; freed += size; }
    }
  } catch { /* A bucket that will not enumerate has nothing to give back; report that as zero. */ }
  return { removed, freed };
}

/**
 * Every asset hash anything on this device still refers to.
 *
 * Deliberately blunt, for the reason the native version is: keeping a file nothing points at wastes
 * disk, and missing one that something does point at deletes a cue's sound, which is found out in
 * front of an audience. So every value in local storage is scanned for anything hash-shaped.
 */
export function assetsInUseWeb(): string[] {
  const found = new Set<string>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      for (const m of (localStorage.getItem(key) ?? "").matchAll(/[0-9a-f]{64}/g)) found.add(m[0]);
    }
  } catch { /* Storage can be refused outright; an empty list means keep everything, below. */ }
  return [...found];
}

/** Sweep everything nothing refers to. Refuses an empty list, which would delete the lot. */
export async function tidyWebAssets(): Promise<{ removed: number; freed: number }> {
  const keep = assetsInUseWeb();
  if (!keep.length) return { removed: 0, freed: 0 };
  return sweepWebAssets(keep);
}
