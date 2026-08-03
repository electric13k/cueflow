import { describe, expect, it } from "vitest";
import { prettyName, uniqueTitle } from "./media";

describe("prettyName", () => {
  it("cleans up ordinary exports", () => {
    expect(prettyName("airhorn-2_final.mp3", "file")).toBe("Airhorn 2 Final");
    expect(prettyName("IMG_2481.JPG", "file")).toBe("IMG 2481");
    expect(prettyName("vineBoomSound.wav", "file")).toBe("Vine Boom Sound");
  });

  // The glitch: filenames are not URLs. Each of these used to come back mangled or throw.
  it("leaves filenames alone that URL parsing would eat", () => {
    expect(prettyName("50% off.wav", "file")).toBe("50% Off");        // decodeURIComponent threw
    expect(prettyName("act 1 #2.wav", "file")).toBe("Act 1 #2");      // "#2" read as a fragment
    expect(prettyName("100%.mp3", "file")).toBe("100%");
    expect(prettyName("a?b.mp3", "file")).toBe("A?B");                // "?b" read as a query
  });

  it("still unpacks real URLs", () => {
    expect(prettyName("https://example.com/sounds/%20vine%20boom_45123.mp3")).toBe("Vine Boom");
    expect(prettyName("https://example.com/a/b/thunder-clap.ogg?token=xyz")).toBe("Thunder Clap");
  });

  it("never returns an empty title", () => {
    expect(prettyName("", "file")).toBe("Untitled");
    expect(prettyName(".mp3", "file")).toBe("Untitled");
  });
});

describe("uniqueTitle", () => {
  it("numbers collisions instead of overwriting them", () => {
    expect(uniqueTitle("Airhorn", [])).toBe("Airhorn");
    expect(uniqueTitle("Airhorn", ["Airhorn"])).toBe("Airhorn 2");
    expect(uniqueTitle("Airhorn", ["airhorn", "Airhorn 2"])).toBe("Airhorn 3");
  });
});
