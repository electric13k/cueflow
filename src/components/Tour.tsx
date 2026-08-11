import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "../ui";
import Spotlight, { findAnchor, useAnchor } from "./Spotlight";
import { clearDemo, demoPresent, loadDemo } from "../lib/demo";
import { getTour, setTour, steps } from "../lib/tour";
import { toast } from "../lib/toast";

/** How often to ask the current step whether it has been satisfied. */
const TICK = 400;
/** Set just before the reload that makes the teardown stick, so the toast survives it. */
const CLEARED = "cueflow:demo-cleared";

/** Anyone can start it: the workspace on a first visit, and the Settings button forever after. */
export const startTour = () => window.dispatchEvent(new Event("cueflow:tour"));

/**
 * The tutorial. It highlights a real control and waits for the person to use it, then moves on.
 *
 * Nothing here drives the app. Each step watches for a fact to become true (see `lib/tour.ts`), so
 * the user can reach it any way they like and the Studio needs no tutorial code inside it.
 */
export default function Tour() {
  const [step, setStep] = useState(-1);
  const { pathname } = useLocation();
  const active = step >= 0 && step < steps.length;
  const current = active ? steps[step] : undefined;
  const { spot, state } = useAnchor(current?.anchor, active);
  // The step that was showing when the anchor was last measured, so a press is attributed correctly.
  const pressed = useRef(false);

  /**
   * The Studio reads the library once, in `useState`, and writes it back on a debounce. Seeding
   * behind it means the write it already has queued puts the empty library straight back, so a
   * tutorial started from the Studio has to boot the page again to be seen at all. Nothing is lost:
   * the tour has only just started. Started from anywhere else, there is no Studio to race.
   */
  const begin = (from = 0) => {
    loadDemo();
    setTour({ done: false, step: from });
    if (pathname.endsWith("/studio")) location.reload();
    else setStep(from);
  };

  useEffect(() => {
    const go = () => begin(0);
    window.addEventListener("cueflow:tour", go);
    return () => window.removeEventListener("cueflow:tour", go);
  }, [pathname]);

  useEffect(() => {
    if (!sessionStorage.getItem(CLEARED)) return;
    sessionStorage.removeItem(CLEARED);
    toast("Demo material cleared", "The sounds, pictures and script the tutorial loaded have gone. Anything you made is still here.", "info");
  }, []);

  // First visit to the workspace starts it, and an abandoned run picks up where it stopped.
  useEffect(() => {
    // The workspace for someone with an account, the Studio for someone without one. `Onboarding`
    // used to cover the second case with seven panels of prose and is gone; leaving it out here
    // would mean a signed-out first-timer is taught nothing at all.
    if (!pathname.endsWith("/workspace") && !pathname.endsWith("/studio")) return;
    const saved = getTour();
    if (saved.done) return;
    if (localStorage.getItem("cueflow:tour") === null) begin(0);
    else if (step < 0) { loadDemo(); setStep(saved.step); }
  }, [pathname]);

  const finish = (keep: boolean) => {
    setTour({ done: true, step: 0 });
    setStep(-1);
    if (keep || !demoPresent()) return;
    clearDemo();
    // Same race as `begin`, the other way around: the Studio is still holding the demo library in
    // state and would write it back over the clearing. Boot the page, and say so on the way in.
    sessionStorage.setItem(CLEARED, "1");
    location.reload();
  };

  const next = () => {
    const to = step + 1;
    if (to >= steps.length) return finish(false);
    setTour({ step: to });
    setStep(to);
    pressed.current = false;
  };

  // Poll the current step. An interval rather than requestAnimationFrame, because rAF stops in a
  // background tab and the presenter step deliberately sends people to another window.
  useEffect(() => {
    if (!current) return;
    const timer = setInterval(() => { if (current.done()) next(); }, TICK);
    return () => clearInterval(timer);
  }, [current, step]);

  // Steps whose completion cannot be watched for finish when the highlighted control is pressed.
  useEffect(() => {
    if (!current?.onPress || state !== "found") return;
    const el = findAnchor(current.anchor);
    if (!el) return;
    const onClick = () => { if (!pressed.current) { pressed.current = true; setTimeout(next, 350); } };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [current, state]);

  // Escape leaves. A tutorial that traps you is worse than no tutorial.
  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") finish(false); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [active]);

  if (!active || !current) return null;

  // Wandered off the route this step lives on, or the control has not rendered: say nothing rather
  // than point at nothing. The step resumes the moment its control is back on screen.
  if (state !== "found") return null;

  return (
    <Spotlight spot={spot} label={current.say} onDismiss={() => { /* the dim is not a way out */ }}>
      <p className="font-mono text-[10px] uppercase tracking-[.3em] text-brass">
        Step {step + 1} of {steps.length}
      </p>
      <p className="mt-2 text-base font-semibold leading-snug">{current.say}</p>
      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" variant="light" onPress={() => finish(false)}>Skip the tour</Button>
        {/* No Next. The step is finished by doing the thing, which is the entire point. The one
            exception is a step whose control opens another window, and that one advances itself. */}
      </div>
    </Spotlight>
  );
}
