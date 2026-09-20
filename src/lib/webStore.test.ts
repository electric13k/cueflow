import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The store that lets a show built in a browser survive the browser being closed.
 *
 * Two things are worth pinning hard. The name a file is stored under has to be the SHA-256 of its
 * own bytes, because that is what makes the same sound one file across the website, the native
 * disk store and a packed show; and the bucket name has to match the one in `public/sw.js`, which
 * is a static file that cannot import this module. A drift in either is silent: the import looks
 * like it worked and the cue is quiet on the next load.
 */

const ensureCueflowCache = vi.fn(async () => true);
vi.mock("./cache", () => ({ ensureCueflowCache, registerCueflowCache: () => undefined, cacheVersion: "test" }));

/** Enough of Cache Storage to be honest about it: keyed by URL string, holding real Responses. */
class FakeCache {
  store = new Map<string, Response>();
  async match(request: RequestInfo) {
    const url = typeof request === "string" ? request : (request as Request).url;
    const held = this.store.get(url);
    return held ? held.clone() : undefined;
  }
  async put(request: RequestInfo, response: Response) {
    this.store.set(typeof request === "string" ? request : (request as Request).url, response);
  }
  async delete(request: RequestInfo) {
    return this.store.delete(typeof request === "string" ? request : (request as Request).url);
  }
  async keys() {
    return [...this.store.keys()].map(url => ({ url }) as Request);
  }
}

let buckets: Map<string, FakeCache>;

const installCaches = () => {
  buckets = new Map();
  (globalThis as unknown as { caches: unknown }).caches = {
    open: async (name: string) => {
      if (!buckets.has(name)) buckets.set(name, new FakeCache());
      return buckets.get(name)!;
    },
    delete: async (name: string) => buckets.delete(name),
  };
};

beforeEach(() => {
  localStorage.clear();
  ensureCueflowCache.mockReset();
  ensureCueflowCache.mockResolvedValue(true);
  installCaches();
});

describe("the bucket name", () => {
  it("is the same string the service worker reads, which cannot import it", async () => {
    const { ASSET_CACHE } = await import("./webStore");
    const worker = readFileSync("public/sw.js", "utf8");
    expect(worker).toContain(`const ASSET_CACHE = "${ASSET_CACHE}";`);
  });

  it("uses the same path prefix the worker intercepts", async () => {
    const { ASSET_PATH } = await import("./webStore");
    const worker = readFileSync("public/sw.js", "utf8");
    expect(worker).toContain(`const ASSET_PATH = "${ASSET_PATH}";`);
  });

  it("is not the media cache, which is emptied to give space back", async () => {
    const { ASSET_CACHE } = await import("./webStore");
    const { MEDIA_CACHE } = await import("./offline");
    // If these were ever the same bucket, "free up space" would delete the only copy of a show's
    // audio, which is the failure this separation exists to prevent.
    expect(ASSET_CACHE).not.toBe(MEDIA_CACHE);
  });
});

describe("keeping a file", () => {
  it("stores it under the hash of its own bytes and hands back a stable URL", async () => {
    const { keepAssetWeb, ASSET_PATH } = await import("./webStore");
    const kept = await keepAssetWeb(new Blob(["a cue"], { type: "audio/mpeg" }), "mp3");

    expect(kept).not.toBeNull();
    expect(kept!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(kept!.url).toContain(ASSET_PATH);
    expect(kept!.url.endsWith(`${kept!.hash}.mp3`)).toBe(true);
    // Not a blob: URL. That is the whole point: a blob URL belongs to one document and dies with it.
    expect(kept!.url.startsWith("blob:")).toBe(false);
  });

  it("gives the same bytes the same name twice, which is what deduplicates", async () => {
    const { keepAssetWeb } = await import("./webStore");
    const first = await keepAssetWeb(new Blob(["same"]), "wav");
    const second = await keepAssetWeb(new Blob(["same"]), "wav");
    expect(first!.hash).toBe(second!.hash);
    expect(await (await import("./webStore")).webAssetHashes()).toEqual([first!.hash]);
  });

  it("gives different bytes different names", async () => {
    const { keepAssetWeb } = await import("./webStore");
    const a = await keepAssetWeb(new Blob(["one"]), "mp3");
    const b = await keepAssetWeb(new Blob(["two"]), "mp3");
    expect(a!.hash).not.toBe(b!.hash);
  });

  it("reads the bytes back out, which is what packing a show up needs", async () => {
    const { keepAssetWeb, readWebAsset } = await import("./webStore");
    const kept = await keepAssetWeb(new Blob(["horn"]), "flac");
    expect(await (await readWebAsset(kept!.hash, "flac"))!.text()).toBe("horn");
    // The extension is not always known at read time, and the entry should still be found.
    expect(await (await readWebAsset(kept!.hash, "wav"))!.text()).toBe("horn");
  });

  it("refuses rather than promising, when no worker will be there to serve the URL", async () => {
    // A URL nothing answers 404s on the next load, which looks like a working import today and a
    // broken show tomorrow. Answering null sends the caller back to what it did before.
    ensureCueflowCache.mockResolvedValue(false);
    const { keepAssetWeb } = await import("./webStore");
    expect(await keepAssetWeb(new Blob(["x"]), "mp3")).toBeNull();
  });

  it("answers null instead of throwing where there is no Cache Storage at all", async () => {
    delete (globalThis as unknown as { caches?: unknown }).caches;
    const { keepAssetWeb, readWebAsset, webStoreUsage, canWebStore } = await import("./webStore");
    expect(canWebStore()).toBe(false);
    expect(await keepAssetWeb(new Blob(["x"]), "mp3")).toBeNull();
    expect(await readWebAsset("a".repeat(64), "mp3")).toBeNull();
    expect(await webStoreUsage()).toEqual({ assets: 0, bytes: 0 });
  });
});

describe("reading a hash out of a URL", () => {
  it("recovers what this store wrote and refuses everything else", async () => {
    const { hashFromWebUrl, isWebAssetUrl } = await import("./webStore");
    const hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(hashFromWebUrl(`/cf-asset/${hash}.mp3`)).toBe(hash);
    expect(hashFromWebUrl(`/cueflow/cf-asset/${hash}.wav?v=2`)).toBe(hash);
    expect(isWebAssetUrl(`/cf-asset/${hash}.mp3`)).toBe(true);
    expect(hashFromWebUrl("https://example.supabase.co/object/public/audio/public/thing.mp3")).toBeNull();
    expect(hashFromWebUrl("blob:http://localhost/1234")).toBeNull();
    expect(hashFromWebUrl(`/cf-asset/${hash.toUpperCase()}.mp3`)).toBeNull();
  });
});

describe("sweeping", () => {
  it("keeps what is named and drops what is not", async () => {
    const { keepAssetWeb, sweepWebAssets, webAssetHashes } = await import("./webStore");
    const keep = await keepAssetWeb(new Blob(["needed"]), "mp3");
    const drop = await keepAssetWeb(new Blob(["orphan"]), "mp3");

    const { removed, freed } = await sweepWebAssets([keep!.hash]);
    expect(removed).toBe(1);
    expect(freed).toBe(6);
    expect(await webAssetHashes()).toEqual([keep!.hash]);
    expect(drop!.hash).not.toBe(keep!.hash);
  });

  it("refuses to sweep when nothing on the device names anything, rather than deleting the lot", async () => {
    const { keepAssetWeb, tidyWebAssets, webAssetHashes } = await import("./webStore");
    const kept = await keepAssetWeb(new Blob(["only copy"]), "mp3");
    // An empty keep list means the scan found no references, and the two explanations for that are
    // "nothing is in use" and "storage would not answer". Only one of them is safe to act on.
    expect(await tidyWebAssets()).toEqual({ removed: 0, freed: 0 });
    expect(await webAssetHashes()).toEqual([kept!.hash]);
  });

  it("finds a hash anywhere on the device, not only where a track row would put one", async () => {
    const { keepAssetWeb, assetsInUseWeb, tidyWebAssets, webAssetHashes } = await import("./webStore");
    const used = await keepAssetWeb(new Blob(["in a cue"]), "mp3");
    const stray = await keepAssetWeb(new Blob(["nothing points here"]), "mp3");
    // Deliberately somewhere nobody would think to walk: a draft, a stage, a key added next month.
    localStorage.setItem("cueflow:something-nobody-listed", JSON.stringify({ deep: { at: `${used!.hash}.mp3` } }));

    expect(assetsInUseWeb()).toContain(used!.hash);
    expect(await tidyWebAssets()).toEqual({ removed: 1, freed: 19 });
    expect(await webAssetHashes()).toEqual([used!.hash]);
    expect(stray!.hash).not.toBe(used!.hash);
  });
});

describe("what it costs", () => {
  it("counts the files and their bytes", async () => {
    const { keepAssetWeb, webStoreUsage } = await import("./webStore");
    await keepAssetWeb(new Blob(["12345"]), "mp3");
    await keepAssetWeb(new Blob(["1234567890"]), "png");
    expect(await webStoreUsage()).toEqual({ assets: 2, bytes: 15 });
  });
});
