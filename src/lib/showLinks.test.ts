import { describe, expect, it } from "vitest";
import { linksOf, withScript, withSequence, withoutShow, type LinkMap } from "./showLinks";

describe("show links", () => {
  it("takes several sequences into one show", () => {
    const map = withSequence(withSequence({}, "s1", "a"), "s1", "b");
    expect(linksOf(map, "s1").seqs).toEqual(["a", "b"]);
  });

  it("counts the same sequence dropped twice once, and does not rewrite the map", () => {
    const once: LinkMap = withSequence({}, "s1", "a");
    expect(withSequence(once, "s1", "a")).toBe(once);
  });

  it("keeps shows apart", () => {
    const map = withSequence(withSequence({}, "s1", "a"), "s2", "b");
    expect(linksOf(map, "s1").seqs).toEqual(["a"]);
    expect(linksOf(map, "s2").seqs).toEqual(["b"]);
  });

  it("marks the script without disturbing the sequences", () => {
    const map = withScript(withSequence({}, "s1", "a"), "s1");
    expect(linksOf(map, "s1")).toEqual({ seqs: ["a"], script: true });
  });

  it("forgets a deleted show", () => {
    const map = withoutShow(withSequence({}, "s1", "a"), "s1");
    expect(linksOf(map, "s1")).toEqual({ seqs: [], script: false });
  });
});
