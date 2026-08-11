import { beforeEach, describe, expect, it } from "vitest";
import { clearDemo, demoPresent, demoTracks, isDemo, loadDemo } from "./demo";
import { emptyDoc, loadScript, saveScript } from "./script";
import { local } from "./store";
import { defaultEffects, type Sequence, type Track } from "../types";

const mine = (id: string): Track => ({
  id, title: `Mine ${id}`, url: "blob:x", kind: "audio", effects: defaultEffects(), createdAt: "2026-01-01T00:00:00.000Z",
});

describe("demo kit", () => {
  beforeEach(() => { localStorage.clear(); });

  it("never gives a demo item a UUID, which is what keeps it out of the cloud", () => {
    // store.ts only uploads rows whose id passes isUuid. If any of these ever looked like a UUID it
    // would sync into somebody's account and outlive the tutorial.
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const t of demoTracks()) {
      expect(isDemo(t.id)).toBe(true);
      expect(uuid.test(t.id)).toBe(false);
    }
  });

  it("loads the media and a script onto an empty board", () => {
    loadDemo();
    expect(local.get<Track[]>("tracks", [])).toHaveLength(demoTracks().length);
    expect(loadScript().cues).toHaveLength(2);
    expect(demoPresent()).toBe(true);
  });

  it("does not double the library when the tutorial is replayed", () => {
    loadDemo();
    loadDemo();
    expect(local.get<Track[]>("tracks", [])).toHaveLength(demoTracks().length);
  });

  it("leaves a real script alone", () => {
    saveScript({ ...emptyDoc(), name: "The actual show", html: "<p>Mine</p>" });
    loadDemo();
    expect(loadScript().name).toBe("The actual show");
    // And teardown must not take it either, since the demo never installed it.
    clearDemo();
    expect(loadScript().name).toBe("The actual show");
  });

  it("removes every demo item and nothing else", () => {
    local.set("tracks", [mine("a1b2c3d4-e5f6-4777-8888-99990000aaaa")]);
    loadDemo();
    clearDemo();
    const left = local.get<Track[]>("tracks", []);
    expect(left).toHaveLength(1);
    expect(left[0].title).toBe("Mine a1b2c3d4-e5f6-4777-8888-99990000aaaa");
    expect(demoPresent()).toBe(false);
  });

  it("keeps a sequence the user built, dropping only the cues that pointed at demo media", () => {
    loadDemo();
    const seq: Sequence = {
      id: "e1b2c3d4-e5f6-4777-8888-99990000bbbb", name: "Act I", createdAt: "2026-01-01T00:00:00.000Z",
      items: [
        { id: "i1", trackId: "demo:thunder", label: "Cue 1", effects: defaultEffects() },
        { id: "i2", trackId: "a1b2c3d4-e5f6-4777-8888-99990000aaaa", label: "Cue 2", effects: defaultEffects() },
      ],
    };
    local.set("sequences", [seq]);
    clearDemo();
    const [kept] = local.get<Sequence[]>("sequences", []);
    expect(kept.name).toBe("Act I");
    expect(kept.items).toHaveLength(1);
    expect(kept.items[0].trackId).toBe("a1b2c3d4-e5f6-4777-8888-99990000aaaa");
  });

  it("is a no-op on a board that never saw the tutorial", () => {
    const own = [mine("a1b2c3d4-e5f6-4777-8888-99990000aaaa")];
    local.set("tracks", own);
    clearDemo();
    expect(local.get<Track[]>("tracks", [])).toEqual(own);
  });
});
