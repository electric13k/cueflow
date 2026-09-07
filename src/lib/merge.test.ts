import { beforeEach, describe, expect, it } from "vitest";
import { forgetBaseline, mergeInto, pick, rowShape } from "./store";
import { defaultEffects, type Sequence, type SequenceItem, type Track } from "../types";

const track = (id: string, over: Partial<Track> = {}): Track =>
  ({ id, title: id, url: `https://x/${id}.mp3`, effects: defaultEffects(), createdAt: "2026-01-01T00:00:00Z", ...over });

const item = (id: string, over: Partial<SequenceItem> = {}): SequenceItem =>
  ({ id, trackId: `t-${id}`, label: id, effects: defaultEffects(), ...over });

const seq = (id: string, items: SequenceItem[], over: Partial<Sequence> = {}): Sequence =>
  ({ id, name: id, items, createdAt: "2026-01-01T00:00:00Z", ...over });

/** Runs a merge, then a second one, which is what makes the baseline meaningful. */
const sync = (local: { tracks: Track[]; sequences: Sequence[] }, cloud: { tracks: Track[]; sequences: Sequence[] }) =>
  mergeInto(local.tracks, local.sequences, cloud);

beforeEach(() => {
  localStorage.clear();
  forgetBaseline();
});

describe("pick", () => {
  it("keeps what is on screen when the two copies say the same thing", () => {
    expect(pick(track("a"), track("a"))).toBe("here");
  });

  it("takes the remote copy when this device has not touched the row since the last sync", () => {
    const here = track("a", { title: "Rain" });
    const remote = track("a", { title: "Rain, heavier" });
    // `rowShape` is what the merge itself records, so this exercises the real branch.
    expect(pick(here, remote, rowShape(here))).toBe("remote");
  });

  it("falls back to the newer timestamp when both sides changed", () => {
    const here = track("a", { title: "Mine", updatedAt: "2026-05-01T10:00:00Z" });
    const remote = track("a", { title: "Theirs", updatedAt: "2026-05-01T11:00:00Z" });
    expect(pick(here, remote, "something-else-entirely")).toBe("remote");
  });

  it("keeps this device's copy on a tie, rather than taking work off the screen", () => {
    const at = "2026-05-01T10:00:00Z";
    expect(pick(track("a", { title: "Mine", updatedAt: at }), track("a", { title: "Theirs", updatedAt: at }), "base")).toBe("here");
  });

  it("keeps this device's copy when neither side has a timestamp yet", () => {
    // Before the migration lands there is nothing to compare, so the visible copy stands.
    expect(pick(track("a", { title: "Mine" }), track("a", { title: "Theirs" }), "base")).toBe("here");
  });
});

describe("mergeInto", () => {
  it("brings across a track this device has never seen", () => {
    const merged = sync({ tracks: [], sequences: [] }, { tracks: [track("a")], sequences: [] });
    expect(merged.tracks.map(t => t.id)).toEqual(["a"]);
  });

  it("applies a rename made on another device, instead of discarding it", () => {
    // The old merge hit `continue` on any track it already had, so this was silently thrown away.
    sync({ tracks: [track("a", { title: "Old" })], sequences: [] }, { tracks: [track("a", { title: "Old" })], sequences: [] });
    const merged = sync({ tracks: [track("a", { title: "Old" })], sequences: [] }, { tracks: [track("a", { title: "New" })], sequences: [] });
    expect(merged.tracks[0].title).toBe("New");
  });

  it("does not overwrite an edit this device has made and not yet saved", () => {
    sync({ tracks: [track("a", { title: "Old" })], sequences: [] }, { tracks: [track("a", { title: "Old" })], sequences: [] });
    const merged = sync({ tracks: [track("a", { title: "Mine, unsaved" })], sequences: [] }, { tracks: [track("a", { title: "Old" })], sequences: [] });
    expect(merged.tracks[0].title).toBe("Mine, unsaved");
  });

  it("keeps a track this device made that has never been saved", () => {
    const merged = sync({ tracks: [track("local-only")], sequences: [] }, { tracks: [], sequences: [] });
    expect(merged.tracks.map(t => t.id)).toEqual(["local-only"]);
  });

  it("lets a delete made on another device stick", () => {
    // Known at the last sync, absent now: somebody removed it. The old merge simply kept it, and the
    // next save put it back in the cloud pointing at a storage object that no longer existed.
    sync({ tracks: [track("a"), track("b")], sequences: [] }, { tracks: [track("a"), track("b")], sequences: [] });
    const merged = sync({ tracks: [track("a"), track("b")], sequences: [] }, { tracks: [track("a")], sequences: [] });
    expect(merged.tracks.map(t => t.id)).toEqual(["a"]);
  });

  it("adds a cue from another device to a sequence both sides have", () => {
    const merged = sync(
      { tracks: [], sequences: [seq("s", [item("one")])] },
      { tracks: [], sequences: [seq("s", [item("one"), item("two")])] },
    );
    expect(merged.sequences[0].items.map(i => i.id)).toEqual(["one", "two"]);
  });

  it("applies a reorder rather than appending the same cues again", () => {
    sync({ tracks: [], sequences: [seq("s", [item("one"), item("two")])] }, { tracks: [], sequences: [seq("s", [item("one"), item("two")])] });
    const merged = sync(
      { tracks: [], sequences: [seq("s", [item("one"), item("two")])] },
      { tracks: [], sequences: [seq("s", [item("two"), item("one")])] },
    );
    expect(merged.sequences[0].items.map(i => i.id)).toEqual(["two", "one"]);
  });

  it("lets a cue deleted on another device stay deleted", () => {
    sync({ tracks: [], sequences: [seq("s", [item("one"), item("two")])] }, { tracks: [], sequences: [seq("s", [item("one"), item("two")])] });
    const merged = sync(
      { tracks: [], sequences: [seq("s", [item("one"), item("two")])] },
      { tracks: [], sequences: [seq("s", [item("one")])] },
    );
    expect(merged.sequences[0].items.map(i => i.id)).toEqual(["one"]);
  });

  it("keeps a cue this device just added and has not saved", () => {
    sync({ tracks: [], sequences: [seq("s", [item("one")])] }, { tracks: [], sequences: [seq("s", [item("one")])] });
    const merged = sync(
      { tracks: [], sequences: [seq("s", [item("one"), item("fresh")])] },
      { tracks: [], sequences: [seq("s", [item("one")])] },
    );
    expect(merged.sequences[0].items.map(i => i.id)).toEqual(["one", "fresh"]);
  });

  it("applies a cue relabelled on another device", () => {
    sync({ tracks: [], sequences: [seq("s", [item("one", { label: "House" })])] }, { tracks: [], sequences: [seq("s", [item("one", { label: "House" })])] });
    const merged = sync(
      { tracks: [], sequences: [seq("s", [item("one", { label: "House" })])] },
      { tracks: [], sequences: [seq("s", [item("one", { label: "House to half" })])] },
    );
    expect(merged.sequences[0].items[0].label).toBe("House to half");
  });

  it("applies a sequence renamed on another device", () => {
    sync({ tracks: [], sequences: [seq("s", [], { name: "Act one" })] }, { tracks: [], sequences: [seq("s", [], { name: "Act one" })] });
    const merged = sync(
      { tracks: [], sequences: [seq("s", [], { name: "Act one" })] },
      { tracks: [], sequences: [seq("s", [], { name: "Act one, revised" })] },
    );
    expect(merged.sequences[0].name).toBe("Act one, revised");
  });

  it("never lets one cue id sit in two sequences", () => {
    // A cue that moved decks arrives in both copies, and saving both is a primary key collision.
    const merged = sync(
      { tracks: [], sequences: [seq("a", [item("moved")])] },
      { tracks: [], sequences: [seq("a", [item("moved")]), seq("b", [item("moved")])] },
    );
    const all = merged.sequences.flatMap(s => s.items.map(i => i.id));
    expect(all).toEqual([...new Set(all)]);
  });

  it("is stable: merging the same cloud copy twice changes nothing", () => {
    const local = { tracks: [track("a")], sequences: [seq("s", [item("one")])] };
    const cloud = { tracks: [track("a")], sequences: [seq("s", [item("one")])] };
    const once = sync(local, cloud);
    const twice = mergeInto(once.tracks, once.sequences, cloud);
    expect(twice).toEqual(once);
  });

  it("respects a local tombstone, so a delete does not come back on the next pull", () => {
    localStorage.setItem("cueflow:deleted", JSON.stringify(["gone"]));
    const merged = sync({ tracks: [], sequences: [] }, { tracks: [track("gone"), track("stays")], sequences: [] });
    expect(merged.tracks.map(t => t.id)).toEqual(["stays"]);
  });
});
