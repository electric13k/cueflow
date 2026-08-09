import { beforeEach, expect, test } from "vitest";
import { hasLearned, markLearned, replay } from "./coach";

const heard: string[] = [];
window.addEventListener("cueflow:teach", e => heard.push((e as CustomEvent<string>).detail));
beforeEach(() => { localStorage.clear(); heard.length = 0; });

// The whole difference between a pane's "?" and the "reset tips" button: one lesson comes back,
// every other lesson stays learned. Get this wrong and pressing "?" once re-runs the whole tour.
test("replay un-learns exactly one lesson and gives it again", () => {
  ["library", "editor", "sequence", "show"].forEach(markLearned);

  replay("editor");

  expect(hasLearned("editor")).toBe(false);
  expect(["library", "sequence", "show"].every(hasLearned)).toBe(true);
  expect(heard).toEqual(["editor"]);
});

test("replaying a lesson nobody has seen yet still gives it, and disturbs nothing", () => {
  markLearned("library");

  replay("transport");

  expect(heard).toEqual(["transport"]);
  expect(hasLearned("library")).toBe(true);
  expect(hasLearned("transport")).toBe(false);
});
