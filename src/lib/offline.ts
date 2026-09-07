import { local } from "./store";

/**
 * Keeping a show playable with no network at all.
 *
 * The app shell has been cached for a while, so the page loads offline. The sounds never were: the
 * service worker only ever touched same-origin requests, and uploaded audio lives on the storage
 * host, which is a different origin. So an operator who lost the venue's wifi got a Studio that
 * opened perfectly and could not make a noise -- which is worse than one that plainly does not
 * start, because you find out at the wrong moment.
 *
 * This is the explicit half: the operator says "this show is going out, keep it on this device", and
 * every file it needs is fetched and held. Explicit rather than automatic, because a library can be
 * gigabytes and quietly filling somebody's phone is not a favour.
 */

export const MEDIA_CACHE = "cueflow-media-v1";
const WANTED = "offline";

/** Whether this device has been asked to hold media. Also what lets the worker register. */
export const offlineWanted = () => local.get<boolean>(WANTED, false);
export const setOfflineWanted = (on: boolean) => local.set(WANTED, on);

type CacheLike = {
  match: (request: RequestInfo) => Promise<Response | undefined>;
  put: (request: RequestInfo, response: Response) => Promise<void>;
  delete: (request: RequestInfo) => Promise<boolean>;
};
type CachesLike = { open: (name: string) => Promise<CacheLike>; delete: (name: string) => Promise<boolean> };

const store = (): CachesLike | null => {
  try { return typeof caches === "undefined" ? null : (caches as unknown as CachesLike); }
  catch { return null; }   // some embedded webviews throw on the getter rather than omitting it
};

export const canKeepOffline = () => store() !== null;

/** A `blob:` URL is this document's own memory and a `data:` one is already here. Neither is fetchable. */
export const keepable = (url: string) => /^https?:/i.test(url);

export type OfflineProgress = { done: number; total: number; url: string; ok: boolean };

/**
 * Fetches every URL and holds it. Returns what could not be had, rather than throwing on the first
 * failure: one dead link in a library of forty should not stop the other thirty-nine being ready.
 */
export async function keepOffline(urls: string[], onProgress?: (p: OfflineProgress) => void) {
  const cache = await store()?.open(MEDIA_CACHE);
  const wanted = [...new Set(urls.filter(keepable))];
  if (!cache) return { stored: 0, failed: wanted };

  const failed: string[] = [];
  let stored = 0;
  for (const url of wanted) {
    let ok = false;
    try {
      const held = await cache.match(url);
      if (held) ok = true;
      else {
        // `cors` rather than `no-cors`: an opaque response cannot be read back for its status, so a
        // 404 would be cached as if it were the file and the cue would fail silently on the night.
        const response = await fetch(url, { mode: "cors", credentials: "omit" });
        if (response.ok) { await cache.put(url, response.clone()); ok = true; }
      }
    } catch { ok = false; }
    if (ok) stored += 1; else failed.push(url);
    onProgress?.({ done: stored + failed.length, total: wanted.length, url, ok });
  }
  if (stored) setOfflineWanted(true);
  return { stored, failed };
}

/** Which of these are already held, so the UI can say "31 of 34" rather than only "on" or "off". */
export async function offlineHave(urls: string[]): Promise<string[]> {
  const cache = await store()?.open(MEDIA_CACHE);
  if (!cache) return [];
  const wanted = [...new Set(urls.filter(keepable))];
  const held = await Promise.all(wanted.map(async url => ((await cache.match(url)) ? url : null)));
  return held.filter((url): url is string => url !== null);
}

/** Gives the space back. Does not touch the app shell, which is small and always worth keeping. */
export async function forgetOffline() {
  setOfflineWanted(false);
  await store()?.delete(MEDIA_CACHE);
}

/**
 * Every file a set of sequences needs, and nothing else.
 *
 * Deliberately not "the whole library": the point is the show going out tonight, and a library holds
 * everything that was ever imported for anything.
 */
export function mediaForShow(
  sequences: { items: { trackId: string }[] }[],
  tracks: { id: string; url: string }[],
): string[] {
  const byId = new Map(tracks.map(track => [track.id, track.url]));
  const urls = sequences.flatMap(sequence => sequence.items.map(item => byId.get(item.trackId)));
  return [...new Set(urls.filter((url): url is string => !!url && keepable(url)))];
}
