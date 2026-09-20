import { describe, expect, it } from "vitest";
import { scriptPosition, scrollToPosition } from "./ScriptReader";

/** Kept in step with the reader: the line is 38% down the box, not at its top edge. */
const READ_LINE = .38;
/** What is on screen, and one paragraph. A block taller than `VIEW * READ_LINE` so that a box at
 *  the top has its first block under the line, which is what a reader actually looks like. */
const VIEW = 400;
const BLOCK = 200;
const LINE = VIEW * READ_LINE;

const rect = (top: number, height: number) => ({
  top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}),
}) as DOMRect;

/**
 * happy-dom does no layout, so the geometry is modelled here rather than stubbed flat: blocks
 * stacked down the content, and rects that move when the box scrolls. A stub that returns the same
 * rect whatever `scrollTop` says would pass a round-trip test that measures nothing.
 */
function makeBox(count: number, { height = BLOCK, gap = 0, pad = 0 } = {}) {
  const box = document.createElement("div");
  let scrollTop = 0;
  const content = pad + count * (height + gap);
  for (let i = 0; i < count; i++) box.appendChild(document.createElement("p"));
  Object.defineProperty(box, "clientHeight", { get: () => VIEW });
  Object.defineProperty(box, "scrollHeight", { get: () => Math.max(content, VIEW) });
  Object.defineProperty(box, "scrollTop", { get: () => scrollTop, set: (to: number) => { scrollTop = to; } });
  box.getBoundingClientRect = () => rect(0, VIEW);
  [...box.children].forEach((block, i) => {
    (block as HTMLElement).getBoundingClientRect = () => rect(pad + i * (height + gap) - scrollTop, height);
  });
  return box;
}
const maxScroll = (box: HTMLElement) => box.scrollHeight - box.clientHeight;

describe("scriptPosition", () => {
  it("puts a box at the top inside its first block", () => {
    const at = scriptPosition(makeBox(5));
    expect(Math.floor(at)).toBe(0);
    expect(at).toBeCloseTo(LINE / BLOCK, 6);
  });

  it("grows the fraction as the line moves down a block, and never reaches 1", () => {
    const box = makeBox(5);
    const start = scriptPosition(box);
    box.scrollTop = 40;
    const later = scriptPosition(box);
    expect(later).toBeGreaterThan(start);
    expect(Math.floor(later)).toBe(0);
    // A hair before the second block reaches the line. The fraction may approach 1, never arrive:
    // a position of exactly 1 names the block after the one the line is in.
    box.scrollTop = BLOCK - LINE - .1;
    const edge = scriptPosition(box);
    expect(edge).toBeLessThan(1);
    expect(edge).toBeGreaterThan(.999);
  });

  it("keeps the fraction under 1 when the line falls in the gap between two blocks", () => {
    // Paragraph margins leave real gaps, and the last block above the line can end well short of
    // it. Without the clamp that reports a position inside the block that has not arrived yet.
    const box = makeBox(5, { gap: 80 });
    box.scrollTop = BLOCK + 40 - LINE;
    const at = scriptPosition(box);
    expect(at).toBeLessThan(1);
    expect(at).toBeGreaterThan(.999);
  });

  it("returns 0 when the box is scrolled above the first block", () => {
    expect(scriptPosition(makeBox(3, { pad: LINE + 50 }))).toBe(0);
  });

  it("returns 0 for a box with no blocks in it", () => {
    expect(scriptPosition(document.createElement("div"))).toBe(0);
  });
});

describe("scrollToPosition", () => {
  it("round-trips through scriptPosition", () => {
    const box = makeBox(10);
    for (const at of [3.25, 5.5, 7.875]) {
      scrollToPosition(box, at);
      expect(scriptPosition(box)).toBeCloseTo(at, 6);
    }
  });

  it("round-trips with gaps between the blocks", () => {
    const box = makeBox(10, { gap: 24, pad: 16 });
    scrollToPosition(box, 4.4);
    expect(scriptPosition(box)).toBeCloseTo(4.4, 6);
  });

  it("clamps a position past the last block instead of throwing", () => {
    const box = makeBox(6);
    scrollToPosition(box, 99.5);
    expect(box.scrollTop).toBe(maxScroll(box));
  });

  it("clamps a position above the first block to the top", () => {
    const box = makeBox(6);
    box.scrollTop = 300;
    scrollToPosition(box, 0);
    expect(box.scrollTop).toBe(0);
  });

  it("does nothing to a box with no blocks in it", () => {
    const box = document.createElement("div");
    Object.defineProperty(box, "clientHeight", { get: () => VIEW });
    Object.defineProperty(box, "scrollHeight", { get: () => VIEW });
    expect(() => scrollToPosition(box, 3)).not.toThrow();
    expect(box.scrollTop).toBe(0);
  });
});
