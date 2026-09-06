import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contrast, checked against the real stylesheet rather than against a copy of it.
 *
 * Three text colours were below the readable threshold and nothing said so, because a colour choice
 * is a judgement call at the moment it is made and a measurement for ever afterwards. Reading the
 * declarations out of `styles.css` means a well-meant re-tint that darkens a label back under the
 * line fails here instead of shipping.
 */
const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

/** The last declaration wins in CSS, and the dark block is declared after the light one. */
function token(name: string, theme: "light" | "dark") {
  const found = [...css.matchAll(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`, "g"))].map(m => m[1]);
  expect(found.length, `--${name} should be declared for both themes`).toBeGreaterThanOrEqual(2);
  return theme === "light" ? found[0] : found[found.length - 1];
}

const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16) / 255;
const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) =>
  0.2126 * linear(channel(hex, 1)) + 0.7152 * linear(channel(hex, 3)) + 0.0722 * linear(channel(hex, 5));

export function contrast(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** WCAG AA for body text. Large text is allowed 3:1, but none of these are only ever large. */
const READABLE = 4.5;

describe("contrast()", () => {
  it("agrees with the two ratios everyone knows", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrast("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
  });

  it("does not care which way round the colours are given", () => {
    expect(contrast("#123456", "#FEDCBA")).toBeCloseTo(contrast("#FEDCBA", "#123456"), 6);
  });
});

for (const theme of ["light", "dark"] as const) {
  describe(`${theme} theme text colours`, () => {
    const page = token("background", theme);
    // Panels sit above the page, so a colour can pass on one and fail on the other. Both are checked
    // because every one of these labels appears on both.
    const panel = token("surface", theme);

    it.each([
      ["cue-brass-text", "the eyebrow and rail labels"],
      ["cue-live-text", "the on-air label"],
      ["foreground", "body text"],
      ["muted", "secondary text"],
    ])("%s reads on the page and on a panel (%s)", name => {
      const colour = token(name, theme);
      expect(contrast(colour, page)).toBeGreaterThanOrEqual(READABLE);
      expect(contrast(colour, panel)).toBeGreaterThanOrEqual(READABLE);
    });
  });
}

describe("the split between an object's colour and its label's", () => {
  it("keeps the armed and live objects at their own value", () => {
    // The point of the split: the frame stays amber, only the word moved.
    expect(css).toMatch(/--color-armed:\s*var\(--cue-armed\)/);
    expect(css).toMatch(/--color-brass:\s*var\(--cue-brass-text\)/);
    expect(css).toMatch(/--color-live:\s*var\(--cue-live-text\)/);
  });
});
