const CACHE_VERSION = "cueflow-cache-v2";

export function registerCueflowCache() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" || import.meta.env.DEV) return;
  const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  void navigator.serviceWorker.register(`${base}sw.js`, { scope: base, updateViaCache: "none" })
    .then(registration => registration.update())
    .catch(() => undefined);
}

export const cacheVersion = CACHE_VERSION;
