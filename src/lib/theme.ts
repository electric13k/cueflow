import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";

/** The house dark palette can be applied globally and to nested working surfaces. */
export const DARK = "theme-dark";

const PAGE_KEY = "cueflow:theme";
const STUDIO_KEY = "cueflow:theme:studio";

const stored = (key: string): Theme => (localStorage.getItem(key) === "light" ? "light" : "dark");

/** Class names for a wrapper. The alias is required by HeroUI and Tailwind dark variants. */
export const themeClass = (t: Theme) => (t === "dark" ? `${DARK} dark` : "");

export const getTheme = (): Theme => stored(PAGE_KEY);

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  root.classList.toggle(DARK, t === "dark");
  root.classList.toggle("dark", t === "dark");
  root.dataset.theme = t;
  root.style.colorScheme = t;
  localStorage.setItem(PAGE_KEY, t);
  bump();
}

/** The device theme used by Studio, Show, Settings, and the rest of the application. */
export const getStudioTheme = (): Theme => stored(STUDIO_KEY);

export function setStudioTheme(t: Theme) {
  localStorage.setItem(STUDIO_KEY, t);
  // Portal content such as menus and dialogs renders under body, outside a scoped Studio wrapper.
  // Apply the same setting to the document so every existing surface resolves the same tokens.
  applyTheme(t);
}

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

export function onThemeChange(f: () => void) { return subscribe(f); }
export const useThemeSignal = () => useSyncExternalStore(subscribe, () => version, () => version);

export function useStudioTheme() {
  useThemeSignal();
  return [getStudioTheme(), setStudioTheme] as const;
}
