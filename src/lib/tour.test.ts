import { beforeEach, describe, expect, it } from "vitest";
import { getTour, setTour, steps, tourSeen } from "./tour";

const step = (id: string) => steps.find(s => s.id === id)!;

const card = (attrs: Record<string, string> = {}) => {
  const el = document.createElement("div");
  el.setAttribute("data-tour", "library-card");
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  document.body.append(el);
  return el;
};

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
});

describe("the tour's own state", () => {
  it("starts unseen, and knows the difference between offered and finished", () => {
    expect(tourSeen()).toBe(false);
    setTour({ done: false, step: 2 });
    expect(tourSeen()).toBe(true);
    expect(getTour()).toEqual({ done: false, step: 2 });
  });

  it("survives a corrupted store rather than throwing on load", () => {
    localStorage.setItem("cueflow:tour", "{not json");
    expect(getTour()).toEqual({ done: false, step: 0 });
  });
});

describe("the steps that used to finish themselves", () => {
  /**
   * Both of these completed on their first tick, so the tutorial jumped to step 3 in under a second
   * and the user never saw what it was pointing at. This is the whole of "fix tutorials".
   */
  it("does not call the first step done merely because the Studio route is open", () => {
    expect(step("sidebar").done()).toBe(false);
  });

  it("finishes the first step when the Studio's library is actually on screen", () => {
    card();
    expect(step("sidebar").done()).toBe(true);
  });

  it("does not call the library step done just because something is selected", () => {
    // The Studio seeds a selection from the first track before it paints, so the old predicate
    // (`!!session().selectedId`) was true before the step was ever shown.
    localStorage.setItem("cueflow:session", JSON.stringify({ selectedId: "track-1" }));
    card();
    expect(step("library").done()).toBe(false);
  });

  it("finishes the library step once a card is making sound", () => {
    card({ "data-playing": "true" });
    expect(step("library").done()).toBe(true);
  });
});

describe("project scoping", () => {
  it("reads the sequence store the Studio actually writes inside a project", () => {
    localStorage.setItem("cueflow:project", JSON.stringify("proj-1"));
    // Unscoped is what the Studio writes outside a project, and the tour must not see it here.
    localStorage.setItem("cueflow:sequences", JSON.stringify([{ id: "a", items: [{}, {}] }]));
    expect(step("sequence").done()).toBe(false);

    localStorage.setItem("cueflow:sequences:proj-1", JSON.stringify([{ id: "b", items: [{}, {}] }]));
    expect(step("sequence").done()).toBe(true);
    expect(step("cues").done()).toBe(true);
  });

  it("still reads the unscoped store when no project is open", () => {
    localStorage.setItem("cueflow:sequences", JSON.stringify([{ id: "a", items: [] }]));
    expect(step("sequence").done()).toBe(true);
    expect(step("cues").done()).toBe(false);
  });
});

describe("the shape of the tour", () => {
  it("gives every step a unique id and something to point at", () => {
    expect(new Set(steps.map(s => s.id)).size).toBe(steps.length);
    for (const s of steps) {
      expect(s.anchor.trim()).not.toBe("");
      expect(s.say.trim()).not.toBe("");
    }
  });

  it("only lets a step have no watchable finish if pressing it is what finishes it", () => {
    // `done: () => false` with no `onPress` is a step that can never be completed.
    for (const s of steps) {
      if (s.done() === false && s.onPress !== true) continue;
      expect(s.onPress === true || typeof s.done === "function").toBe(true);
    }
    const unfinishable = steps.filter(s => !s.onPress && s.done.toString().includes("=> false"));
    expect(unfinishable).toEqual([]);
  });
});
