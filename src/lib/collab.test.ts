import { describe, expect, it } from "vitest";
import { ROLES, alreadyThere, can, isRole, roleLabel, whoProblem } from "./collab";

describe("project roles", () => {
  it("offers only the two the roster column accepts", () => {
    expect(ROLES.map(r => r.key)).toEqual(["editor", "viewer"]);
    expect(isRole("editor")).toBe(true);
    expect(isRole("owner")).toBe(false);
  });

  it("names the owner even though the owner is never a roster row", () => {
    expect(roleLabel("owner")).toBe("Owner");
    expect(roleLabel("viewer")).toBe("Viewer");
  });

  it("reads for everyone, writes for all but the viewer, and keeps the roster to the owner", () => {
    expect(["owner", "editor", "viewer"].every(r => can(r as never, "read"))).toBe(true);
    expect(can("viewer", "write")).toBe(false);
    expect(can("editor", "write")).toBe(true);
    expect(can("editor", "manage")).toBe(false);
    expect(can("owner", "manage")).toBe(true);
  });

  it("says no to someone with no role at all", () => {
    expect(can(null, "read")).toBe(false);
  });
});

describe("the one box", () => {
  it("takes a username", () => {
    expect(whoProblem("stage_left")).toBe("");
    expect(whoProblem("  stage_left  ")).toBe("");
  });

  it("takes an address", () => {
    expect(whoProblem("dsm@theatre.org")).toBe("");
  });

  it("blames the address when there is an @ in it", () => {
    expect(whoProblem("dsm@theatre")).toMatch(/email address/);
  });

  it("blames the username when there is not", () => {
    expect(whoProblem("2fast")).toMatch(/starting with a letter/);
    expect(whoProblem("ab")).toMatch(/3 to 20/);
  });

  it("asks for something rather than nothing", () => {
    expect(whoProblem("   ")).toMatch(/Type a username/);
  });

  it("spots someone already on the roster, whatever they capitalised", () => {
    const roster = [{ username: "Stage_Left" }, { username: null }];
    expect(alreadyThere(roster, "stage_left")).toBe(true);
    expect(alreadyThere(roster, "someone_else")).toBe(false);
    // An address cannot be matched against a roster that deliberately holds no addresses.
    expect(alreadyThere(roster, "stage_left@theatre.org")).toBe(false);
  });
});
