import { describe, expect, it } from "vitest";
import { friendLabel, likeLiteral } from "./friends";

describe("likeLiteral", () => {
  it("leaves an ordinary name alone", () => {
    expect(likeLiteral("marina")).toBe("marina");
  });

  it("escapes the wildcards, so a lookup cannot become a pattern", () => {
    // Unescaped, `a%` with maybeSingle() answers "does exactly one account start with a?", and
    // walking the alphabet that way reads out the directory along with everyone's uid.
    expect(likeLiteral("a%")).toBe("a\\%");
    expect(likeLiteral("a_b")).toBe("a\\_b");
  });

  it("escapes the escape character itself", () => {
    expect(likeLiteral("back\\slash")).toBe("back\\\\slash");
  });

  it("handles a name that is nothing but wildcards", () => {
    expect(likeLiteral("%%%")).toBe("\\%\\%\\%");
  });
});

describe("friendLabel", () => {
  const someone = { id: "f1", userId: "u1", accepted: true, incoming: false };

  it("prefers the name they chose for themselves", () => {
    expect(friendLabel({ ...someone, username: "marina", displayName: "Marina B" })).toBe("Marina B");
  });

  it("falls back to the handle", () => {
    expect(friendLabel({ ...someone, username: "marina", displayName: null })).toBe("marina");
  });

  it("does not show a name made only of spaces", () => {
    expect(friendLabel({ ...someone, username: "marina", displayName: "   " })).toBe("marina");
  });

  it("has something to render when the profile has not loaded", () => {
    expect(friendLabel({ ...someone, username: null, displayName: null })).toBe("Someone");
  });
});
