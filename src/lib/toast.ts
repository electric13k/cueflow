// Tiny toast bus. HeroUI v3 ships a Toast with its own provider/queue plumbing; this app only
// needs "show a line of text", so a two-function pub/sub is the whole implementation.
export type Toast = { id: number; title: string; body?: string; tone?: "info" | "success" | "warn" };

const listeners = new Set<(t: Toast) => void>();
let nextId = 1;

export function toast(title: string, body?: string, tone: Toast["tone"] = "info") {
  const t: Toast = { id: nextId++, title, body, tone };
  listeners.forEach(l => l(t));
}

export function onToast(listener: (t: Toast) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

// Fires a toast at most once per browser, keyed by name, for nudges that must not nag.
export function toastOnce(key: string, title: string, body?: string, tone: Toast["tone"] = "info") {
  const k = `cueflow:toast:${key}`;
  if (localStorage.getItem(k)) return;
  localStorage.setItem(k, "1");
  toast(title, body, tone);
}
