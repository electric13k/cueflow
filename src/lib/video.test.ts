import { describe, expect, it } from "vitest";
import { atempoChain, trimArgs } from "./video";

describe("video rendering helpers", () => {
  it("chains atempo values inside FFmpeg's supported range", () => {
    expect(atempoChain(1)).toEqual([1]);
    expect(atempoChain(0.25)).toEqual([0.5, 0.5]);
    expect(atempoChain(4)).toEqual([2, 2]);
  });

  it("builds a trimmed, sped-up, muted render command", () => {
    expect(trimArgs("input.webm", "out.mp4", {
      duration: 18, trimIn: 2.25, trimOut: 9.5, rate: 1.5, muted: true,
    })).toEqual([
      "-i", "input.webm", "-ss", "2.250", "-to", "9.500",
      "-filter:v", "setpts=0.6667*PTS", "-an", "-preset", "ultrafast", "out.mp4",
    ]);
  });

  it("uses the media duration when trimOut means the end", () => {
    expect(trimArgs("input.mp4", "out.mp4", {
      duration: 12, trimIn: -1, trimOut: 0, rate: 1, muted: false,
    })).toEqual(["-i", "input.mp4", "-ss", "0.000", "-to", "12.000", "-preset", "ultrafast", "out.mp4"]);
  });

  it("carries tone, blur, and rotation settings into the video filter chain", () => {
    const args = trimArgs("input.mp4", "out.mp4", {
      duration: 12, trimIn: 0, trimOut: 10, rate: 1, muted: false,
      visual: { brightness: 1.1, contrast: 1.2, saturate: 0.8, blur: 2, rotate: 90 },
    });
    expect(args).toContain("-filter:v");
    const videoFilter = args[args.indexOf("-filter:v") + 1];
    expect(videoFilter).toContain("eq=brightness=0.100:contrast=1.200:saturation=0.800");
    expect(videoFilter).toContain("boxblur=luma_radius=2");
    expect(videoFilter).toContain("rotate=1.570796");
  });
});
