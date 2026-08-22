import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "../ui";
import Spotlight, { findAnchor, useAnchor } from "./Spotlight";
import { clearDemo, demoPresent, loadDemo } from "../lib/demo";
import { getTour, setTour, steps } from "../lib/tour";
import { onAuth } from "../lib/store";
import { toast } from "../lib/toast";
import { useSignedIn } from "./RequireAuth";

const TICK = 400;
const CLEARED = "cueflow:demo-cleared";
const FIRST_AUTH = "cueflow:first-auth";
const TUTORIAL_ACTIVE = "cueflow:tutorial-active";

export const startTour = () => window.dispatchEvent(new Event("cueflow:tour"));

export default function Tour() {
  const [step, setStep] = useState(-1);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const signedIn = useSignedIn();
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const active = step >= 0 && step < steps.length;
  const current = active ? steps[step] : undefined;
  const { spot, state } = useAnchor(current?.anchor, active);
  const pressed = useRef(false);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const routeFor = (candidate: typeof current) => {
    if (!candidate) return pathname;
    return candidate.id === "sidebar" ? (signedIn ? "/workspace" : "/studio") : (candidate.route ?? pathname);
  };

  const paneFor = (id: string) => {
    if (id === "library") return "library";
    if (id === "show") return "shows";
    if (["sequence", "cues", "arm", "fire", "presenter"].includes(id)) return "deck";
    return null;
  };

  const moveToStep = (to: number) => {
    const target = steps[to];
    setStep(to);
    const route = routeFor(target);
    if (!pathname.endsWith(route)) navigate(route);
  };

  const clearAdvanceTimer = () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = null;
  };

  const begin = (from = 0) => {
    clearAdvanceTimer();
    loadDemo();
    setTour({ done: false, step: from });
    const route = routeFor(steps[from]);
    if (pathname.endsWith(route)) {
      setStep(from);
      location.reload();
    } else {
      moveToStep(from);
    }
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

  useEffect(() => onAuth(setAuthEmail), []);

  useEffect(() => {
    if (!authEmail) return;
    const firstAuthKey = `${FIRST_AUTH}:${authEmail.trim().toLowerCase()}`;
    if (localStorage.getItem(firstAuthKey)) return;
    localStorage.setItem(firstAuthKey, "1");
    localStorage.setItem(TUTORIAL_ACTIVE, "1");
    setTour({ done: false, step: 0 });
    if (!pathname.endsWith("/workspace")) navigate("/workspace", { replace: true });
  }, [authEmail, pathname, navigate]);

  useEffect(() => {
    if (!pathname.endsWith("/workspace") && !pathname.endsWith("/studio")) return;
    // Keep the pre-existing completion flag compatible with the current tour store. This matters
    // for returning operators and for deep links into Script, where an old flag must not resurrect
    // a spotlight over an unrelated consent or editor control.
    if (localStorage.getItem("cueflow:tutorial:complete") === "1") {
      setTour({ done: true, step: 0 });
      setStep(-1);
      return;
    }
    const saved = getTour();
    if (saved.done) return;
    if (localStorage.getItem("cueflow:tour") === null) begin(0);
    else if (step < 0) {
      loadDemo();
      setStep(Math.min(Math.max(saved.step, 0), steps.length - 1));
    }
  }, [pathname, signedIn]);

  const finish = (keep: boolean) => {
    clearAdvanceTimer();
    setTour({ done: true, step: 0 });
    setStep(-1);
    localStorage.removeItem(TUTORIAL_ACTIVE);
    window.dispatchEvent(new Event("cueflow:tutorial-finished"));
    if (keep || !demoPresent()) return;
    clearDemo();
    sessionStorage.setItem(CLEARED, "1");
    location.reload();
  };

  const next = () => {
    clearAdvanceTimer();
    const to = step + 1;
    if (to >= steps.length) return finish(false);
    setTour({ step: to });
    moveToStep(to);
    pressed.current = false;
  };

  const previous = () => {
    clearAdvanceTimer();
    if (step <= 0) return;
    const to = step - 1;
    setTour({ step: to, done: false });
    moveToStep(to);
    pressed.current = false;
  };

  useEffect(() => {
    if (!current || !pathname.endsWith(routeFor(current))) return;
    const pane = paneFor(current.id);
    if (pane) window.dispatchEvent(new CustomEvent("cueflow:tour-pane", { detail: pane }));
    const timer = setInterval(() => {
      if (current.done()) next();
    }, TICK);
    return () => clearInterval(timer);
  }, [current, step, pathname, signedIn]);

  useEffect(() => {
    if (!current?.onPress || state !== "found") return;
    const el = findAnchor(current.anchor);
    if (!el) return;
    const onClick = () => {
      if (pressed.current) return;
      pressed.current = true;
      clearAdvanceTimer();
      advanceTimer.current = setTimeout(() => {
        advanceTimer.current = null;
        if (active && step >= 0 && steps[step]?.id === current.id) next();
      }, 350);
    };
    el.addEventListener("click", onClick);
    return () => {
      el.removeEventListener("click", onClick);
      clearAdvanceTimer();
    };
  }, [current, state, active, step]);

  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") finish(false); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [active]);

  if (!active || !current || state !== "found" || !pathname.endsWith(routeFor(current))) return null;

  return (
    <Spotlight spot={spot} label={current.say} onDismiss={() => finish(false)}>
      <p className="font-mono text-[10px] uppercase tracking-[.3em] text-brass">
        Step {step + 1} of {steps.length}
      </p>
      <p className="mt-2 text-base font-semibold leading-snug">{current.say}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="light" onPress={() => finish(false)}>Skip the tour</Button>
        {step > 0 && <Button size="sm" variant="light" onPress={previous}>Back</Button>}
        <Button size="sm" color="primary" className="ml-auto" onPress={next}>Next</Button>
      </div>
    </Spotlight>
  );
}
