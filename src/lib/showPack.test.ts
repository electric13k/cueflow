import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sequence, Track } from "../types";
import type { Role, Show } from "./shows";

/**
 * A show leaving this app and arriving on another device.
 *
 * What these pin is the promise the feature makes: the file carries everything, and the job it was
 * cut for is the job the other device gets. The dangerous failures are quiet ones, so they are
 * tested by name: an import that overwrites a show already on the device, an import that replaces a
 * script somebody has been marking up, an asset that did not come with the file and is reported as
 * missing rather than turning into a cue that is silently dead.
 */

/** Where the fake device puts bytes. Stands in for both the native disk and the browser bucket. */
let here: Map<string, Blob>;
/** What `fetch` can reach, standing in for storage hosts and for the two local stores. */
let network: Map<string, Blob>;

const keepAssetWeb = vi.fn(async (blob: Blob, ext: string) => {
  const hash = await sha(blob);
  const url = `/cf-asset/${hash}.${ext}`;
  here.set(url, blob);
  network.set(url, blob);
  return { hash, url };
});

vi.mock("./webStore", () => ({
  keepAssetWeb: (blob: Blob, ext: string) => keepAssetWeb(blob, ext),
  readWebAsset: async () => null,
}));
vi.mock("./nativeStore", () => ({
  nativeStore: () => false,
  keepAsset: async () => null,
  saveShowBundle: async () => undefined,
  loadShowBundle: async () => null,
  listShowBundles: async () => [],
  deleteShowBundle: async () => undefined,
}));

async function sha(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

const show = (over: Partial<Show> = {}): Show =>
  ({ id: "CF-K7QM2X", name: "Macbeth", password: "CF-K7QM2X", sequenceId: "seq-1", startedAt: null, owner: null, ...over });

const roles = (): Role[] => [
  { id: "r1", name: "Controller", perms: ["cues", "script", "stage", "fire", "edit", "message"], code: "AAA111" },
  { id: "r2", name: "Display", perms: ["stage", "play"], code: "BBB222" },
];

const track = (id: string, url: string): Track =>
  ({ id, title: `Cue ${id}`, url, kind: "audio", effects: {} as Track["effects"], createdAt: "2026-01-01T00:00:00.000Z" });

const sequence = (ids: string[]): Sequence => ({
  id: "seq-1",
  name: "Act one",
  items: ids.map(id => ({ id: `i-${id}`, trackId: id, label: id, effects: {} as Track["effects"] })),
  createdAt: "2026-01-01T00:00:00.000Z",
});

beforeEach(() => {
  localStorage.clear();
  here = new Map();
  network = new Map();
  keepAssetWeb.mockClear();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    const held = network.get(url);
    return held
      ? new Response(held, { status: 200 })
      : new Response(null, { status: 404 });
  });
});

/** A show on the fake device, packed with the role asked for. */
async function packed(role: "host" | "Display" = "host", over: { urls?: Record<string, string> } = {}) {
  const { exportChoices, packShow } = await import("./showPack");
  const urls = over.urls ?? {
    t1: "https://example.supabase.co/object/public/audio/public/one.mp3",
    t2: "https://example.supabase.co/object/public/audio/public/two.wav",
  };
  network.set(urls.t1, new Blob(["thunder"], { type: "audio/mpeg" }));
  if (urls.t2) network.set(urls.t2, new Blob(["knocking"], { type: "audio/wav" }));

  const tracks = Object.entries(urls).map(([id, url]) => track(id, url));
  const choice = exportChoices(roles()).find(c => c.name === role || c.key === role)!;
  return packShow({
    show: show(),
    roles: roles(),
    sequences: [sequence(Object.keys(urls))],
    // A library holds more than one show ever used; only what the sequences call should be in it.
    tracks: [...tracks, track("unused", "https://example.supabase.co/object/public/audio/public/spare.mp3")],
    script: { name: "Macbeth", html: "<p>When shall we three meet again</p>", cues: [], lookahead: 260 },
    role: choice.role,
  });
}

describe("packing", () => {
  it("carries the rows, the media and nothing that is not called by a cue", async () => {
    const { readPack } = await import("./showPack");
    const { blob, missing } = await packed();
    expect(missing).toEqual([]);

    const read = await readPack(blob);
    expect(read.body.show.name).toBe("Macbeth");
    expect(read.body.roles.map(r => r.name)).toEqual(["Controller", "Display"]);
    expect(read.body.tracks.map(t => t.id)).toEqual(["t1", "t2"]);
    expect(read.manifest.assets).toHaveLength(2);
    expect(read.assets.size).toBe(2);
    expect(read.body.script?.html).toContain("meet again");
  });

  it("rewrites every media URL so nothing in the file points back at a server", async () => {
    const { readPack } = await import("./showPack");
    const read = await readPack((await packed()).blob);
    for (const t of read.body.tracks) {
      expect(t.url.startsWith("cueflow-asset:")).toBe(true);
      expect(t.url).not.toContain("supabase");
    }
  });

  it("stores the same bytes once however many cues use them", async () => {
    const { readPack } = await import("./showPack");
    const shared = "https://example.supabase.co/object/public/audio/public/same.mp3";
    const read = await readPack((await packed("host", { urls: { t1: shared, t2: shared } })).blob);
    expect(read.manifest.assets).toHaveLength(1);
    expect(read.body.tracks[0].url).toBe(read.body.tracks[1].url);
  });

  it("names what it could not reach and packs everything else anyway", async () => {
    const { packShow } = await import("./showPack");
    const gone = "https://example.supabase.co/object/public/audio/public/deleted.mp3";
    const ok = "https://example.supabase.co/object/public/audio/public/ok.mp3";
    network.set(ok, new Blob(["fine"]));
    const { blob, missing } = await packShow({
      show: show(), roles: roles(), sequences: [sequence(["t1", "t2"])],
      tracks: [track("t1", ok), track("t2", gone)], role: null,
    });
    // A show with nineteen of its twenty sounds is worth taking to the venue.
    expect(missing).toEqual(["Cue t2"]);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("puts the job in the file, and no job means the whole show", async () => {
    const { readPack } = await import("./showPack");
    expect((await readPack((await packed("host")).blob)).manifest.role).toBeNull();
    const display = (await readPack((await packed("Display")).blob)).manifest.role;
    expect(display?.name).toBe("Display");
    expect(display?.perms).toEqual(["stage", "play"]);
  });
});

describe("reading a file somebody sent", () => {
  it("refuses something that is not a show rather than half opening it", async () => {
    const { readPack } = await import("./showPack");
    await expect(readPack(new Blob(["a text file"]))).rejects.toThrow(/not a zip|not a CueFlow show/i);
  });

  it("refuses a format from a newer CueFlow instead of guessing at it", async () => {
    const { readPack } = await import("./showPack");
    const { zip } = await import("./zip");
    const bytes = (text: string) => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
    const file = zip([
      { name: "manifest.json", body: bytes(JSON.stringify({ format: "cueflow-show/2", assets: [] })) },
      { name: "show.json", body: bytes(JSON.stringify({ show: { id: "CF-AAAAAA" } })) },
    ]);
    await expect(readPack(file)).rejects.toThrow(/newer CueFlow/i);
  });
});

describe("importing", () => {
  it("puts the show, its jobs and its media on the device, and hands over the job", async () => {
    const { importPack, readPack } = await import("./showPack");
    const read = await readPack((await packed("Display")).blob);
    const result = await importPack(read, { name: "Foyer screen" });

    expect(result.showId).toBe("CF-K7QM2X");
    expect(result.renamed).toBe(false);
    expect(result.assets).toBe(2);
    expect(result.missing).toEqual([]);
    expect(result.perms).toEqual(["stage", "play"]);

    const { listLocalShows, localRoles, localTicket } = await import("./localShow");
    expect(listLocalShows().map(s => s.name)).toEqual(["Macbeth"]);
    expect(localRoles("CF-K7QM2X").map(r => r.name)).toEqual(["Controller", "Display"]);
    const ticket = localTicket(result.member);
    expect(ticket?.perms).toEqual(["stage", "play"]);
    expect(ticket?.status).toBe("admitted");
  });

  it("gives the whole show to a copy cut with no job in it", async () => {
    const { importPack, readPack } = await import("./showPack");
    const result = await importPack(await readPack((await packed("host")).blob));
    expect(result.perms).toEqual(expect.arrayContaining(["cues", "fire", "edit", "stage", "script", "message", "play"]));
  });

  it("rewrites the cue URLs to point at this device's own copy of the file", async () => {
    const { importPack, readPack } = await import("./showPack");
    await importPack(await readPack((await packed()).blob));
    const tracks = JSON.parse(localStorage.getItem("cueflow:tracks")!) as Track[];
    expect(tracks).toHaveLength(2);
    for (const t of tracks) {
      expect(t.url.startsWith("/cf-asset/")).toBe(true);
      expect(here.has(t.url)).toBe(true);
    }
  });

  it("never overwrites a show already on this device, it imports beside it", async () => {
    const { importPack, readPack } = await import("./showPack");
    const file = (await packed()).blob;
    const first = await importPack(await readPack(file));
    const second = await importPack(await readPack(file));

    expect(first.renamed).toBe(false);
    // Opening a colleague's copy of last year's production must not replace this year's.
    expect(second.renamed).toBe(true);
    expect(second.showId).not.toBe(first.showId);
    const { listLocalShows } = await import("./localShow");
    expect(listLocalShows()).toHaveLength(2);
  });

  it("leaves a script this device already has exactly where it is", async () => {
    const { importPack, readPack } = await import("./showPack");
    const { loadScript, saveScript, emptyDoc } = await import("./script");
    saveScript({ ...emptyDoc(), name: "Mine", html: "<p>a week of notes</p>" });

    await importPack(await readPack((await packed()).blob));
    expect(loadScript().html).toContain("a week of notes");
  });

  it("takes the script when this device has none", async () => {
    const { importPack, readPack } = await import("./showPack");
    const { loadScript } = await import("./script");
    await importPack(await readPack((await packed()).blob));
    expect(loadScript().html).toContain("meet again");
  });

  it("reports an asset that did not come with the file rather than failing the import", async () => {
    const { importPack, readPack } = await import("./showPack");
    const read = await readPack((await packed()).blob);
    // What a truncated copy, or a hand-edited zip, leaves behind.
    read.assets.delete([...read.assets.keys()][0]);

    const result = await importPack(read);
    expect(result.assets).toBe(1);
    expect(result.missing).toHaveLength(1);
    const { listLocalShows } = await import("./localShow");
    expect(listLocalShows()).toHaveLength(1);
  });
});

describe("the name it downloads under", () => {
  it("says the show and the job, so three files for one production are telling apart", async () => {
    const { packFileName } = await import("./showPack");
    expect(packFileName("Macbeth", { name: "Display", perms: ["stage"] })).toBe("macbeth-display.cueflow");
    expect(packFileName("Macbeth", null)).toBe("macbeth.cueflow");
    expect(packFileName("  ", null)).toBe("show.cueflow");
    expect(packFileName("A Midsummer Night's Dream / rev 2", null)).toBe("a-midsummer-nights-dream-rev-2.cueflow");
  });
});
