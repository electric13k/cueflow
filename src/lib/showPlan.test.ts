import { describe, expect, it } from "vitest";
import { clock, lengthOf, liveAt, planShow, showSequences } from "./showPlan";
import { defaultEffects, defaultVisual, type Sequence, type SequenceItem, type Track } from "../types";

const track = (id: string, kind: Track["kind"], duration?: number): Track =>
  ({ id, title: id, url: `blob:${id}`, kind, duration, effects: defaultEffects(), createdAt: "2026-01-01", ...(kind === "audio" ? {} : { visual: defaultVisual() }) });
const item = (id: string, trackId: string, speed = 1): SequenceItem =>
  ({ id, trackId, label: id, effects: { ...defaultEffects(), speed } });
const seq = (id: string, name: string, items: SequenceItem[]): Sequence => ({ id, name, items, createdAt: "2026-01-01" });

const tracks = [track("t1", "audio", 60), track("t2", "image"), track("t3", "audio", 30), track("t4", "video", 999)];

describe("show plan", () => {
  it("takes the show's own deck first and never counts a sequence twice", () => {
    const all = [seq("a", "A", []), seq("b", "B", []), seq("c", "C", [])];
    expect(showSequences(all, "b", ["a", "b"]).map(s => s.id)).toEqual(["b", "a"]);
  });

  it("skips a carried sequence that no longer exists, and a show with no deck of its own", () => {
    const all = [seq("a", "A", [])];
    expect(showSequences(all, null, ["gone", "a"]).map(s => s.id)).toEqual(["a"]);
  });

  it("restarts cue numbering in each sequence, sounds and visuals counted apart", () => {
    const plan = planShow([
      seq("a", "A", [item("i1", "t1"), item("i2", "t2"), item("i3", "t3")]),
      seq("b", "B", [item("i4", "t1"), item("i5", "t2")]),
    ], tracks);
    expect(plan.map(c => c.number)).toEqual(["1", "a", "2", "1", "a"]);
    expect(plan.map(c => c.sequence)).toEqual(["A", "A", "A", "B", "B"]);
  });

  it("counts a sound's length against the clock and a visual as nothing", () => {
    const plan = planShow([seq("a", "A", [item("i1", "t1"), item("i2", "t2"), item("i3", "t3")])], tracks);
    expect(plan.map(c => c.length)).toEqual([60, 0, 30]);
    expect(plan.map(c => c.offset)).toEqual([0, 60, 60]);
  });

  it("shortens a sound that is played faster, and never returns a negative or NaN length", () => {
    expect(lengthOf(item("i", "t1", 2), tracks[0])).toBe(30);
    expect(lengthOf(item("i", "t1", 0), tracks[0])).toBe(60); // 0 is not a speed; flat is
    expect(lengthOf(item("i", "gone"), undefined)).toBe(0);
    expect(lengthOf(item("i", "t4"), tracks[3])).toBe(0);     // a video holds until the next cue
  });

  it("finds where the deck is standing, and says -1 when its sequence is not in this show", () => {
    const plan = planShow([seq("a", "A", [item("i1", "t1"), item("i2", "t2")]), seq("b", "B", [item("i3", "t3")])], tracks);
    expect(liveAt(plan, "b", 0)).toBe(2);
    expect(liveAt(plan, "a", 1)).toBe(1);
    expect(liveAt(plan, "zz", 0)).toBe(-1);
    expect(liveAt(plan, "a", -1)).toBe(-1); // armed, nothing fired yet
  });

  it("reads a clock in m:ss until there is an hour, and never shows NaN", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(65)).toBe("1:05");
    expect(clock(3725)).toBe("1:02:05");
    expect(clock(Number.NaN)).toBe("0:00");
    expect(clock(-5)).toBe("0:00");
  });
});
