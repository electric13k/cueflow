import { describe, expect, it } from "vitest";
import { detectPlatform } from "./Download";

/**
 * Real strings, copied from real browsers, because every mistake this function can make is a
 * mistake about one specific substring. An iPhone saying "like Mac OS X" and an Android phone
 * saying "Linux" are the two that bite, and a synthetic string would not contain either.
 */
const AGENTS = {
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  windowsFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  linuxFirefox: "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  chromeos: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

describe("detectPlatform", () => {
  it("reads a desktop user agent string", () => {
    expect(detectPlatform({ userAgent: AGENTS.windows })).toBe("windows");
    expect(detectPlatform({ userAgent: AGENTS.windowsFirefox })).toBe("windows");
    expect(detectPlatform({ userAgent: AGENTS.macos })).toBe("macos");
    expect(detectPlatform({ userAgent: AGENTS.linux })).toBe("linux");
    expect(detectPlatform({ userAgent: AGENTS.linuxFirefox })).toBe("linux");
  });

  it("does not mistake a phone for the desktop it name-drops", () => {
    // "Linux; Android" would match the Linux test, and "like Mac OS X" would match the macOS one.
    expect(detectPlatform({ userAgent: AGENTS.android })).toBe("android");
    expect(detectPlatform({ userAgent: AGENTS.iphone })).toBe("ios");
    expect(detectPlatform({ userAgent: AGENTS.ipad })).toBe("ios");
  });

  it("sends Chrome OS to the Linux builds", () => {
    expect(detectPlatform({ userAgent: AGENTS.chromeos })).toBe("linux");
    expect(detectPlatform({ platform: "Chrome OS" })).toBe("linux");
  });

  it("prefers the client hint, which is the part Chrome has not frozen", () => {
    expect(detectPlatform({ platform: "Windows" })).toBe("windows");
    expect(detectPlatform({ platform: "macOS" })).toBe("macos");
    expect(detectPlatform({ platform: "Linux" })).toBe("linux");
    expect(detectPlatform({ platform: "Android" })).toBe("android");
    expect(detectPlatform({ platform: "iOS" })).toBe("ios");
    // A reduced Android string still claims to be a Pixel-less desktop Linux; the hint wins.
    expect(detectPlatform({ platform: "Android", userAgent: AGENTS.linux })).toBe("android");
  });

  it("falls back to the string when the hint is absent or useless", () => {
    expect(detectPlatform({ platform: "Unknown", userAgent: AGENTS.macos })).toBe("macos");
    expect(detectPlatform({ platform: "", userAgent: AGENTS.android })).toBe("android");
  });

  it("says unknown rather than guessing", () => {
    expect(detectPlatform()).toBe("unknown");
    expect(detectPlatform({ userAgent: "curl/8.9.1" })).toBe("unknown");
  });
});
