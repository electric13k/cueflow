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
  | { type: "script" }
  /**
   * The deck, for a control panel running in its own window.
   *
   * An operator with two screens had nowhere to put the cue list: the Studio is one page and the
   * only thing that could be popped out was the audience view. This carries enough for a second
   * window to show the running order and call from it, and it goes out on change rather than being
   * polled, so the panel cannot drift from the desk.
   */
  | { type: "deck"; name: string; cues: ControlCue[]; index: number; armed: boolean }
  /** …and the panel calling one. Same path a click in the Studio takes. */
  | { type: "fire"; index: number };

export type ControlCue = { id: string; label: string; number: string; kind: string };

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
