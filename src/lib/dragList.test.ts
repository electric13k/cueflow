import { afterEach, expect, test, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { useDragList } from "./dragList";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Renders the hook and hands back whatever it last returned. */
const mount = () => {
  let api!: ReturnType<typeof useDragList>;
  const Probe = () => { api = useDragList(() => {}); return null; };
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
  return () => api;
};
const finger = (y: number) => ({
  clientX: 0, clientY: y, pointerId: 1, pointerType: "touch",
  currentTarget: document.createElement("div"), preventDefault() {},
});

afterEach(() => vi.useRealTimers());

// The bug this exists to prevent: a thumb scrolling the deck past a grip and taking a cue with it.
test("a finger that moves before the hold is up is a scroll, and never lifts a row", () => {
  vi.useFakeTimers();
  const get = mount();
  act(() => get().start(0)(finger(100)));
  act(() => get().move({ clientX: 0, clientY: 140 }));
  act(() => { vi.advanceTimersByTime(400); });
  expect(get().dragging).toBe(false);
});

test("a finger held still lifts the row, but not before the hold is up", () => {
  vi.useFakeTimers();
  const get = mount();
  act(() => get().start(0)(finger(100)));
  act(() => { vi.advanceTimersByTime(100); });
  expect(get().dragging).toBe(false);
  act(() => { vi.advanceTimersByTime(100); });
  expect(get().dragging).toBe(true);
});

// Reorder mode is the explicit opt-in: no hold, and the grip stops giving the scroll back.
test("reorder mode lifts on contact", () => {
  vi.useFakeTimers();
  const get = mount();
  act(() => get().setReorder(true));
  act(() => get().start(2)(finger(100)));
  expect(get().dragging).toBe(true);
  expect(get().drag).toEqual({ from: 2, to: 2 });
});
