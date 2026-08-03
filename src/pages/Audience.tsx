import { useEffect, useState } from "react";
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

  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return; // leave browser shortcuts alone
      if (e.key.startsWith("Arrow") || e.key === " ") e.preventDefault(); // no scrolling a black page
      send({ type: "key", key: e.key });
    };
    window.addEventListener("keydown", keys);
    const off = listen(msg => { if (msg.type === "stage") setStage(msg.stage); });
    send({ type: "hello" }); // a reloaded window asks the Studio to re-send the current cue
    window.focus();
    return () => { window.removeEventListener("keydown", keys); off(); };
  }, []);

  return <Stage stage={stage} className="h-screen w-screen cursor-none" />;
}
