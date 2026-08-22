import { useEffect, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";
import { Button } from "../ui";
import Spotlight, { useAnchor } from "./Spotlight";
import { lessons, markLearned, replay, type Lesson } from "../lib/coach";

/**
 * The "?" a pane wears: it gives back that pane's lesson and no other. Deliberately not a reset --
 * forgetting everything to re-read one sentence is why nobody presses reset.
 */
export function CoachHelp({ id, className = "" }: { id: string; className?: string }) {
  const lesson = lessons[id];
  if (!lesson) return null;
  return (
    <button type="button" title={lesson.title} aria-label={`Explain: ${lesson.title}`}
      onClick={() => replay(id)}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/10 hover:text-foreground ${className}`}>
      <HelpCircle size={15} aria-hidden />
    </button>
  );
}

/**
 * One lesson at a time, pinned to the control it is about.
 *
 * A lesson that names a target and cannot find it is not shown at all, and is not marked learned, so
 * it comes back the next time you open the screen it describes. It used to fall back to a card in
 * the middle of the page explaining a button that was nowhere on screen, which taught nothing and
 * looked broken.
 */
export default function Coach() {
  const [lesson, setLesson] = useState<Lesson | null>(null);
  // Two panes can mount in the same tick (a sidebar and the page beside it). Whoever asked first
  // gets the screen; the loser is never marked learned, so it comes back next time you open it.
  const showing = useRef(false);
  const { spot, state } = useAnchor(lesson?.target, !!lesson);

  useEffect(() => {
    const open = (e: Event) => {
      const detail = (e as CustomEvent<string | { id: string; force?: boolean }>).detail;
      const id = typeof detail === "string" ? detail : detail?.id;
      const force = (typeof detail === "object" && detail?.force === true) || (e as Event & { force?: boolean }).force === true;
      const next = lessons[id];
      // A completed first-run tutorial must not resurrect an automatic coach over a deep-linked
      // control. Explicitly pressing a question-mark help button still uses force and can replay it.
      const consentOpen = !!document.querySelector('[role="dialog"][aria-label="Cookie consent"]');
      if (!next || showing.current || (!force && (consentOpen || localStorage.getItem("cueflow:tutorial:complete") === "1"))) return;
      showing.current = true;
      setLesson(next);
    };
    window.addEventListener("cueflow:teach", open);
    return () => window.removeEventListener("cueflow:teach", open);
  }, []);

  const close = (learned: boolean) => {
    if (learned && lesson) markLearned(lesson.id);
    showing.current = false;
    setLesson(null);
  };

  // The anchor never arrived. Put the lesson back in the deck rather than showing it unanchored.
  useEffect(() => { if (lesson && state === "missing") close(false); }, [lesson, state]);

  // Escape dismisses, same as the button: a lesson that traps you is worse than no lesson.
  useEffect(() => {
    if (!lesson) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(true); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [lesson]);

  if (!lesson || state !== "found") return null;

  return (
    <Spotlight spot={spot} label={lesson.title} onDismiss={() => close(true)}>
      <p className="font-mono text-[10px] uppercase tracking-[.3em] text-brass">Tip</p>
      <h3 className="mt-2 text-lg font-bold">{lesson.title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{lesson.body}</p>
      <Button className="mt-4 w-full" size="sm" color="primary" onPress={() => close(true)}>Got it</Button>
    </Spotlight>
  );
}
