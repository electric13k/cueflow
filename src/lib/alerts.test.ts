import { beforeEach, describe, expect, it } from "vitest";
import { loadAlertScope, saveAlertScope } from "./alerts";

describe("alert scope", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to the operator surface", () => {
    expect(loadAlertScope()).toBe("operator");
  });

  it("persists script-only scope", () => {
    saveAlertScope("script");
    expect(loadAlertScope()).toBe("script");
  });
});
