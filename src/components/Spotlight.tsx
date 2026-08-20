import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";

export type Spot = { top: number; left: number; width: number; height: number; radius: number } | null;

/** waiting: the anchor has not appeared yet, missing: it did not arrive in time. */
export type AnchorState = "waiting" | "found" | "missing";

/** How long to keep believing an anchor is about to render before giving up on it. */
const PATIENCE = 2500;
const PAD = 6;
const CARD_MAX = 336;
const VIEWPORT_PAD = 12;

const roundness = (el: Element, width: number, height: number) => {
  const css = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
  const radius = css ? Number.parseFloat(css.borderTopLeftRadius) : 0;
  const compact = Math.max(width, height) <= 80;
  const closeToSquare = Math.abs(width - height) <= Math.max(width, height) * 0.28;
  return compact && closeToSquare ? Math.max(radius, Math.min(width, height) / 2) : Math.min(radius, 10);
};

const measure = (el: Element): Spot => {
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  const width = r.width + PAD * 2;
  const height = r.height + PAD * 2;
  return { top: r.top - PAD, left: r.left - PAD, width, height, radius: roundness(el, width, height) };
};

/** Return the first visible match when responsive versions of a control share one selector. */
export const findAnchor = (selector: string): Element | null => {
  for (const el of document.querySelectorAll(selector)) if (measure(el)) return el;
  return null;
};

/** Find the target and keep its spotlight aligned as the layout changes. */
export function useAnchor(selector: string | undefined, active: boolean): { spot: Spot; state: AnchorState } {
  const [spot, setSpot] = useState<Spot>(null);
  const [state, setState] = useState<AnchorState>("waiting");

  useEffect(() => {
    if (!active) {
      setState("waiting");
      setSpot(null);
      return;
    }
    if (!selector) {
      setState("found");
      setSpot(null);
      return;
    }

    let done = false;
    let resizeObserver: ResizeObserver | null = null;
    const look = () => {
      const el = findAnchor(selector);
      const next = el ? measure(el) : null;
      if (!next) return false;
      setSpot(next);
      setState("found");
      return true;
    };

    if (look()) {
      const again = () => {
        const el = findAnchor(selector);
        const next = el ? measure(el) : null;
        setSpot(next);
        if (next) setState("found");
      };
      addEventListener("scroll", again, { passive: true, capture: true });
      addEventListener("resize", again, { passive: true });
      const el = findAnchor(selector);
      if (el && typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(again);
        resizeObserver.observe(el);
      }
      return () => {
        removeEventListener("scroll", again, { capture: true });
        removeEventListener("resize", again);
        resizeObserver?.disconnect();
      };
    }

    const observer = new MutationObserver(() => {
      if (!done && look()) {
        done = true;
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        observer.disconnect();
        setState("missing");
      }
    }, PATIENCE);
    return () => {
      done = true;
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [selector, active]);

  return { spot, state };
}

type CardRect = { width: number; height: number };

/** The visual instruction layer. It is pointer-transparent except for the popup card itself. */
export default function Spotlight({ spot, label, onDismiss: _onDismiss, children }: {
  spot: Spot;
  label: string;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [card, setCard] = useState<CardRect>({ width: CARD_MAX, height: 190 });
  const viewportWidth = typeof document === "undefined" ? CARD_MAX : document.documentElement.clientWidth;
  const cardWidth = Math.min(CARD_MAX, Math.max(240, viewportWidth - VIEWPORT_PAD * 2));
  const availableHeight = typeof window === "undefined" ? 720 : innerHeight;
  const below = spot ? spot.top + spot.height + 14 : 0;
  const cardHeight = Math.max(card.height, 1);
  const flip = spot ? below + cardHeight > availableHeight - VIEWPORT_PAD : false;
  const cardTop = spot
    ? flip
      ? Math.max(VIEWPORT_PAD, spot.top - cardHeight - 14)
      : Math.min(below, Math.max(VIEWPORT_PAD, availableHeight - cardHeight - VIEWPORT_PAD))
    : 0;
  const cardLeft = spot
    ? Math.max(VIEWPORT_PAD, Math.min(spot.left, viewportWidth - cardWidth - VIEWPORT_PAD))
    : 0;

  useLayoutEffect(() => {
    const update = () => {
      const el = cardRef.current;
      if (!el) return;
      const next = { width: el.offsetWidth, height: el.offsetHeight };
      setCard(current => current.width === next.width && current.height === next.height ? current : next);
    };
    update();
    if (typeof ResizeObserver === "undefined" || !cardRef.current) return;
    const observer = new ResizeObserver(update);
    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [spot, children]);

  const targetX = spot ? spot.left + spot.width / 2 : 0;
  const targetY = spot ? (flip ? spot.top + spot.height : spot.top) : 0;
  const popupX = cardLeft + cardWidth / 2;
  const popupY = flip ? cardTop + cardHeight : cardTop;

  return (
    <AnimatePresence>
      <div className="pointer-events-none fixed inset-0 z-[60]" role="dialog" aria-label={label}>
        {spot && (
          <>
            <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
              <line x1={targetX} y1={targetY} x2={popupX} y2={popupY}
                stroke="var(--cue-armed)" strokeWidth="2" strokeDasharray="4 5" opacity=".9" />
            </svg>
            <motion.span aria-hidden
              initial={{ opacity: 0, scale: .94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="pointer-events-none absolute border-2 border-brass"
              style={{
                top: spot.top,
                left: spot.left,
                width: spot.width,
                height: spot.height,
                borderRadius: spot.radius,
                boxShadow: "0 0 0 9999px rgba(12, 9, 8, .74), 0 0 24px color-mix(in srgb, var(--cue-armed) 55%, transparent)",
              }} />
          </>
        )}
        {spot ? (
          <>
            <button aria-label="Dismiss tip" onClick={_onDismiss} className="pointer-events-auto absolute inset-x-0 top-0 bg-black/70" style={{ height: Math.max(0, spot.top) }} />
            <button aria-label="Dismiss tip" onClick={_onDismiss} className="pointer-events-auto absolute left-0 bg-black/70" style={{ top: spot.top, width: Math.max(0, spot.left), height: spot.height }} />
            <button aria-label="Dismiss tip" onClick={_onDismiss} className="pointer-events-auto absolute right-0 bg-black/70" style={{ top: spot.top, left: spot.left + spot.width, height: spot.height }} />
            <button aria-label="Dismiss tip" onClick={_onDismiss} className="pointer-events-auto absolute inset-x-0 bottom-0 bg-black/70" style={{ top: spot.top + spot.height }} />
          </>
        ) : (
          <button aria-label="Dismiss tip" onClick={_onDismiss} className="pointer-events-auto absolute inset-0 bg-black/70" />
        )}
        <motion.div
          ref={cardRef}
          initial={{ opacity: 0, y: flip ? -10 : 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
          transition={{ duration: .3, ease: [.16, 1, .3, 1] }}
          className="glass pointer-events-auto absolute w-[min(21rem,calc(100vw-1.5rem))] p-5"
          style={spot
            ? { top: cardTop, left: cardLeft }
            : { top: "50%", left: "50%", transform: "translate(-50%,-50%)" }}
        >
          {children}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
