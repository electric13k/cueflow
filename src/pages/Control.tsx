import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Square } from "lucide-react";
import { Button } from "../ui";
import { listen, send, type ControlCue, type Msg } from "../lib/bus";
import { keyLabel, loadBinds } from "../lib/keys";
import { themeClass, useStudioTheme } from "../lib/theme";

/**
 * The cue board, in a window of its own.
 *
 * An operator with two screens had nowhere to put the running order: the Studio is one page and the
 * only thing that could be popped out was the audience view, which is the one window you must not
 * put controls on. This is the deck and nothing else -- big targets, no chrome, and it can sit on a
 * second monitor or a tablet propped against the desk.
 *
 * It holds no state of its own. Everything shown here came from the Studio over the same-origin
 * channel the audience window already uses, and every press goes back the same way, so the panel
 * cannot disagree with the desk about where the show is.
 */
export default function Control() {
  const [theme] = useStudioTheme();
  const [deck, setDeck] = useState<{ name: string; cues: ControlCue[]; index: number; armed: boolean } | null>(null);
  const [linked, setLinked] = useState(false);
  const binds = useRef(loadBinds());

  useEffect(() => {
    const off = listen((msg: Msg) => {
      if (msg.type !== "deck") return;
      setLinked(true);
      setDeck({ name: msg.name, cues: msg.cues, index: msg.index, armed: msg.armed });
    });
    // Ask, rather than wait: the Studio only broadcasts on change, and nothing may change for an
    // hour before curtain.
    send({ type: "hello" });
    const nudge = setInterval(() => { if (!linked) send({ type: "hello" }); }, 2_000);
    return () => { off(); clearInterval(nudge); };
  }, [linked]);

  // Keys pressed here reach the desk, so the panel behaves like the Studio without duplicating it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(el.tagName) || el.isContentEditable) return;
      // Only a bound key belongs to the desk. Swallowing every key ate the first Tab, and since the
      // focus target on load is <body>, focus never reached a button and the exemption above could
      // never fire: the panel was unusable by keyboard and by screen reader.
      if (!Object.values(binds.current).includes(event.key)) return;
      send({ type: "key", key: event.key });
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const key = (action: keyof ReturnType<typeof loadBinds>) => binds.current[action];
  const press = (action: keyof ReturnType<typeof loadBinds>) => send({ type: "key", key: key(action) });

  return (
    <div className={`${themeClass(theme)} flex h-dvh flex-col gap-3 bg-background p-3 text-foreground`}>
      <header className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="eyebrow text-accent">Control panel</p>
          <h1 className="truncate text-lg font-semibold tracking-tight">{deck?.name ?? "Waiting for the desk"}</h1>
        </div>
        <span className={`shrink-0 text-label ${deck?.armed ? "text-armed" : "text-muted"}`}>
          {deck?.armed ? (deck.index < 0 ? "Armed" : `Cue ${deck.index + 1}`) : "Standing by"}
        </span>
      </header>

      {!deck && (
        <p className="text-body text-muted">
          Keep the Studio open in another window on this browser. This panel mirrors it and calls cues
          back to it; it does not run a show on its own.
        </p>
      )}

      <ol className="min-h-0 flex-1 space-y-1 overflow-auto">
        {deck?.cues.map((cue, i) => (
          <li key={cue.id}>
            <button type="button" onClick={() => send({ type: "fire", index: i })}
              aria-current={i === deck.index ? "true" : undefined}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left ${i === deck.index ? "bg-live/20 ring-1 ring-live" : "bg-surface/60 hover:bg-surface"}`}>
              <span className={`w-8 shrink-0 text-center font-mono font-bold ${cue.kind === "audio" ? "text-audio" : "text-visual"}`}>{cue.number}</span>
              <span className="min-w-0 flex-1 truncate text-body font-semibold">{cue.label}</span>
            </button>
          </li>
        ))}
        {deck?.cues.length === 0 && <li className="text-body text-muted">This sequence has no cues yet.</li>}
      </ol>

      <div className="flex items-center gap-2">
        <Button className="h-14 flex-1" variant="flat" startContent={<ChevronLeft size={18} aria-hidden />}
          onPress={() => press("prevCue")} title={`Previous cue (${keyLabel(key("prevCue"))})`}>Back</Button>
        <Button className="h-14 flex-[2] text-base font-bold" color="primary" endContent={<ChevronRight size={20} aria-hidden />}
          onPress={() => press("nextCue")} title={`Next cue (${keyLabel(key("nextCue"))})`}>
          {deck && deck.index < 0 ? "Fire cue 1" : "Next cue"}
        </Button>
        <Button isIconOnly className="h-14 w-14" variant="flat" color="danger" aria-label="Stop all sound"
          title={`Stop all sound (${keyLabel(key("stopAll"))})`} onPress={() => press("stopAll")}>
          <Square size={16} fill="currentColor" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
