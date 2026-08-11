import { beforeEach, describe, expect, it } from "vitest";
import { applyLayout, defaults, getLayout, setLayout } from "./layout";

describe("layout", () => {
  beforeEach(() => { localStorage.clear(); });

  it("starts on the defaults when nothing is stored", () => {
    expect(getLayout()).toEqual(defaults);
  });

  it("keeps each setting independent of the other", () => {
    setLayout({ pane: "wide" });
    setLayout({ density: "compact" });
    expect(getLayout()).toEqual({ pane: "wide", density: "compact" });
  });

  it("falls back to the default for a value that is no longer an option", () => {
    localStorage.setItem("cueflow:layout", JSON.stringify({ pane: "rail", density: "compact" }));
    // `rail` was a real option once. A stored value that outlives its choice must not render nothing.
    expect(getLayout()).toEqual({ pane: "panel", density: "compact" });
  });

  it("survives a corrupt stored value", () => {
    localStorage.setItem("cueflow:layout", "{not json");
    expect(getLayout()).toEqual(defaults);
  });

  it("writes the attributes the stylesheet reads", () => {
    setLayout({ pane: "focus", density: "compact" });
    applyLayout();
    expect(document.documentElement.dataset.pane).toBe("focus");
    expect(document.documentElement.dataset.density).toBe("compact");
  });
});
