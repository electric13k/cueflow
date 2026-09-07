import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetOffline, keepable, keepOffline, mediaForShow, MEDIA_CACHE, offlineHave, offlineWanted } from "./offline";

/** A CacheStorage that behaves like the real one for the three calls this module makes. */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const api = {
    open: async (name: string) => {
      const held = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, held);
      return {
        match: async (request: RequestInfo) => held.get(String(request)),
        put: async (request: RequestInfo, response: Response) => { held.set(String(request), response); },
        delete: async (request: RequestInfo) => held.delete(String(request)),
      };
    },
    delete: async (name: string) => stores.delete(name),
  };
  return { api, stores };
}

const ok = () => new Response("audio", { status: 200 });

beforeEach(() => {
  localStorage.clear();
  const { api } = fakeCaches();
  vi.stubGlobal("caches", api);
});
afterEach(() => vi.unstubAllGlobals());

describe("keepable", () => {
  it("takes a real URL", () => {
    expect(keepable("https://files.example/cue.mp3")).toBe(true);
    expect(keepable("http://files.example/cue.mp3")).toBe(true);
  });

  it("refuses what cannot be fetched later", () => {
    // A blob: URL is this document's own memory: it does not survive a reload, let alone an outage.
    expect(keepable("blob:https://app.example/9f2c")).toBe(false);
    expect(keepable("data:audio/wav;base64,AAAA")).toBe(false);
    expect(keepable("")).toBe(false);
  });
});

describe("mediaForShow", () => {
  const tracks = [
    { id: "a", url: "https://files.example/a.mp3" },
    { id: "b", url: "https://files.example/b.mp3" },
    { id: "c", url: "blob:https://app.example/pending" },
  ];

  it("collects what the sequences actually use, and nothing else", () => {
    const urls = mediaForShow([{ items: [{ trackId: "a" }] }], tracks);
    expect(urls).toEqual(["https://files.example/a.mp3"]);
  });

  it("asks for a file used twice only once", () => {
    const urls = mediaForShow([{ items: [{ trackId: "a" }, { trackId: "a" }] }], tracks);
    expect(urls).toHaveLength(1);
  });

  it("leaves out a cue whose upload has not finished", () => {
    expect(mediaForShow([{ items: [{ trackId: "c" }] }], tracks)).toEqual([]);
  });

  it("leaves out a cue whose track has gone", () => {
    expect(mediaForShow([{ items: [{ trackId: "missing" }] }], tracks)).toEqual([]);
  });
});

describe("keepOffline", () => {
  it("fetches and holds every file", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok()));
    const result = await keepOffline(["https://files.example/a.mp3", "https://files.example/b.mp3"]);
    expect(result).toEqual({ stored: 2, failed: [] });
    expect(await offlineHave(["https://files.example/a.mp3"])).toHaveLength(1);
  });

  it("does not fetch a file it already holds", async () => {
    const fetcher = vi.fn(async () => ok());
    vi.stubGlobal("fetch", fetcher);
    await keepOffline(["https://files.example/a.mp3"]);
    await keepOffline(["https://files.example/a.mp3"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps going past a file it cannot get", async () => {
    // One dead link in a library of forty must not stop the other thirty-nine being ready.
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      (url.includes("gone") ? new Response("", { status: 404 }) : ok())));
    const result = await keepOffline([
      "https://files.example/a.mp3",
      "https://files.example/gone.mp3",
      "https://files.example/b.mp3",
    ]);
    expect(result.stored).toBe(2);
    expect(result.failed).toEqual(["https://files.example/gone.mp3"]);
  });

  it("treats a network error as a failure rather than throwing at the caller", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline already"); }));
    const result = await keepOffline(["https://files.example/a.mp3"]);
    expect(result).toEqual({ stored: 0, failed: ["https://files.example/a.mp3"] });
  });

  it("never stores a 404 as if it were the file", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    await keepOffline(["https://files.example/a.mp3"]);
    expect(await offlineHave(["https://files.example/a.mp3"])).toEqual([]);
  });

  it("reports progress as it goes, so a long download is not a frozen button", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok()));
    const seen: number[] = [];
    await keepOffline(["https://files.example/a.mp3", "https://files.example/b.mp3"], p => seen.push(p.done));
    expect(seen).toEqual([1, 2]);
  });

  it("asks for each file once however many times it is listed", async () => {
    const fetcher = vi.fn(async () => ok());
    vi.stubGlobal("fetch", fetcher);
    const result = await keepOffline(["https://files.example/a.mp3", "https://files.example/a.mp3"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.stored).toBe(1);
  });

  it("remembers that this device wants to hold media", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok()));
    expect(offlineWanted()).toBe(false);
    await keepOffline(["https://files.example/a.mp3"]);
    expect(offlineWanted()).toBe(true);
  });

  it("does not claim to be ready when there is no cache at all", async () => {
    vi.stubGlobal("caches", undefined);
    const result = await keepOffline(["https://files.example/a.mp3"]);
    expect(result.stored).toBe(0);
    expect(result.failed).toHaveLength(1);
  });
});

describe("offlineHave", () => {
  it("reports which files are ready, so the count can be honest", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      (url.includes("b") ? new Response("", { status: 500 }) : ok())));
    const urls = ["https://files.example/a.mp3", "https://files.example/b.mp3"];
    await keepOffline(urls);
    expect(await offlineHave(urls)).toEqual(["https://files.example/a.mp3"]);
  });
});

describe("forgetOffline", () => {
  it("gives the space back", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok()));
    const urls = ["https://files.example/a.mp3"];
    await keepOffline(urls);
    await forgetOffline();
    expect(await offlineHave(urls)).toEqual([]);
    expect(offlineWanted()).toBe(false);
  });

  it("names one cache, so the app shell is not thrown away with the media", () => {
    expect(MEDIA_CACHE).not.toContain("shell");
  });
});
