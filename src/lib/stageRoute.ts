import { useLocation } from "react-router-dom";

/**
 * Is this document the projected audience window?
 *
 * Every globally mounted overlay -- the toaster, the cookie banner, the sign-in nudge, the username
 * prompt, the coach and the tour -- is mounted outside `<Routes>` in main.tsx, so each has to answer
 * this for itself. They each used to do it with `location.pathname !== "/audience"`, read from the
 * global `location` at render time, and that string compare broke in three separate ways:
 *
 *   - `/audience/` with a trailing slash did not match, and the banners rendered on the projected
 *     screen as a narrow glass column pinned to the bottom-left corner;
 *   - a build with a non-root base (`vite.config.ts` reads `BASE_PATH`) opens the window at
 *     `<base>/audience`, which never matched either;
 *   - reading the global `location` is not reactive, so a client-side navigation left the answer
 *     stale until something else re-rendered.
 *
 * `useLocation` fixes all three at once: react-router has already stripped the basename, and the
 * value updates on navigation. Trailing slashes are trimmed here.
 */
export function useOnStage(): boolean {
  const { pathname } = useLocation();
  return pathname.replace(/\/+$/, "") === "/audience";
}
