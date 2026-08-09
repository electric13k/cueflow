import { beforeEach, expect, test } from "vitest";
import { applyTheme, DARK, getStudioTheme, getTheme, onThemeChange, setStudioTheme, themeClass } from "./theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
});

test("the page is beige unless someone stored otherwise", () => {
  expect(getTheme()).toBe("light");
  expect(getStudioTheme()).toBe("light");
});

test("applyTheme scopes the page and persists it", () => {
  applyTheme("dark");
  expect(document.documentElement.classList.contains(DARK)).toBe(true);
  expect(getTheme()).toBe("dark");
  applyTheme("light");
  expect(document.documentElement.classList.contains(DARK)).toBe(false);
  expect(getTheme()).toBe("light");
});

// The Studio's theme is a class on a wrapper, so it must not touch <html> or the page's own setting.
test("the studio theme is scoped, not global", () => {
  setStudioTheme("dark");
  expect(getStudioTheme()).toBe("dark");
  expect(getTheme()).toBe("light");
  expect(document.documentElement.classList.contains(DARK)).toBe(false);
  expect(themeClass(getStudioTheme())).toBe(DARK);
  expect(themeClass("light")).toBe("");
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
