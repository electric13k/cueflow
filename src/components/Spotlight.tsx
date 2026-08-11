import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";

export type Spot = { top: number; left: number; width: number; height: number } | null;

/** waiting: the anchor has not appeared yet. missing: it never did, so nothing should be shown. */
export type AnchorState = "waiting" | "found" | "missing";

/** How long to keep believing an anchor is about to render before giving up on it. */
const PATIENCE = 2500;
const PAD = 6;

const measure = (el: Element): Spot => {
  const r = el.getBoundingClientRect();
  // A zero-sized box is an element that is in the DOM but not laid out yet. Not found.
  if (!r.width && !r.height) return null;
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
};

/**
 * The first match that is actually on the page, not the first one in the document.
 *
 * A selector often names both halves of a responsive pair -- the sidebar link and the Menu button,
 * the tab and the pane button -- and the half that is off duty is still in the DOM with
 * `display: none`. `querySelector` would hand back that one and the tip would point at a zero-sized
 * box forever, which is the same failure as pointing at nothing.
 */
export const findAnchor = (selector: string): Element | null => {
  for (const el of document.querySelectorAll(selector)) if (measure(el)) return el;
  return null;
};

/**
 * Find the thing a tip is about, and keep pointing at it.
 *
 * The old code did this with a single `querySelector` a tick after the lesson fired, and treated a
 * miss as "show the card in the middle of the screen". That is the bug behind every tip that
 * explained a button while pointing at nothing: the buttons these lessons describe are conditionally
 * rendered, so on a first visit, with an empty board, most of them are simply not there yet.
 *
 * So a miss is now a state rather than a fallback. The caller shows nothing while `waiting`, and on
 * `missing` drops the lesson without marking it learned, so it comes back when the screen it
 * describes actually exists.
 */
export function useAnchor(selector: string | undefined, active: boolean): { spot: Spot; state: AnchorState } {
  const [spot, setSpot] = useState<Spot>(null);
  const [state, setState] = useState<AnchorState>("waiting");

  useEffect(() => {
    if (!active) { setState("waiting"); setSpot(null); return; }
    // No selector at all is a deliberate "about this screen" tip, not a miss.
    if (!selector) { setState("found"); setSpot(null); return; }

    let done = false;
    const look = () => {
      const el = findAnchor(selector);
      const next = el ? measure(el) : null;
      if (!next) return false;
      setSpot(next);
      setState("found");
      return true;
    };

    if (look()) {
      // Found: keep it accurate. The hole is in viewport coordinates, so anything that moves the
      // page moves the thing the hole was cut for.
      const again = () => { const el = findAnchor(selector); if (el) setSpot(measure(el)); };
      addEventListener("scroll", again, { passive: true, capture: true });
      addEventListener("resize", again, { passive: true });
      return () => {
        removeEventListener("scroll", again, { capture: true });
        removeEventListener("resize", again);
      };
    }

    // Not yet: watch for it, and give up after a beat rather than waiting forever.
    const observer = new MutationObserver(() => { if (!done && look()) { done = true; observer.disconnect(); } });
    observer.observe(document.body, { childList: true, subtree: true });
    // A timer, not requestAnimationFrame: rAF does not tick in a background tab, which would leave
    // the tip stuck in `waiting` until somebody came back to the window.
    const timer = setTimeout(() => { if (!done) { done = true; observer.disconnect(); setState("missing"); } }, PATIENCE);
    return () => { done = true; observer.disconnect(); clearTimeout(timer); };
  }, [selector, active]);

  return { spot, state };
}

/**
 * The lit hole and the card beside it.
 *
 * The surround is one element carrying an enormous spread shadow, so the hole in the middle is the
 * element itself. Cheaper and sharper than masking, and it means the highlighted control is
 * genuinely the only lit thing on the screen.
 */
export default function Spotlight({ spot, label, onDismiss, children }: {
  spot: Spot;
  label: string;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const CARD = 336, TALL = 190;
  const below = spot ? spot.top + spot.height + 14 : 0;
  const flip = spot ? below + TALL > innerHeight : false;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[60]" role="dialog" aria-label={label}>
        <motion.button
          aria-label="Dismiss" onClick={onDismiss}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .25 }}
          className="absolute inset-0 cursor-default"
          style={spot
            ? { top: spot.top, left: spot.left, width: spot.width, height: spot.height, right: "auto", bottom: "auto",
                borderRadius: 10, boxShadow: "0 0 0 9999px rgba(12, 9, 8, .74)", pointerEvents: "auto" }
            : { background: "rgba(12, 9, 8, .74)" }}
        />
        {spot && (
          <motion.span aria-hidden
            initial={{ opacity: 0, scale: .9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            className="pointer-events-none absolute rounded-[10px] ring-2 ring-brass"
            style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }} />
        )}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
          transition={{ duration: .3, ease: [.16, 1, .3, 1] }}
          className="glass absolute w-[min(20rem,calc(100vw-2rem))] p-5"
          style={spot
            // clientWidth, not innerWidth: the layout viewport is what the card has to fit inside,
            // and on a phone the two disagree the moment anything overflows sideways.
            ? { top: flip ? Math.max(12, spot.top - TALL + 12) : below, left: Math.max(12, Math.min(spot.left, document.documentElement.clientWidth - CARD)) }
            : { top: "50%", left: "50%", transform: "translate(-50%,-50%)" }}
        >
          {children}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
