import { beforeEach, describe, expect, it } from "vitest";
import { getConsent, saveConsent } from "./cookies";

describe("cookie consent", () => {
  beforeEach(() => {
    document.cookie = "cueflow:consent=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  });

  it("starts unset", () => {
    expect(getConsent()).toEqual({ analytics: "unset", performance: "accepted" });
  });

  it("persists explicit analytics opt-in and opt-out", () => {
    saveConsent({ analytics: "accepted" });
    expect(getConsent()).toEqual({ analytics: "accepted", performance: "accepted" });
    saveConsent({ analytics: "declined" });
    expect(getConsent()).toEqual({ analytics: "declined", performance: "accepted" });
  });

  it("reads the previous binary cookie values", () => {
    document.cookie = "cueflow:consent=accepted; path=/";
    expect(getConsent()).toEqual({ analytics: "accepted", performance: "accepted" });
    document.cookie = "cueflow:consent=declined; path=/";
    expect(getConsent()).toEqual({ analytics: "declined", performance: "accepted" });
    saveConsent({ analytics: "accepted", performance: "declined" });
    expect(getConsent()).toEqual({ analytics: "accepted", performance: "declined" });
  });
});
