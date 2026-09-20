import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The store that lets a venue with no internet keep its show.
 *
 * Two halves are worth pinning. It has to answer safely in a plain browser, because one bundle is
 * served to the website and loaded by the native shell and a page that only works inside Tauri is a
 * page that breaks for everybody else. And the name it stores bytes under has to be the hash of
 * those bytes, because the Rust side refuses anything else and a mismatch would be an import that
 * dies on save in a room with nobody there to debug it.
 */

const invoke = vi.fn();
const convertFileSrc = vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`);
vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc }));

const asNative = () => { (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}; };
const asBrowser = () => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; };

beforeEach(() => { invoke.mockReset(); convertFileSrc.mockClear(); localStorage.clear(); asBrowser(); });
afterEach(asBrowser);

describe("in a plain browser", () => {
  it("answers empty and never throws, and never reaches for the native side", async () => {
    const store = await import("./nativeStore");
    expect(store.nativeStore()).toBe(false);
    expect(await store.keepAsset(new Blob(["x"]), "mp3")).toBeNull();
    expect(await store.assetUrl("a".repeat(64))).toBeNull();
    expect(await store.loadShowBundle("CF-K7QM2X")).toBeNull();
    expect(await store.listShowBundles()).toEqual([]);
    expect(await store.sweepAssets([])).toEqual({ removed: 0, freed: 0 });
    expect(await store.storeUsage()).toEqual({ shows: 0, assets: 0, bytes: 0 });
    await expect(store.saveShowBundle("CF-K7QM2X", { a: 1 })).resolves.toBeUndefined();
    await expect(store.deleteShowBundle("CF-K7QM2X")).resolves.toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("keeping an asset", () => {
  it("stores the bytes under their own hash", async () => {
    asNative();
    const store = await import("./nativeStore");
    invoke.mockResolvedValue("/data/assets/abc.mp3");

    const kept = await store.keepAsset(new Blob(["a cue"]), "mp3");

    expect(kept).not.toBeNull();
    const [name, args] = invoke.mock.calls[0] as [string, { hash: string; ext: string; bytes: number[] }];
    expect(name).toBe("store_put_asset");
    expect(args.ext).toBe("mp3");
    // 64 lowercase hex: the shape the Rust side validates before it will write anything.
    expect(args.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(args.bytes).toEqual([...new TextEncoder().encode("a cue")]);
    expect(kept!.hash).toBe(args.hash);
    // A path has to go through convertFileSrc; the webview cannot read a bare path.
    expect(convertFileSrc).toHaveBeenCalledWith("/data/assets/abc.mp3");
  });

  it("gives the same bytes the same name twice, which is what makes it deduplicate", async () => {
    asNative();
    const store = await import("./nativeStore");
    invoke.mockResolvedValue("/data/assets/abc.mp3");

    await store.keepAsset(new Blob(["same"]), "wav");
    await store.keepAsset(new Blob(["same"]), "wav");
    const first = (invoke.mock.calls[0][1] as { hash: string }).hash;
    const second = (invoke.mock.calls[1][1] as { hash: string }).hash;
    expect(first).toBe(second);
  });

  it("gives different bytes different names", async () => {
    asNative();
    const store = await import("./nativeStore");
    invoke.mockResolvedValue("/data/assets/abc.mp3");

    await store.keepAsset(new Blob(["one"]), "mp3");
    await store.keepAsset(new Blob(["two"]), "mp3");
    expect((invoke.mock.calls[0][1] as { hash: string }).hash)
      .not.toBe((invoke.mock.calls[1][1] as { hash: string }).hash);
  });

  it("wraps raw bytes in a blob url when the shell answers with bytes instead of a path", async () => {
    asNative();
    const store = await import("./nativeStore");
    invoke.mockResolvedValue([104, 105]);

    const kept = await store.keepAsset(new Blob(["hi"]), "mp3");
    expect(kept!.url.startsWith("blob:")).toBe(true);
    expect(convertFileSrc).not.toHaveBeenCalled();
  });
});

describe("reading a hash back out of a url", () => {
  it("recovers the hash this store wrote, and refuses anything else", async () => {
    const store = await import("./nativeStore");
    const hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(store.hashFromUrl(`asset://localhost/C:/data/assets/${hash}.mp3`)).toBe(hash);
    expect(store.hashFromUrl(`/home/sam/.local/share/app/assets/${hash}.wav?v=2`)).toBe(hash);
    // Without this there would be no way to ask which assets are still in use, so no way to sweep.
    expect(store.hashFromUrl("https://example.supabase.co/object/public/audio/public/thing.mp3")).toBeNull();
    expect(store.hashFromUrl("blob:http://localhost/1234")).toBeNull();
    expect(store.hashFromUrl(`asset://localhost/assets/${hash.toUpperCase()}.mp3`)).toBeNull();
  });
});

describe("the show bundle", () => {
  it("round trips through save and load", async () => {
    asNative();
    const store = await import("./nativeStore");
    const bundle = { show: { id: "CF-K7QM2X", name: "Macbeth" }, sequences: [{ id: "s1", items: [] }] };

    invoke.mockResolvedValueOnce(undefined);
    await store.saveShowBundle("CF-K7QM2X", bundle);
    const [name, args] = invoke.mock.calls[0] as [string, { id: string; json: string }];
    expect(name).toBe("store_save_show");
    expect(args.id).toBe("CF-K7QM2X");

    invoke.mockResolvedValueOnce(args.json);
    expect(await store.loadShowBundle("CF-K7QM2X")).toEqual(bundle);
  });

  it("treats a show that will not parse as absent rather than taking the screen down", async () => {
    asNative();
    const store = await import("./nativeStore");
    // What a power cut mid-write leaves behind, which is a realistic end to a night in a venue.
    invoke.mockResolvedValue("{\"show\":");
    expect(await store.loadShowBundle("CF-K7QM2X")).toBeNull();
  });
});

describe("sweeping", () => {
  it("passes the keep list straight through", async () => {
    asNative();
    const store = await import("./nativeStore");
    invoke.mockResolvedValue({ removed: 3, freed: 4096 });

    const keep = ["a".repeat(64), "b".repeat(64)];
    expect(await store.sweepAssets(keep)).toEqual({ removed: 3, freed: 4096 });
    expect(invoke).toHaveBeenCalledWith("store_sweep", { keep });
  });
});

describe("what a show machine is allowed to keep", () => {
  it("refuses an account key and clears one already there, but keeps the show", async () => {
    const { local } = await import("./store");

    localStorage.setItem("cueflow:session", JSON.stringify({ token: "left over from the web build" }));
    asNative();

    local.set("session", { token: "secret" });
    local.set("tour", { done: true });
    local.set("localShows", [{ id: "CF-K7QM2X" }]);
    local.set("sequences", [{ id: "s1" }]);

    // Nothing about an account survives on a machine three people have the password to, including
    // what an earlier build already wrote there.
    expect(localStorage.getItem("cueflow:session")).toBeNull();
    expect(localStorage.getItem("cueflow:tour")).toBeNull();
    // The show and its sequences are the whole point of the device.
    expect(local.get("localShows", [])).toEqual([{ id: "CF-K7QM2X" }]);
    expect(local.get("sequences", [])).toEqual([{ id: "s1" }]);
  });

  it("keeps everything on the website, where the same keys are how it works at all", async () => {
    const { local } = await import("./store");
    asBrowser();
    local.set("session", { token: "fine here" });
    expect(local.get<{ token: string } | null>("session", null)).toEqual({ token: "fine here" });
  });
});
