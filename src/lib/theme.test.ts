import { beforeEach, expect, test } from "vitest";
import { applyTheme, DARK, getStudioTheme, getTheme, onThemeChange, setStudioTheme, themeClass } from "./theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
});

test("the page is dark unless someone stored light mode", () => {
  expect(getTheme()).toBe("dark");
  expect(getStudioTheme()).toBe("dark");
});

test("applyTheme scopes the page and persists it", () => {
  applyTheme("dark");
  expect(document.documentElement.classList.contains(DARK)).toBe(true);
  expect(getTheme()).toBe("dark");
  applyTheme("light");
  expect(document.documentElement.classList.contains(DARK)).toBe(false);
  expect(getTheme()).toBe("light");
});

// The setting is shared so app chrome, working surfaces, and portal content stay in sync.
test("the studio setting synchronizes the document theme", () => {
  setStudioTheme("dark");
  expect(getStudioTheme()).toBe("dark");
  expect(getTheme()).toBe("dark");
  expect(document.documentElement.classList.contains(DARK)).toBe(true);
  expect(themeClass("light")).toBe("");
});

/**
 * The regression behind "the dark toggle only darkens some things". The house palette is nine
 * tokens; every card, input, popover and separator resolves through HeroUI's forty-odd, and those
 * only go dark under `.dark`. A scope carrying only `theme-dark` leaves white cards on a dark page.
 */
test("the dark scope carries the alias HeroUI's own tokens are keyed on", () => {
  const classes = themeClass("dark").split(" ");
  expect(classes).toContain(DARK);
  expect(classes).toContain("dark");
});

// This is the signal every canvas draw effect hangs off. If it stops firing, the waveform, the
// ruler and the selection keep the old palette until unrelated state moves -- which was the bug.
test("a theme change signals subscribers, page-wide or scoped", () => {
  let hits = 0;
  const off = onThemeChange(() => { hits++; });
  applyTheme("dark");
  expect(hits).toBe(1);
  setStudioTheme("dark");
  expect(hits).toBe(2);
  off();
  applyTheme("light");
  expect(hits).toBe(2);
});
