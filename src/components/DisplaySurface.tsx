import { useEffect, useRef, useState } from "react";
import Stage from "./Stage";
import type { Stage as StageState } from "../types";

/**
 * The screen the audience is looking at.
 *
 * Every other device in a show is held by a person who can touch it, and the page is built around
 * that: a header, a sound toggle, a leave button, a box to flash a line to the room. Pointed at an
 * audience, every one of those is a way for a stray press to change the show in front of the
 * paying public, so none of them is here. There is the stage, black around it, and nothing else.
 */
export default function DisplaySurface({ stage, started, armed, onArm, onLeave }: {
  stage: StageState;
  /** When the show went live. Once it is set the way out disappears; see below. */
  started: string | null;
  /** Whether the arming press has happened. `Show.tsx` holds it, because it is the same flag the cue audio gate reads. */
  armed: boolean;
  onArm: () => void;
  onLeave: () => void;
}) {
  /**
   * Latched, rather than read straight off `armed` every render. The prompt is a wall of text over
   * whatever the audience is watching, and it must never come back mid-show because something
   * upstream reset the sound flag.
   */
  const [pressed, setPressed] = useState(false);
  /**
   * A display is left alone all night. Without this the last person to touch the machine leaves a
   * mouse pointer sitting on the audience's screen until somebody notices it.
   */
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef(0);

  useEffect(() => {
    const wake = () => {
      setIdle(false);
      window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => setIdle(true), 2000);
    };
    window.addEventListener("mousemove", wake);
    wake();
    return () => {
      window.removeEventListener("mousemove", wake);
      window.clearTimeout(idleTimer.current);
    };
  }, []);

  return (
    <div className="fixed inset-0 bg-black" style={idle ? { cursor: "none" } : undefined}>
      {/*
        * Unmuted, which is the one place in this app where unmuted is correct. The crew screen
        * forces `muted: true` on every stage it is sent, because a phone in the wings playing the
        * soundtrack out loud is the worst thing it could do. This device is the opposite one: if it
        * makes no sound, the audience gets a silent film.
        */}
      <Stage stage={stage ? { ...stage, visual: { ...stage.visual, muted: false } } : null} className="h-full w-full" />

      {/*
        * A browser will not start audio before a person has pressed something, and the press has to
        * be the same gesture that builds the audio context. So there is one press target, it is the
        * whole screen, and after it the screen is the show for the rest of the night.
        */}
      {!pressed && !armed && (
        <button type="button" onClick={() => { setPressed(true); onArm(); }}
          className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-black p-8 text-center text-white">
          <span className="max-w-xl text-lead text-white/70">
            This screen is about to become the audience's. Press anywhere to let sound and video out of it.
          </span>
          <span className="rounded-2xl bg-white px-8 py-4 text-heading font-semibold text-black">Ready the screen</span>
        </button>
      )}

      {/*
        * The one control, and only until the show is live. A display that cannot be left is a
        * display somebody has to clear by closing the browser, and a "Leave" sitting under the
        * audience's eyeline during a performance is a press waiting to happen.
        */}
      {(pressed || armed) && !started && (
        <button type="button" onClick={onLeave}
          className="absolute bottom-3 right-3 rounded-lg px-3 py-2 text-micro text-white/25 transition-colors hover:text-white/60">
          Leave
        </button>
      )}
    </div>
  );
}
