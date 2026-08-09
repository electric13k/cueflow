import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HelpCircle } from "lucide-react";
import { Button } from "../ui";
import { lessons, markLearned, replay, type Lesson } from "../lib/coach";

type Spot = { top: number; left: number; width: number; height: number } | null;

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
 * One lesson at a time, pinned to the control it is about. The dark surround is a single element
 * with an enormous spread shadow -- the hole in the middle is the element itself, which is cheaper
 * and sharper than masking, and it means the highlighted control is genuinely the only lit thing.
 */
export default function Coach() {
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [spot, setSpot] = useState<Spot>(null);
  // Two panes can mount in the same tick (a sidebar and the page beside it). Whoever asked first
  // gets the screen; the loser is never marked learned, so it comes back next time you open it.
  const showing = useRef(false);

  useEffect(() => {
    const open = (e: Event) => {
      const next = lessons[(e as CustomEvent<string>).detail];
      if (!next || showing.current) return;
      showing.current = true;
      // A tab that just changed has not laid out yet, so measure a tick later or the hole lands
      // where the control used to be. A timer, not a frame: requestAnimationFrame never fires while
      // the tab is in the background, which would leave the lesson queued until you came back.
      setTimeout(() => {
        const el = next.target ? document.querySelector(next.target) : null;
        const r = el?.getBoundingClientRect();
        setSpot(r ? { top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 } : null);
        setLesson(next);
      }, 0);
    };
    window.addEventListener("cueflow:teach", open);
    return () => window.removeEventListener("cueflow:teach", open);
  }, []);

  const done = () => { if (lesson) markLearned(lesson.id); showing.current = false; setLesson(null); setSpot(null); };

  // Escape dismisses, same as the button: a lesson that traps you is worse than no lesson.
  useEffect(() => {
    if (!lesson) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") done(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [lesson]);

  const below = spot ? spot.top + spot.height + 14 : 0;
  const flip = spot ? below + 190 > innerHeight : false;

  return (
    <AnimatePresence>
      {lesson && (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-label={lesson.title}>
          <motion.button
            aria-label="Dismiss" onClick={done}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .25 }}
            className="absolute inset-0 cursor-default"
            style={spot
              ? { top: spot.top, left: spot.left, width: spot.width, height: spot.height, right: "auto", bottom: "auto",
                  borderRadius: 10, boxShadow: "0 0 0 9999px rgba(12, 9, 8, .74)", pointerEvents: "auto" }
              : { background: "rgba(12, 9, 8, .74)" }}
          />
          {spot && (
            <motion.span aria-hidden
              initial={{ opacity: 0, scale: .9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="pointer-events-none absolute rounded-[10px] ring-2 ring-brass"
              style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }} />
          )}
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
            transition={{ duration: .3, ease: [.16, 1, .3, 1] }}
            className="glass absolute w-[min(20rem,calc(100vw-2rem))] p-5"
            style={spot
              // clientWidth, not innerWidth: the layout viewport is what the card has to fit inside,
              // and on a phone the two disagree the moment anything overflows sideways.
              ? { top: flip ? Math.max(12, spot.top - 178) : below, left: Math.max(12, Math.min(spot.left, document.documentElement.clientWidth - 336)) }
              : { top: "50%", left: "50%", transform: "translate(-50%,-50%)" }}
          >
            <p className="font-mono text-[10px] uppercase tracking-[.3em] text-brass">Tip</p>
            <h3 className="mt-2 text-lg font-bold">{lesson.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{lesson.body}</p>
            <Button className="mt-4 w-full" size="sm" color="primary" onPress={done}>Got it</Button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
