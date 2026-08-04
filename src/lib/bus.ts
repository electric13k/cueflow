import type { Stage } from "../types";

/**
 * Same-origin channel between the Studio tab and the audience window.
 *
 * BroadcastChannel rather than window.opener.postMessage: it works in both directions and does not
 * care who opened whom, so an audience window opened by hand (or reloaded, which drops `opener`)
 * still receives cues and still forwards keys.
 */
export type Msg =
  | { type: "key"; key: string }
  | { type: "stage"; stage: Stage }
  | { type: "hello" }
  /** A cue word is coming up ("warn") or has arrived ("hit"). Silent by contract: every window that
   *  receives one flashes, none of them makes a sound. */
  | { type: "alert"; level: "warn" | "hit"; message: string; cue: string }
  /** The script changed in one window; any reader open elsewhere reloads it from storage. */
  | { type: "script" };

const channel = () => ("BroadcastChannel" in globalThis ? new BroadcastChannel("cueflow") : null);
let out: BroadcastChannel | null = null;

export function send(msg: Msg) {
  out ??= channel();
  out?.postMessage(msg);
}

export function listen(on: (msg: Msg) => void) {
  const c = channel();
  if (!c) return () => {};
  c.onmessage = e => on(e.data as Msg);
  return () => c.close();
}
