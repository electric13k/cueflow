import { useEffect, useRef, useState } from "react";
import Stage from "../components/Stage";
import { listen, send } from "../lib/bus";
import type { Stage as StageState } from "../types";

/**
 * The projected window. Black when the cue is audio (or nothing has fired yet), and the visual
 * itself once a slide or video cue lands, so the room sees the deck rather than a blackout.
 *
 * It is a separate document, so keys pressed here never reach the Studio tab. They are forwarded
 * over the same-origin channel instead, which keeps the arrows and WASD driving cues from whichever
 * window has focus.
 */
export default function Audience() {
  const [stage, setStage] = useState<StageState>(null);
  /**
   * The pointer hides itself once the operator stops moving it, rather than being hidden outright.
   * `cursor-none` on the whole document meant there was no visible pointer over Stage's own "Tap to
   * play video" fallback, so the one control that unblocks autoplay had to be clicked blind.
   */
  const [idle, setIdle] = useState(true);
  const idleTimer = useRef(0);

  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.startsWith("Arrow") || e.key === " ") e.preventDefault();
      send({ type: "key", key: e.key });
    };
    const stir = () => {
      setIdle(false);
      clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => setIdle(true), 2000);
    };
    window.addEventListener("keydown", keys);
    window.addEventListener("pointermove", stir, { passive: true });
    const off = listen(msg => { if (msg.type === "stage") setStage(msg.stage); });
    send({ type: "hello" });
    window.focus();
    /**
     * The page behind the stage is not neutral: `body::before` paints a corner wash at `4% 108%`,
     * i.e. the bottom-left. This used to be `h-screen` (`100vh`) while the body is `min-h-dvh`, so on
     * any viewport where those differ -- mobile browsers, and a desktop popup while its toolbar
     * settles -- the stage did not reach the bottom of the document and that wash showed through as
     * a rectangle in the bottom-left corner. The flag lets the stylesheet black the document out.
     */
    document.documentElement.setAttribute("data-audience", "");
    return () => {
      window.removeEventListener("keydown", keys);
      window.removeEventListener("pointermove", stir);
      clearTimeout(idleTimer.current);
      document.documentElement.removeAttribute("data-audience");
      off();
    };
  }, []);

  return <Stage stage={stage} className={`h-dvh w-screen ${idle ? "cursor-none" : ""}`} />;
}
