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
 */
const EDGE = 96;   // px from the viewport edge where autoscroll kicks in
const MAX = 22;    // px per frame at the very edge

export type Drag = { from: number; to: number } | null;

/** items with `from` moved to `to`, the preview the list renders while a drag is in flight. */
export const moved = <T,>(items: T[], from: number, to: number) => {
  if (from === to) return items;
  const next = items.slice();
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
};

export function useDragList(onCommit: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<Drag>(null);
  const list = useRef<HTMLOListElement | null>(null);
  const state = useRef({ y: 0, speed: 0, frame: 0, drag: null as Drag });
  state.current.drag = drag;

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

  const start = (index: number) => (e: { clientY: number; pointerId: number; currentTarget: Element; preventDefault(): void }) => {
    e.preventDefault();
    // Capture keeps the moves coming to the grip once the pointer leaves it. Not fatal if the
    // browser refuses (an already-released pointer), so the drag still starts either way.
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* not captured */ }
    state.current.y = e.clientY;
    setDrag({ from: index, to: index });
    cancelAnimationFrame(state.current.frame);
    state.current.frame = requestAnimationFrame(step);
  };

  const move = (e: { clientY: number }) => {
    const s = state.current;
    if (!s.drag) return;
    s.y = e.clientY;
    const over = e.clientY - (innerHeight - EDGE), under = EDGE - e.clientY;
    s.speed = over > 0 ? Math.min(MAX, (over / EDGE) * MAX) : under > 0 ? -Math.min(MAX, (under / EDGE) * MAX) : 0;
    setDrag(d => (d ? { ...d, to: indexAt(e.clientY) } : d));
  };

  const end = () => {
    const d = state.current.drag;
    cancelAnimationFrame(state.current.frame);
    state.current.speed = 0;
    setDrag(null);
    if (d && d.from !== d.to) onCommit(d.from, d.to);
  };

  useEffect(() => () => cancelAnimationFrame(state.current.frame), []);

  return { drag, list, start, move, end, dragging: drag !== null };
}
