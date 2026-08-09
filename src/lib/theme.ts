import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";

/**
 * Theming is a class on an element, never a global mode.
 *
 * `theme-dark` sets the whole token set, and custom properties inherit, so putting it on <html>
 * themes the page and putting it on a wrapper themes only that subtree. The page itself is beige;
 * dark is opt-in, and later only inside the Studio and the Show where a host asks for it.
 */
export const DARK = "theme-dark";

const PAGE_KEY = "cueflow:theme";
const STUDIO_KEY = "cueflow:theme:studio";

const stored = (key: string): Theme => (localStorage.getItem(key) === "dark" ? "dark" : "light");

/** Class name for a wrapper: `<div className={themeClass(t)}>` re-themes everything inside it. */
export const themeClass = (t: Theme) => (t === "dark" ? DARK : "");

export const getTheme = (): Theme => stored(PAGE_KEY);

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  root.classList.toggle(DARK, t === "dark");
  root.classList.toggle("dark", t === "dark"); // keeps Tailwind's dark: variants working
  root.dataset.theme = t;                      // HeroUI reads data-theme
  localStorage.setItem(PAGE_KEY, t);
  bump();
}

/** The scoped theme the Studio and the Show run under. Read it, wrap with themeClass(), done. */
export const getStudioTheme = (): Theme => stored(STUDIO_KEY);

export function setStudioTheme(t: Theme) {
  localStorage.setItem(STUDIO_KEY, t);
  bump();
}

/**
 * The theme signal.
 *
 * A canvas gets no CSS, so every canvas has to re-read the palette and repaint when the theme
 * moves. Nothing in the DOM tells it that happened: the tokens change value without any of the
 * canvas's own props changing, so a draw effect keyed on drawing state alone paints the old palette
 * until something unrelated moves. This is the missing dependency. Put `useThemeSignal()` in the
 * deps array of a draw effect and the canvas repaints on every theme change, scoped or global.
 *
 * Both writers above call bump() directly; the observer catches a class set on <html> by anything
 * else (a devtools poke, another tab's storage sync, a future host control).
 */
let version = 0;
const subs = new Set<() => void>();
let obs: MutationObserver | null = null;
const bump = () => { version++; for (const f of subs) f(); };

function subscribe(f: () => void) {
  if (!subs.size) {
    obs = new MutationObserver(bump);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
  }
  subs.add(f);
  return () => {
    subs.delete(f);
    if (!subs.size) { obs?.disconnect(); obs = null; }
  };
}

/** Non-React subscribers (and the test) use this; the hook is a thin wrapper over it. */
export function onThemeChange(f: () => void) { return subscribe(f); }

export const useThemeSignal = () => useSyncExternalStore(subscribe, () => version, () => version);

/**
 * The working theme, read as state. Every surface that offers the toggle reads it through here, so
 * the Studio, the show manager, a joined role's screen and the Settings switch are all the same
 * value and move together the moment any one of them writes.
 *
 * It is a device setting and stays one: it is written to localStorage and to nothing else, never to
 * a show row and never onto the realtime channel, so one operator wanting a dark control screen in
 * a blackout leaves everybody else's screen exactly as it was.
 */
export function useStudioTheme() {
  useThemeSignal();
  return [getStudioTheme(), setStudioTheme] as const;
}
