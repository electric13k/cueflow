import { performanceAllowed } from "./cookies";
import { offlineWanted } from "./offline";

const CACHE_VERSION = "cueflow-cache-v5";

const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator
  && location.protocol === "https:" && !import.meta.env.DEV;

function register() {
  const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  return navigator.serviceWorker.register(`${base}sw.js`, { scope: base, updateViaCache: "none" })
    .then(registration => registration.update().catch(() => undefined));
}

export function registerCueflowCache() {
  if (!supported()) return;
  /**
   * Declining performance cookies switches the worker off -- unless this device has been explicitly
   * asked to hold a show offline, which is a direct instruction to store things locally and a
   * clearer consent than any banner. Without this exception, declining left the operator with a
   * "keep offline" button that quietly did nothing.
   */
  if (!performanceAllowed() && !offlineWanted()) {
    void navigator.serviceWorker.getRegistrations().then(registrations => registrations.forEach(registration => void registration.unregister()));
    if (typeof caches !== "undefined") void caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("cueflow-shell-")).map(key => caches.delete(key))));
    return;
  }
  void register().catch(() => undefined);
}

/** A worker that has not claimed this page cannot serve it, however much is in the cache. */
function controlling(within: number) {
  return new Promise<boolean>(resolve => {
    if (navigator.serviceWorker.controller) return resolve(true);
    const settle = (yes: boolean) => {
      navigator.serviceWorker.removeEventListener("controllerchange", onChange);
      clearTimeout(timer);
      resolve(yes);
    };
    const onChange = () => settle(true);
    const timer = setTimeout(() => settle(false), within);
    navigator.serviceWorker.addEventListener("controllerchange", onChange);
  });
}

/**
 * Register because the operator has just asked for this show to be kept on this device.
 *
 * The boot-time pass has already run by then, and on a device that declined performance cookies it
 * unregistered everything, so the session in which the button is pressed had a filling media cache
 * and no worker to serve it from. The request is the consent, so this does not consult the banner.
 *
 * Resolves only once a worker is controlling the page, because that -- not a successful download --
 * is what makes the promise of offline playback true.
 */
export async function ensureCueflowCache(): Promise<boolean> {
  if (!supported()) return false;
  if (navigator.serviceWorker.controller) return true;
  try { await register(); } catch { return false; }
  return controlling(10_000);
}

export const cacheVersion = CACHE_VERSION;
