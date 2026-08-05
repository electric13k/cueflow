import { describe, expect, it } from "vitest";
import { mergeInto } from "./store";
import { defaultEffects, type Sequence, type SequenceItem, type Track } from "../types";

const track = (id: string): Track => ({ id, title: id, url: `https://x/${id}`, effects: defaultEffects(), createdAt: "" });
const cue = (id: string, trackId = "t1"): SequenceItem => ({ id, trackId, label: id, effects: defaultEffects() });
const seq = (id: string, items: SequenceItem[]): Sequence => ({ id, name: id, items, createdAt: "" });

const ids = (sequences: Sequence[]) => sequences.flatMap(s => s.items.map(i => i.id));

describe("mergeInto", () => {
  it("pulls in a sequence this device has never seen", () => {
    const merged = mergeInto([], [], { tracks: [track("t1")], sequences: [seq("s1", [cue("c1")])] });
    expect(merged.sequences.map(s => s.id)).toEqual(["s1"]);
    expect(ids(merged.sequences)).toEqual(["c1"]);
  });

  it("takes the union of cues when both sides have the same sequence", () => {
    const merged = mergeInto([track("t1")], [seq("s1", [cue("c1")])], {
      tracks: [], sequences: [seq("s1", [cue("c1"), cue("c2")])],
    });
    expect(ids(merged.sequences)).toEqual(["c1", "c2"]);
  });

  // The bug: a cue id landing in two sequences is a primary key collision the moment it is saved,
  // which surfaced as "duplicate key value violates unique constraint" on every single action.
  it("never lets one cue id end up in two sequences", () => {
    const merged = mergeInto([track("t1")], [seq("s1", [cue("c1")])], {
      tracks: [], sequences: [seq("s2", [cue("c1"), cue("c2")])],
    });
    const all = ids(merged.sequences);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toEqual(["c1", "c2"]);
  });

  it("does not resurrect a track this device deleted", () => {
    const merged = mergeInto([], [], { tracks: [track("t1")], sequences: [] });
    expect(merged.tracks.map(t => t.id)).toEqual(["t1"]);
  });
});
