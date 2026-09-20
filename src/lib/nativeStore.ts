import { contentPath } from "./compress";

/**
 * Where the offline app keeps a show.
 *
 * The native shell exists so a venue with no internet can run its show, and until this file it had
 * no way to keep one. `uploadTrack` gave every import either a `blob:` URL, which belongs to one
 * document and is gone the moment the window reloads, or a Supabase Storage `https:` URL, which is
 * a name for bytes sitting on the far side of the connection the venue does not have. Either way
 * the app opened with a full cue list and no sound, which is the one failure it was built to
 * prevent.
 *
 * What the store holds is exactly the show, the sequences and the assets. No account, no session,
 * no cached library, no counters: a front-of-house machine is shared and often not the operator's,
 * so anything kept on it that is not needed to call cues is something somebody else can read.
 *
 * Every function here answers safely in a browser rather than throwing. The same bundle is served
 * to the website and loaded by the native shell, so a page that only works inside Tauri is a page
 * that breaks for everyone else.
 */

/**
 * Whether there is a Rust side to talk to at all.
 *
 * The injected global rather than a build flag, because one bundle serves both. The same test
 * `transports/native.ts` makes, for the same reason.
 */
export const nativeStore = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Imported here and never at module scope. A static import puts the Tauri API into the website
 * bundle, where nothing can call it and `__TAURI_INTERNALS__` is never there to begin with.
 */
const core = () => import("@tauri-apps/api/core");

/**
 * The name these bytes are stored under.
 *
 * `contentPath` is reused rather than reimplemented because the Rust side hashes what it is handed
 * and refuses to write it under a name that does not match. Two SHA-256 implementations that agree
 * today are two that can disagree after one of them is touched, and that failure would be an import
 * that dies on save in a venue with nobody there to debug it. Null where `crypto.subtle` is
 * missing: a file that cannot be named cannot be content-addressed, and the caller falls back.
 */
const hashOf = async (file: Blob, ext: string): Promise<string | null> => {
  const path = await contentPath(file, ext ? `asset.${ext}` : "asset");
  if (!path) return null;
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
};

/** The storage path for a hash, spelled exactly as the cloud path spells it for the same bytes. */
export const assetPath = (hash: string, ext: string) => `public/${hash}${ext ? `.${ext}` : ""}`;

/**
 * Blob URLs built from bytes the Rust side handed back, one per hash.
 *
 * Only reached when a shell answers with bytes instead of a path, which is what a build without the
 * asset protocol has to do. Cached because one cue can fire twenty times a night, and re-reading a
 * 40 MB file off disk for each of them shows up as a late cue rather than as an error.
 * `revokeObjectURL` is deliberately never called: the URL has to stay good for as long as a cue can
 * still point at it, which is the life of the document.
 */
const blobUrls = new Map<string, string>();

/**
 * A URL that a `src` attribute can use, out of whatever the command answered with.
 *
 * A string is a path and goes through `convertFileSrc`, which is the only way the webview is
 * allowed to read a file off disk. An array is raw bytes, from a shell without that protocol.
 */
const toUrl = async (hash: string, reply: unknown): Promise<string | null> => {
  if (typeof reply === "string" && reply) {
    const { convertFileSrc } = await core();
    return convertFileSrc(reply);
  }
  if (Array.isArray(reply)) {
    const cached = blobUrls.get(hash);
    if (cached) return cached;
    const url = URL.createObjectURL(new Blob([new Uint8Array(reply as number[])]));
    blobUrls.set(hash, url);
    return url;
  }
  return null;
};

/**
 * Keep a file on this machine and say where it plays from now.
 *
 * Null in a browser and null where the bytes cannot be hashed, so the caller falls through to what
 * it did before rather than having to handle a half-kept file. A failure from the Rust side is
 * allowed to throw: the file was not written, and returning a URL for it would put a silent hole in
 * the show where a sound used to be.
 */
export async function keepAsset(file: Blob, ext: string): Promise<{ hash: string; url: string } | null> {
  if (!nativeStore()) return null;
  const hash = await hashOf(file, ext);
  if (!hash) return null;
  const bytes = [...new Uint8Array(await file.arrayBuffer())];
  const { invoke } = await core();
  const reply = await invoke<unknown>("store_put_asset", { hash, ext, bytes });
  const url = await toUrl(hash, reply);
  return url ? { hash, url } : null;
}

/**
 * The hash back out of a URL this store handed over.
 *
 * A `Track` carries a `url` and nothing else that survives a reload, so without this there is no
 * way to ask which assets a library still points at, and no way to sweep the rest. Reading it back
 * out of the name is possible only because the name is the hash: the same property that makes the
 * store deduplicate is the one that makes it tidy up. Null for any URL this store did not write.
 */
export function hashFromUrl(url: string): string | null {
  const name = url.split(/[?#]/)[0].split(/[/\\]/).pop() ?? "";
  const hash = name.slice(0, name.lastIndexOf(".") > 0 ? name.lastIndexOf(".") : undefined);
  return /^[0-9a-f]{64}$/.test(hash) ? hash : null;
}

/** Where a hash plays from now, or null when this machine does not have those bytes. */
export async function assetUrl(hash: string): Promise<string | null> {
  if (!nativeStore()) return null;
  const cached = blobUrls.get(hash);
  if (cached) return cached;
  try {
    const { invoke } = await core();
    return await toUrl(hash, await invoke<unknown>("store_asset_url", { hash }));
  } catch {
    // The command is missing, or the shell is older than this bundle. Not having the file is an
    // answer, and it is the same one the caller gets for a sound that was never imported here.
    return null;
  }
}

/**
 * The show and its sequences, written as one document.
 *
 * JSON rather than a shape the Rust side also has to know, because the show gains a field with
 * every feature and a store that has to be migrated in two languages at once is a store that stops
 * agreeing with itself. Rust holds the bytes; this file holds what they mean.
 */
export async function saveShowBundle(id: string, bundle: unknown): Promise<void> {
  if (!nativeStore()) return;
  const { invoke } = await core();
  await invoke("store_save_show", { id, json: JSON.stringify(bundle) });
}

export async function loadShowBundle<T>(id: string): Promise<T | null> {
  if (!nativeStore()) return null;
  try {
    const { invoke } = await core();
    const json = await invoke<string | null>("store_load_show", { id });
    return json ? (JSON.parse(json) as T) : null;
  } catch (error) {
    // A show that will not parse is one a power cut caught mid-write, which is a realistic end to a
    // night in a venue. Reported and treated as absent, because throwing takes down the screen that
    // would have let the operator open a different one.
    console.warn("[store] a saved show would not load", error);
    return null;
  }
}

export async function listShowBundles(): Promise<string[]> {
  if (!nativeStore()) return [];
  try {
    const { invoke } = await core();
    return (await invoke<string[]>("store_list_shows")) ?? [];
  } catch {
    return [];
  }
}

export async function deleteShowBundle(id: string): Promise<void> {
  if (!nativeStore()) return;
  const { invoke } = await core();
  await invoke("store_delete_show", { id });
}

/**
 * Drop every asset no show still points at.
 *
 * The keep list goes through exactly as given. Working out what is still in use needs the library
 * and the sequences, which this file has no business reading, so a caller that hands over a short
 * list has decided to delete the rest and nothing here second-guesses it.
 */
export async function sweepAssets(keep: string[]): Promise<{ removed: number; freed: number }> {
  if (!nativeStore()) return { removed: 0, freed: 0 };
  const { invoke } = await core();
  return await invoke<{ removed: number; freed: number }>("store_sweep", { keep });
}

/** What the store costs this machine, for a screen that offers to give some of it back. */
export async function storeUsage(): Promise<{ shows: number; assets: number; bytes: number }> {
  const empty = { shows: 0, assets: 0, bytes: 0 };
  if (!nativeStore()) return empty;
  try {
    const { invoke } = await core();
    return (await invoke<{ shows: number; assets: number; bytes: number }>("store_usage")) ?? empty;
  } catch {
    return empty;
  }
}
