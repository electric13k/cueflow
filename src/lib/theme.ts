export type Theme = "dark" | "light";

const KEY = "cueflow:theme";

export const getTheme = (): Theme => (localStorage.getItem(KEY) === "light" ? "light" : "dark");

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", t === "dark");
  root.dataset.theme = t; // HeroUI reads data-theme; the class keeps Tailwind's dark: variants working
  localStorage.setItem(KEY, t);
  window.dispatchEvent(new Event("cueflow:theme")); // the WebGL backdrop is dark-only and listens for this
}
