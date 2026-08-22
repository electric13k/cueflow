import { useEffect, useSyncExternalStore } from "react";

/**
 * Layout is two settings, not one, because a phone and a desk are not asking the same question.
 *
 * On a desk the question is how much room the hierarchy deserves, so the choice is about the side
 * panel. On a phone there is no panel at all, the sidebar is a drawer, and the only thing worth
 * choosing is how much of the screen one card is allowed to eat. One shared "layout" value would
 * have to answer both and would answer neither.
 *
 * Both are device settings and stay on the device, the same rule the theme follows: a borrowed
 * laptop keeps its own, and nothing here ever reaches a show row or the realtime channel.
 */

/**
 * Panel: the hierarchy on the left, the working area capped at a readable width.
 * Wide: the hierarchy stays, the cap goes, for a cue board on a large monitor.
 * Focus: neither, the Menu button still opens the drawer on demand.
 */
export type Pane = "panel" | "wide" | "focus";
/** Comfy: one card per row. Compact: two, at the cost of the subtitle line. */
export type Density = "comfy" | "compact";
export type Layout = { pane: Pane; density: Density };

const KEY = "cueflow:layout";
export const defaults: Layout = { pane: "panel", density: "comfy" };

const panes: Pane[] = ["panel", "wide", "focus"];
const densities: Density[] = ["comfy", "compact"];

/** A stored value that is no longer an option (a rename, a hand-edited key) reads as the default. */
export function getLayout(): Layout {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Layout>;
    return {
      pane: panes.includes(raw.pane as Pane) ? (raw.pane as Pane) : defaults.pane,
      density: densities.includes(raw.density as Density) ? (raw.density as Density) : defaults.density,
    };
  } catch { return defaults; }
}

/**
 * The attributes CSS reads. Density lands on the root rather than on each grid because the rule that
 * consumes it is inside a `max-width` query: the setting is only allowed to mean anything on a
 * screen narrow enough for it to be a real choice.
 */
export function applyLayout(l: Layout = getLayout()) {
  const root = document.documentElement;
  root.dataset.pane = l.pane;
  root.dataset.density = l.density;
}

export function setLayout(next: Partial<Layout>) {
  const merged = { ...getLayout(), ...next };
  localStorage.setItem(KEY, JSON.stringify(merged));
  applyLayout(merged);
  for (const f of subs) f();
}

/**
 * Phone or not, as state. This is a layout question rather than a styling one: the Studio does not
 * restyle itself at this width, it renders one pane instead of four stacked ones, and that is a
 * decision React has to make. CSS cannot unmount a section.
 *
 * The same 640px the stylesheet calls `sm`, written once here so the two cannot drift.
 */
const PHONE = "(max-width: 639px)";
const TABLET = "(min-width: 640px) and (max-width: 1023px)";
const TOUCH = "(any-pointer: coarse)";
const HOVER = "(hover: hover)";
const FINE = "(pointer: fine)";
const REDUCE_MOTION = "(prefers-reduced-motion: reduce)";
const REDUCE_DATA = "(prefers-reduced-data: reduce)";

type DeviceKey = `${"phone" | "tablet" | "desktop"}|${0 | 1}|${0 | 1}|${0 | 1}|${0 | 1}|${0 | 1}`;
export type DeviceKind = "phone" | "tablet" | "desktop";
export type DeviceCapabilities = {
  kind: DeviceKind;
  isPhone: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isTouch: boolean;
  canHover: boolean;
  hasFinePointer: boolean;
  reducedMotion: boolean;
  reducedData: boolean;
};

const media = (query: string) => typeof window !== "undefined" && typeof window.matchMedia === "function"
  ? window.matchMedia(query).matches : false;

function getDeviceKey(): DeviceKey {
  if (typeof window === "undefined") return "desktop|0|0|1|0|0";
  const kind: DeviceKind = media(PHONE) ? "phone" : media(TABLET) ? "tablet" : "desktop";
  const touch = media(TOUCH) || ("ontouchstart" in window) || (navigator.maxTouchPoints ?? 0) > 0;
  return `${kind}|${touch ? 1 : 0}|${media(HOVER) ? 1 : 0}|${media(FINE) ? 1 : 0}|${media(REDUCE_MOTION) ? 1 : 0}|${media(REDUCE_DATA) ? 1 : 0}` as DeviceKey;
}

const deviceQueries = [PHONE, TABLET, TOUCH, HOVER, FINE, REDUCE_MOTION, REDUCE_DATA];
function subscribeDevice(listener: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const lists = deviceQueries.map(query => window.matchMedia(query));
  lists.forEach(m => m.addEventListener("change", listener));
  window.addEventListener("resize", listener, { passive: true });
  return () => {
    lists.forEach(m => m.removeEventListener("change", listener));
    window.removeEventListener("resize", listener);
  };
}

function readDevice(key: DeviceKey): DeviceCapabilities {
  const [kind, touch, hover, fine, reducedMotion, reducedData] = key.split("|");
  return {
    kind: kind as DeviceKind,
    isPhone: kind === "phone",
    isTablet: kind === "tablet",
    isDesktop: kind === "desktop",
    isTouch: touch === "1",
    canHover: hover === "1",
    hasFinePointer: fine === "1",
    reducedMotion: reducedMotion === "1",
    reducedData: reducedData === "1",
  };
}

export function useDeviceCapabilities(): DeviceCapabilities {
  const key = useSyncExternalStore(subscribeDevice, getDeviceKey, () => "desktop|0|0|1|0|0" as DeviceKey);
  const caps = readDevice(key);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.device = caps.kind;
    root.dataset.input = caps.isTouch ? "touch" : "pointer";
    root.dataset.hover = caps.canHover ? "yes" : "no";
    root.dataset.motion = caps.reducedMotion ? "reduced" : "full";
    root.dataset.data = caps.reducedData ? "reduced" : "full";
  }, [key]);
  return caps;
}

export function useIsPhone() {
  return useDeviceCapabilities().isPhone;
}

const subs = new Set<() => void>();
function subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }

/**
 * Read as state. Settings writes it and the Shell reads it, and they are mounted at the same time on
 * the settings page itself, so the panel has to move while the radio is being clicked.
 */
export function useLayout() {
  const json = useSyncExternalStore(subscribe, () => localStorage.getItem(KEY) ?? "", () => "");
  void json; // the string is only the version token; the parsed value is what callers want
  return [getLayout(), setLayout] as const;
}
