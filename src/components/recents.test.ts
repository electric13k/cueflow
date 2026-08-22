import { describe, expect, it } from "vitest";
import { CATEGORIES } from "./recents";

describe("recents hierarchy", () => {
  it("places shows before library and scripts after shows", () => {
    const ids = CATEGORIES.map(category => category.id);
    expect(ids.indexOf("shows")).toBeLessThan(ids.indexOf("library"));
    expect(ids.indexOf("scripts")).toBeGreaterThan(ids.indexOf("shows"));
  });
});
