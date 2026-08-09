import { useEffect, useRef, useState } from "react";

/**
 * Pointer-based list reordering.
 *
 * The old version used HTML5 drag-and-drop, which meant three problems at once: it does nothing on
 * a touchscreen, it demanded the pointer land exactly on a row, and it committed a reorder on every
 * dragover, so one drag wrote to the cloud dozens of times.
 *
 * This one picks the row whose midpoint the pointer has passed rather than the row it happens to be
 * over, previews the new order locally, scrolls the page when you drag near an edge, and commits
 * once on release.
 *
 * On a touchscreen a grip competes with the page scroll, so a finger lifts a row only after holding
 * it still for HOLD ms, or immediately, once reorder mode is switched on.
 *
 * The same lift also carries a row out of its list: pass `onDrop` and whatever is under the pointer
 * is looked up by `[data-drop]`, so a sequence lands on a show and a sound lands on a sequence with
 * the hold, the haptic, the autoscroll and the scroll-refusal already solved once here.
 */
const EDGE = 96;   // px from the viewport edge where autoscroll kicks in
const MAX = 22;    // px per frame at the very edge
const HOLD = 150;  // ms a finger must sit still on the grip before the row lifts
const SLOP = 10;   // px of movement inside that window that means "scroll", not "drag"

export type Drag = { from: number; to: number } | null;

/** items with `from` moved to `to`, the preview the list renders while a drag is in flight. */
export const moved = <T,>(items: T[], from: number, to: number) => {
  if (from === to) return items;
  const next = items.slice();
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
};

/** What the pointer is over, by `data-drop`, or null when it is over nothing droppable. */
const dropAt = (x: number, y: number) =>
  (document.elementFromPoint(x, y)?.closest("[data-drop]") as HTMLElement | null)?.dataset.drop ?? null;

export function useDragList(onCommit: (from: number, to: number) => void, onDrop?: (index: number, target: string) => void) {
  const [drag, setDrag] = useState<Drag>(null);
  const [over, setOver] = useState<string | null>(null);
  /**
   * Reorder mode, explicit and off by default. On, a grip takes the touch the instant it lands and
   * stops claiming any scroll of its own; off, a row has to be held still first. Either way a scroll
   * that started as a scroll can never turn into a drag, which is the whole reason this exists.
   */
  const [reorder, setReorder] = useState(false);
  const list = useRef<HTMLOListElement | null>(null);
  const state = useRef({ x: 0, y: 0, speed: 0, frame: 0, hold: 0, pending: -1, drag: null as Drag, reorder: false, over: null as string | null });
  state.current.drag = drag;
  state.current.reorder = reorder;
  state.current.over = over;

  /** The row the pointer has reached, by midpoint, so a fast drag never outruns the target. */
  const indexAt = (y: number) => {
    const rows = [...(list.current?.children ?? [])] as HTMLElement[];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return Math.max(0, rows.length - 1);
  };

  const step = () => {
    const s = state.current;
    if (!s.drag) return;
    if (s.speed) {
      scrollBy(0, s.speed);
      setDrag(d => (d ? { ...d, to: indexAt(s.y) } : d)); // the list slid, so the target may have changed
    }
    s.frame = requestAnimationFrame(step);
  };

  /**
   * `touch-action` decides what a gesture may become before it starts; it cannot revoke a scroll the
   * browser has already granted. A lifted row therefore refuses touchmove itself — non-passive, or
   * preventDefault is ignored.
   */
  const block = useRef((e: TouchEvent) => e.preventDefault()).current;

  const lift = (index: number) => {
    navigator.vibrate?.(12); // the row left the list; on a phone that is felt, not seen
    addEventListener("touchmove", block, { passive: false });
    setDrag({ from: index, to: index });
    cancelAnimationFrame(state.current.frame);
    state.current.frame = requestAnimationFrame(step);
  };
  const forget = () => { clearTimeout(state.current.hold); state.current.pending = -1; };

  const start = (index: number) => (e: { clientX?: number; clientY: number; pointerId: number; pointerType?: string; currentTarget: Element; preventDefault(): void }) => {
    const s = state.current;
    // Capture keeps the moves coming to the grip once the pointer leaves it. Not fatal if the
    // browser refuses (an already-released pointer), so the drag still starts either way.
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* not captured */ }
    s.x = e.clientX ?? 0; s.y = e.clientY;
    // A mouse on a grip means it. A finger has to hold still first, or every scroll that happens to
    // begin on a row is a reorder nobody asked for.
    if (e.pointerType !== "touch" || s.reorder) { e.preventDefault(); return lift(index); }
    forget();
    s.pending = index;
    s.hold = window.setTimeout(() => { s.pending = -1; lift(index); }, HOLD);
  };

  const move = (e: { clientX?: number; clientY: number }) => {
    const s = state.current;
    if (s.pending >= 0) {
      // Moved before the hold was up: that was a scroll, and it stays one.
      if (Math.abs(e.clientY - s.y) > SLOP || Math.abs((e.clientX ?? 0) - s.x) > SLOP) forget();
      return;
    }
    if (!s.drag) return;
    s.y = e.clientY;
    if (onDrop) setOver(dropAt(e.clientX ?? 0, e.clientY));
    const past = e.clientY - (innerHeight - EDGE), under = EDGE - e.clientY;
    s.speed = past > 0 ? Math.min(MAX, (past / EDGE) * MAX) : under > 0 ? -Math.min(MAX, (under / EDGE) * MAX) : 0;
    setDrag(d => (d ? { ...d, to: indexAt(e.clientY) } : d));
  };

  const end = () => {
    const d = state.current.drag, target = state.current.over;
    forget();
    removeEventListener("touchmove", block);
    cancelAnimationFrame(state.current.frame);
    state.current.speed = 0;
    setDrag(null);
    setOver(null);
    if (!d) return;
    // Dropped on something: that is the whole gesture, and the list it came from keeps its order.
    if (target && onDrop) onDrop(d.from, target);
    else if (d.from !== d.to) onCommit(d.from, d.to);
  };

  useEffect(() => () => { forget(); removeEventListener("touchmove", block); cancelAnimationFrame(state.current.frame); }, []);

  return { drag, over, list, start, move, end, dragging: drag !== null, reorder, setReorder };
}
