import { expect, test } from "vitest";
import { trackGlassPointer } from "./glass";

const move = (x: number, y: number) =>
  window.dispatchEvent(Object.assign(new Event("pointermove"), { clientX: x, clientY: y }));
const frame = () => new Promise(r => requestAnimationFrame(() => r(null)));

// The whole point of the throttle: a burst of moves inside one frame must cost one property write,
// and the write must be the position the pointer actually ended at, not the first one seen.
test("a burst of pointer moves costs one root write, at the last position", async () => {
  trackGlassPointer();
  const root = document.documentElement;

  move(10, 20);
  move(30, 40);
  move(51, 62);
  expect(root.style.getPropertyValue("--gx")).toBe("");

  await frame();
  await frame();
  expect(root.style.getPropertyValue("--gx")).toBe("51px");
  expect(root.style.getPropertyValue("--gy")).toBe("62px");
});
