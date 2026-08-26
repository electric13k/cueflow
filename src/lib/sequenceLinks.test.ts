import { describe, expect, test } from "vitest";
import { defaultEffects, type SequenceItem } from "../types";
import { linkSequenceItems, unlinkSequenceItem } from "./sequenceLinks";

const item = (id: string, link?: string): SequenceItem => ({ id, trackId: id, label: id, effects: defaultEffects(), link });

describe("sequence links", () => {
  test("links both cues and clears old partners", () => {
    const items = [item("a", "c"), item("b"), item("c", "a"), item("d", "b")];
    expect(linkSequenceItems(items, "a", "b").map(x => [x.id, x.link])).toEqual([
      ["a", "b"], ["b", "a"], ["c", undefined], ["d", undefined],
    ]);
  });

  test("unlinking either side clears the pair", () => {
    const items = [item("a", "b"), item("b", "a"), item("c")];
    expect(unlinkSequenceItem(items, "b").map(x => [x.id, x.link])).toEqual([
      ["a", undefined], ["b", undefined], ["c", undefined],
    ]);
  });
});
