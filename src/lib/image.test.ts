import { expect, test } from "vitest";
import { MODULES, moduleKeys, moduleTouched, resetModule, toggleModule, type Bypassed } from "./image";
import { defaultVisual } from "../types";

const at = (id: string) => MODULES.findIndex(m => m.id === id);
const mod = (id: string) => MODULES.find(m => m.id === id)!;

// The order is the feature. Exposure before curves before colour, and the frame settled before any
// of it -- shuffle these and every slider downstream starts lying about what it does.
test("the stack is in pipeline order, geometry first", () => {
  expect(at("orientation")).toBeLessThan(at("exposure"));
  expect(at("framing")).toBeLessThan(at("exposure"));
  expect(at("exposure")).toBeLessThan(at("curves"));
  expect(at("curves")).toBeLessThan(at("colour"));
  expect(at("colour")).toBeLessThan(at("effects"));
  // Two panes, and a module belongs to exactly one of them.
  expect(MODULES.filter(m => m.pane === "geometry").map(m => m.id)).toEqual(["orientation", "framing"]);
  expect(MODULES.filter(m => m.pane === "tone").map(m => m.id)).toEqual(["exposure", "curves", "colour", "effects"]);
  // No key is owned by two modules, or one module's reset would silently undo another's.
  const keys = MODULES.flatMap(moduleKeys);
  expect(new Set(keys).size).toBe(keys.length);
});

test("a module reads as touched only when it is away from the default", () => {
  const v = defaultVisual();
  expect(moduleTouched(v, mod("exposure"))).toBe(false);
  expect(moduleTouched({ ...v, brightness: 1.4 }, mod("exposure"))).toBe(true);
  // Its neighbours are unaffected by it.
  expect(moduleTouched({ ...v, brightness: 1.4 }, mod("curves"))).toBe(false);
  // A value with no slider still counts.
  expect(moduleTouched({ ...v, flipH: true }, mod("orientation"))).toBe(true);
});

test("switching a module off bypasses it, switching it back on brings the settings back", () => {
  const v = { ...defaultVisual(), brightness: 1.4, contrast: .6, temp: 40 };
  const [bypassed, off] = toggleModule(v, mod("exposure"), {});

  expect(bypassed.brightness).toBe(1);          // neutral while off
  expect(bypassed.contrast).toBe(.6);           // every other module untouched
  expect(bypassed.temp).toBe(40);
  expect(off.exposure).toEqual({ brightness: 1.4 });

  const [back, none] = toggleModule(bypassed, mod("exposure"), off);
  expect(back.brightness).toBe(1.4);
  expect(none).toEqual({});
});

test("modules bypass independently", () => {
  const v = { ...defaultVisual(), brightness: 1.4, contrast: .6 };
  const [a, offA] = toggleModule(v, mod("exposure"), {});
  const [b, offB] = toggleModule(a, mod("curves"), offA);
  expect(b.brightness).toBe(1);
  expect(b.contrast).toBe(1);
  expect(Object.keys(offB).sort()).toEqual(["curves", "exposure"]);

  const [c, offC] = toggleModule(b, mod("curves"), offB);
  expect(c.contrast).toBe(.6);
  expect(c.brightness).toBe(1);                 // exposure is still bypassed
  expect(Object.keys(offC)).toEqual(["exposure"]);
});

test("per-module reset clears that module and nothing else", () => {
  const v = { ...defaultVisual(), rotate: 90, flipH: true, zoom: 2, saturate: 2 };
  const r = resetModule(v, mod("orientation"));
  expect(r.rotate).toBe(0);
  expect(r.flipH).toBe(false);
  expect(r.zoom).toBe(2);
  expect(r.saturate).toBe(2);
});

test("a look saved before the stack existed has no undefined-shaped modules", () => {
  // temp and vignette are optional on older looks; they must read as untouched, not as changed.
  const old = { ...defaultVisual(), temp: undefined, vignette: undefined };
  expect(moduleTouched(old, mod("colour"))).toBe(false);
  expect(moduleTouched(old, mod("effects"))).toBe(false);
  const off: Bypassed = {};
  expect(toggleModule(old, mod("colour"), off)[1].colour).toEqual({ temp: undefined, saturate: 1 });
});
