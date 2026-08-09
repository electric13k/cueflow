/**
 * The specular highlight on `.glass` (src/styles.css) is painted from `--gx` / `--gy` on the root
 * element with `background-attachment: fixed`, so every panel in the document needs exactly one
 * light source in viewport coordinates and no element ever has to be measured. This is the whole
 * of the JavaScript: one passive listener, no per-element handlers, no layout reads.
 *
 * Coalesced to one write per frame — pointermove fires faster than the compositor paints, and each
 * write on the root invalidates style for everything that inherits the property.
 *
 * requestAnimationFrame is the right clock here and the one place in this app where it is: it does
 * not tick in a tab that is not being painted, and a highlight nobody is looking at does not need
 * to move. A callback queued while the tab is hidden simply runs on the frame after it comes back.
 */
let x = 0, y = 0, queued = false;

function flush() {
  queued = false;
  const s = document.documentElement.style;
  s.setProperty("--gx", `${x}px`);
  s.setProperty("--gy", `${y}px`);
}

export function trackGlassPointer() {
  // The stylesheet freezes the sweep at rest under reduced motion; skip the listener too so the
  // preference costs nothing rather than writing a property nothing reads.
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  window.addEventListener("pointermove", e => {
    x = e.clientX;
    y = e.clientY;
    if (!queued) { queued = true; requestAnimationFrame(flush); }
  }, { passive: true });
}
