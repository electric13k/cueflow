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

/**
 * Opening the bucket can be refused outright rather than merely absent: Firefox private browsing,
 * a storage policy and a full disk all reject the promise. That used to reject out of every call
 * below, so the button span forever and nothing was ever said.
 */
async function openMedia(): Promise<CacheLike | null> {
  try { return (await store()?.open(MEDIA_CACHE)) ?? null; }
  catch { return null; }
}

/** Why files are missing, in the operator's terms, because "not ready" is not a diagnosis. */
const REASONS = {
  storage: "This device would not give CueFlow room to store them. Private browsing, a storage policy and a full disk all do this.",
  network: "They could not be reached. A dropped connection, or a storage host that refuses to serve this page, will do this.",
  server: "The storage host would not hand them over. An upload that has not finished, or a file that has since been removed, will do this.",
} as const;
type Cause = keyof typeof REASONS;
const quota = (error: unknown) => error instanceof Error && /quota|exceeded|space/i.test(`${error.name} ${error.message}`);

/** A `blob:` URL is this document's own memory and a `data:` one is already here. Neither is fetchable. */
export const keepable = (url: string) => /^https?:/i.test(url);

export type OfflineProgress = { done: number; total: number; url: string; ok: boolean };
export type OfflineResult = { stored: number; failed: string[]; reason?: string };

/**
 * Fetches every URL and holds it. Returns what could not be had, rather than throwing on the first
 * failure: one dead link in a library of forty should not stop the other thirty-nine being ready.
 *
 * `reason` says which of the three things went wrong, because every failure used to be reported as
 * an unfinished upload and a blocked cache, a CORS refusal and a dead network are not that.
 */
export async function keepOffline(urls: string[], onProgress?: (p: OfflineProgress) => void): Promise<OfflineResult> {
  const cache = await openMedia();
  const wanted = [...new Set(urls.filter(keepable))];
  if (!cache) return { stored: 0, failed: wanted, reason: REASONS.storage };

  const failed: string[] = [];
  const causes = new Set<Cause>();
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
        else causes.add("server");
      }
    } catch (error) { causes.add(quota(error) ? "storage" : "network"); }
    if (ok) stored += 1; else failed.push(url);
    onProgress?.({ done: stored + failed.length, total: wanted.length, url, ok });
  }
  if (stored) setOfflineWanted(true);
  // Worst first: a device that will not store anything is a different problem from one bad file.
  const cause = (["storage", "network", "server"] as const).find(c => causes.has(c));
  return { stored, failed, reason: cause && REASONS[cause] };
}

/** Which of these are already held, so the UI can say "31 of 34" rather than only "on" or "off". */
export async function offlineHave(urls: string[]): Promise<string[]> {
  const cache = await openMedia();
  if (!cache) return [];
  const wanted = [...new Set(urls.filter(keepable))];
  const held = await Promise.all(wanted.map(async url => {
    try { return (await cache.match(url)) ? url : null; } catch { return null; }
  }));
  return held.filter((url): url is string => url !== null);
}

/**
 * Gives the space back. Does not touch the app shell, which is small and always worth keeping.
 * Says whether it went, so the page cannot announce a clearance the browser refused.
 */
export async function forgetOffline(): Promise<boolean> {
  setOfflineWanted(false);
  try { await store()?.delete(MEDIA_CACHE); return true; }
  catch { return false; }
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
