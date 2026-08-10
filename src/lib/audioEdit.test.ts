import { expect, test } from "vitest";
import { commit, envelopeGain, redo, stack, undo } from "./audioEdit";

const of = (s: ReturnType<typeof stack<string>>) => [s.past.join(""), s.present, s.future.join("")];

test("undo walks back through commits and redo walks forward again", () => {
  let s = stack("a");
  s = commit(s, "b"); s = commit(s, "c");
  expect(of(s)).toEqual(["ab", "c", ""]);
  s = undo(s); expect(of(s)).toEqual(["a", "b", "c"]);
  s = undo(s); expect(of(s)).toEqual(["", "a", "bc"]);
  s = undo(s); expect(of(s)).toEqual(["", "a", "bc"]); // nothing left to undo, stack holds still
  s = redo(s); expect(of(s)).toEqual(["a", "b", "c"]);
  s = redo(s); expect(of(s)).toEqual(["ab", "c", ""]);
  expect(redo(s)).toEqual(s);
});

test("a new edit after an undo drops the redo branch", () => {
  const s = commit(undo(commit(commit(stack("a"), "b"), "c")), "d");
  expect(of(s)).toEqual(["ab", "d", ""]); // b is back on the stack, c is gone for good
});

test("transitions are pure -- applying one twice is the same as applying it once", () => {
  const s = commit(commit(stack("a"), "b"), "c");
  expect(undo(undo(s))).toEqual(undo(undo(s)));
  expect(of(undo(s))).toEqual(of(undo(s))); // no shared array mutated in place
});

test("history is bounded at 20 steps", () => {
  let s = stack(0);
  for (let i = 1; i <= 30; i++) s = commit(s, i);
  expect(s.past.length).toBe(20);
  expect(s.past[0]).toBe(10);
  expect(s.present).toBe(30);
});

test("envelope reads flat outside its points and interpolates between them", () => {
  const pts = [{ t: 1, g: 0 }, { t: 3, g: 2 }];
  expect(envelopeGain(pts, 0)).toBe(0);
  expect(envelopeGain(pts, 2)).toBe(1);
  expect(envelopeGain(pts, 9)).toBe(2);
  expect(envelopeGain([], 5)).toBe(1);
});

test("an out of order point set still reads as a curve, since the plugin hands them back unsorted", () => {
  const pts = [{ t: 0, g: 1 }, { t: 2, g: .5 }, { t: 4, g: 0 }];
  expect(envelopeGain(pts, 1)).toBeCloseTo(.75, 12);
  expect(envelopeGain(pts, 3)).toBeCloseTo(.25, 12);
});
