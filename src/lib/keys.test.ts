import { beforeEach, describe, expect, it } from "vitest";
import { clashes, defaultBinds, keyActions, keyLabel, loadBinds, saveBinds } from "./keys";
import type { Action } from "./keys";

beforeEach(() => localStorage.clear());

describe("the shipped binds", () => {
  it("gives every action a key", () => {
    for (const action of keyActions) expect(action.def, action.id).toBeTruthy();
  });

  it("ships with no clash, which is the state the clash warning exists to protect", () => {
    expect([...clashes(defaultBinds)]).toEqual([]);
  });

  it("names each action once", () => {
    const ids = keyActions.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("clashes", () => {
  it("names both sides, because either one could be the mistake", () => {
    const bad = clashes({ ...defaultBinds, stopAll: "r" });   // r is already Reverb +
    expect(bad).toEqual(new Set<Action>(["stopAll", "reverbUp"]));
  });

  it("treats an unbound action as unbound rather than as a clash", () => {
    // Two actions both holding "" would otherwise read as sharing a key, and the operator would be
    // told to fix a conflict between two things that do nothing.
    const bad = clashes({ ...defaultBinds, stopAll: "", reverbUp: "" });
    expect([...bad]).toEqual([]);
  });

  it("is case sensitive, because the browser reports the key as typed", () => {
    expect([...clashes({ ...defaultBinds, stopAll: "R" })]).toEqual([]);
  });

  it("catches three actions piled on one key", () => {
    const bad = clashes({ ...defaultBinds, stopAll: "r", speedUp: "r" });
    expect(bad).toEqual(new Set<Action>(["stopAll", "speedUp", "reverbUp"]));
  });
});

describe("keyLabel", () => {
  it("writes the keys that have no glyph", () => {
    expect(keyLabel(" ")).toBe("Space");
    expect(keyLabel("ArrowRight")).toBe("→");
    expect(keyLabel("ArrowDown")).toBe("↓");
  });

  it("upper-cases a single character so the binding is readable on a button", () => {
    expect(keyLabel("r")).toBe("R");
  });

  it("leaves a named key it has no glyph for alone rather than mangling it", () => {
    expect(keyLabel("Escape")).toBe("Escape");
    expect(keyLabel("F5")).toBe("F5");
  });

  it("does not upper-case a punctuation bind into something else", () => {
    expect(keyLabel(".")).toBe(".");
    expect(keyLabel("[")).toBe("[");
  });
});

describe("loadBinds", () => {
  it("falls back to the defaults when nothing is stored", () => {
    expect(loadBinds()).toEqual(defaultBinds);
  });

  it("keeps a customised key", () => {
    saveBinds({ ...defaultBinds, stopAll: "x" });
    expect(loadBinds().stopAll).toBe("x");
  });

  it("fills in an action added after the operator last saved", () => {
    // A saved map from an older build has no entry for a new action. Without the spread the action
    // would come back undefined and the bind would silently do nothing.
    localStorage.setItem("cueflow:keybinds", JSON.stringify({ nextCue: "n" }));
    const binds = loadBinds();
    expect(binds.nextCue).toBe("n");
    expect(binds.stopAll).toBe(defaultBinds.stopAll);
  });
});
