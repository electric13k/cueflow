import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { cuePoints, FPS, MIN_CLIP, nudgeEdge, placeEdge, snap } from "./trim";
import Filmstrip from "../components/Filmstrip";
import { defaultVisual, type Sequence } from "../types";

const clip = { duration: 10, trimIn: 2, trimOut: 8 };

describe("snap", () => {
  it("sticks to the nearest point inside the tolerance", () => {
    expect(snap(3.04, [1, 3, 6], .1)).toBe(3);
  });
  it("leaves a point outside the tolerance alone", () => {
    expect(snap(3.4, [1, 3, 6], .1)).toBe(3.4);
  });
  it("picks the nearer of two candidates", () => {
    expect(snap(3.4, [3, 3.5], 1)).toBe(3.5);
  });
  it("with no points is the identity", () => {
    expect(snap(3.4, [], 1)).toBe(3.4);
  });
});

describe("placeEdge", () => {
  it("snaps a dragged in-point to a cue point", () => {
    expect(placeEdge("trimIn", 4.03, { ...clip, points: [4], tolerance: .1 })).toEqual({ trimIn: 4 });
  });
  it("does not snap when no tolerance is given", () => {
    expect(placeEdge("trimIn", 4.03, { ...clip, points: [4] })).toEqual({ trimIn: 4.03 });
  });
  it("keeps MIN_CLIP between the handles", () => {
    expect(placeEdge("trimIn", 9, clip)).toEqual({ trimIn: 8 - MIN_CLIP });
    expect(placeEdge("trimOut", 0, clip)).toEqual({ trimOut: 2 + MIN_CLIP });
  });
  it("holds the handles inside the file", () => {
    expect(placeEdge("trimIn", -5, clip)).toEqual({ trimIn: 0 });
    expect(placeEdge("trimOut", 99, clip)).toEqual({ trimOut: 10 });
  });
  it("reads trimOut of 0 as the end of the file", () => {
    expect(placeEdge("trimIn", 99, { duration: 10, trimIn: 0, trimOut: 0 })).toEqual({ trimIn: 10 - MIN_CLIP });
  });
  it("cannot be pushed past the clamp by a snap point", () => {
    expect(placeEdge("trimIn", 7.9, { ...clip, points: [7.95], tolerance: .5 })).toEqual({ trimIn: 8 - MIN_CLIP });
  });
});

describe("nudgeEdge", () => {
  it("moves exactly one frame either way", () => {
    expect(nudgeEdge("trimIn", 1, clip).trimIn).toBeCloseTo(2 + 1 / FPS, 10);
    expect(nudgeEdge("trimIn", -1, clip).trimIn).toBeCloseTo(2 - 1 / FPS, 10);
    expect(nudgeEdge("trimOut", -1, clip).trimOut).toBeCloseTo(8 - 1 / FPS, 10);
  });
  it("nudges the end from the file length when trimOut is unset", () => {
    expect(nudgeEdge("trimOut", -1, { duration: 10, trimIn: 0, trimOut: 0 }).trimOut).toBeCloseTo(10 - 1 / FPS, 10);
  });
  it("stops at the edges instead of walking past them", () => {
    expect(nudgeEdge("trimIn", -1, { duration: 10, trimIn: 0, trimOut: 8 })).toEqual({ trimIn: 0 });
    expect(nudgeEdge("trimOut", 1, { duration: 10, trimIn: 2, trimOut: 10 })).toEqual({ trimOut: 10 });
  });
  it("never snaps, so a frame step next to a cue point stays a frame step", () => {
    const at = nudgeEdge("trimIn", 1, clip).trimIn;
    expect(at).not.toBe(2);
  });
});

describe("cuePoints", () => {
  const seq = (items: { trackId: string; trimIn: number; trimOut: number }[]): Sequence => ({
    id: "s", name: "s", createdAt: "", items: items.map((i, n) => ({
      id: `i${n}`, trackId: i.trackId, label: "", effects: {} as never,
      visual: { ...defaultVisual(), trimIn: i.trimIn, trimOut: i.trimOut },
    })),
  });

  it("collects the trims of cues made from this track, sorted and deduped", () => {
    const s = [seq([
      { trackId: "a", trimIn: 3, trimOut: 6 },
      { trackId: "a", trimIn: 6, trimOut: 9 },
      { trackId: "b", trimIn: 1, trimOut: 2 },
    ])];
    expect(cuePoints(s, "a")).toEqual([3, 6, 9]);
  });
  it("drops the ends of the file, which are the clamps", () => {
    expect(cuePoints([seq([{ trackId: "a", trimIn: 0, trimOut: 0 }])], "a")).toEqual([]);
  });
  it("is empty for a track no cue uses", () => {
    expect(cuePoints([seq([{ trackId: "b", trimIn: 1, trimOut: 2 }])], "a")).toEqual([]);
  });
});

// The math above is only worth having if the handle is actually wired to it, so render the strip
// and press the key: this is the part that silently does nothing if the listener moves.
describe("the filmstrip handles", () => {
  const render = (onChange: (p: { trimIn?: number; trimOut?: number }) => void) => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    act(() => { createRoot(host).render(createElement(Filmstrip, { url: "blob:x", duration: 10, trimIn: 2, trimOut: 8, cues: [4], onChange })); });
    return host;
  };
  const press = (el: Element, key: string) =>
    act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });

  it('moves the focused handle one frame on "," and "."', () => {
    const onChange = vi.fn();
    const host = render(onChange);
    const start = host.querySelector('[aria-label="Start of clip"]')!;
    press(start, ",");
    expect(onChange.mock.calls[0][0].trimIn).toBeCloseTo(2 - 1 / FPS, 10);
    press(start, ".");
    expect(onChange.mock.calls[1][0].trimIn).toBeCloseTo(2 + 1 / FPS, 10);
    press(host.querySelector('[aria-label="End of clip"]')!, ".");
    expect(onChange.mock.calls[2][0].trimOut).toBeCloseTo(8 + 1 / FPS, 10);
  });

  it("ignores any other key, so the show keybinds still get it", () => {
    const onChange = vi.fn();
    const host = render(onChange);
    press(host.querySelector('[aria-label="Start of clip"]')!, "ArrowRight");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("draws a marker at each cue point", () => {
    const host = render(vi.fn());
    expect(host.querySelectorAll(".bg-armed\\/80")).toHaveLength(1);
  });
});
