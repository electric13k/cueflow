import { performanceAllowed } from "./cookies";

const CACHE_VERSION = "cueflow-cache-v3";

export function registerCueflowCache() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" || import.meta.env.DEV) return;
  if (!performanceAllowed()) {
    void navigator.serviceWorker.getRegistrations().then(registrations => registrations.forEach(registration => void registration.unregister()));
    if (typeof caches !== "undefined") void caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("cueflow-shell-")).map(key => caches.delete(key))));
    return;
  }
  const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  void navigator.serviceWorker.register(`${base}sw.js`, { scope: base, updateViaCache: "none" })
    .then(registration => registration.update())
    .catch(() => undefined);
}

export const cacheVersion = CACHE_VERSION;
