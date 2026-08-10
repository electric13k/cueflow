import { expect, test } from "vitest";
import {
  clampOverlap, cueLinkOf, fadeGains, incomingStart, MAX_OVERLAP, pairKey, withCueLink, withoutCueLink,
} from "./cueLink";

test("a pair is found from either end", () => {
  expect(pairKey("b", "a")).toBe(pairKey("a", "b"));
  const map = withCueLink({}, "a", "b", { mode: "crossfade", overlap: 6 });
  expect(cueLinkOf(map, "b", "a")).toEqual({ mode: "crossfade", overlap: 6 });
  expect(cueLinkOf(map, "a", "c").mode).toBe("together");
});

test("unlinking drops the setting rather than leaving it for the next pairing", () => {
  const map = withCueLink({}, "a", "b", { overlap: 9 });
  expect(withoutCueLink(map, "b", "a")).toEqual({});
  expect(withoutCueLink({}, "a", "b")).toEqual({});
});

test("the overlap never outlasts the shorter clip, and an unmeasured clip does not clamp it", () => {
  expect(clampOverlap(6, 30, 20)).toBe(6);
  expect(clampOverlap(25, 30, 8)).toBe(8);
  expect(clampOverlap(6, 0, 0)).toBe(6);      // neither length known yet
  expect(clampOverlap(6, 0, 4)).toBe(4);
  expect(clampOverlap(-2, 30, 20)).toBe(0);
  expect(clampOverlap(999, 0, 0)).toBe(MAX_OVERLAP);
});

test("the incoming clip starts one overlap before the outgoing one ends", () => {
  expect(incomingStart(60, 5)).toBe(55);
  expect(incomingStart(3, 10)).toBe(0);       // overlap longer than the record: they start together
  expect(incomingStart(60, 0)).toBe(60);
});

test("the crossfade holds constant power from end to end", () => {
  for (const x of [0, .1, .25, .5, .75, .9, 1]) {
    const g = fadeGains(x * 8, 8);
    expect(g.out ** 2 + g.in ** 2).toBeCloseTo(1, 12);
  }
  expect(fadeGains(0, 8)).toEqual({ out: 1, in: 0 });
  const half = fadeGains(4, 8);
  expect(half.out).toBeCloseTo(Math.SQRT1_2, 12);
  expect(half.in).toBeCloseTo(Math.SQRT1_2, 12);
  const end = fadeGains(8, 8);
  expect(end.out).toBeCloseTo(0, 12);
  expect(end.in).toBeCloseTo(1, 12);
});

test("the fade only moves one way, and holds outside its own window", () => {
  let last = fadeGains(0, 5).in;
  for (let t = .5; t <= 5; t += .5) {
    const now = fadeGains(t, 5).in;
    expect(now).toBeGreaterThan(last);
    last = now;
  }
  expect(fadeGains(-3, 5)).toEqual({ out: 1, in: 0 });
  expect(fadeGains(99, 5).in).toBeCloseTo(1, 12);
  expect(fadeGains(1, 0)).toEqual({ out: 0, in: 1 }); // no overlap is a straight cut
});
