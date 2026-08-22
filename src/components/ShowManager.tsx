import { useEffect, useMemo, useRef, useState } from "react";
import {
  Clock, ExternalLink, FileText, GripVertical, Layers, ListMusic, MessageSquare, Monitor,
  Play, Radio, Send, Square, Users, X,
} from "lucide-react";
import { Button, Select } from "../ui";
import DarkToggle from "./DarkToggle";
import ScriptReader from "./ScriptReader";
import ShowChat from "./ShowChat";
import ShowHost from "./ShowHost";
import Stage from "./Stage";
import CurtainTransition from "./CurtainTransition";
import { logChat } from "../lib/chat";
import { useDragList } from "../lib/dragList";
import { clock, liveAt, planShow, showSequences } from "../lib/showPlan";
import { local } from "../lib/store";
import { themeClass, useStudioTheme } from "../lib/theme";
import { linksOf, type LinkMap } from "../lib/showLinks";
import { updateShow, type Show } from "../lib/shows";
import { toast } from "../lib/toast";
import type { ScriptDoc } from "../lib/script";
import { isVisual, kindOf, type Sequence, type Stage as StageState, type Track } from "../types";

type Blank = "black" | "white";

type Props = {
  show: Show;
  /** Null closes the show itself: the host panel uses it for Close and after a delete. */
  setShow: (s: Show | null) => void;
  projectId: string | null;
  sequences: Sequence[];
  tracks: Track[];
  script: ScriptDoc | null;
  links: LinkMap;
  stage: StageState;
  /** Which sequence the desk has armed, and where it is standing in it. -1 means nothing has fired. */
  armedSequenceId: string;
  cueIndex: number;
  onClose: () => void;
  onFlash: (text: string) => void;
  onResend: () => void;
  onAddSequence: (seqId: string) => void;
  onAddScript: () => void;
  /** A sequence on its own, in presenter mode: arms the deck and opens the audience window. */
  onRunSequence: (seqId: string) => void;
  onStage: (track: Track) => void;
  /** Dropping a library item on a sequence, and the same thing from the keyboard. */
  onAddToSequence: (seqId: string, trackId: string) => void;
  /** Fires a cue of the armed sequence, by its index in that sequence. */
  onFire: (index: number) => void;
  /** Arms the show’s first sequence on the operator surface without opening an audience window. */
  onArmSequence?: (seqId: string) => void;
  /** The audience screen as its own window. The desk keeps the keys; that window forwards them. */
  onOpenAudience: () => void;
};

/**
 * The show manager: a show opened out of the grid takes the whole screen, and everything else on the
 * project screen becomes furniture around it. Sequences, the library and the script are still here
 * and still reachable, as grids, because you cannot build a show without them -- but they are no
 * longer the subject, the show is.
 *
 * Starting a show opens this, and only this. Going live is a second, deliberate press, because a
 * button that both opens the desk and throws the room into a performance cannot be pressed to look
 * at something. The audience screen is here from the first paint, black, and can be sent to its own
 * window at any point: the same state either way, since both read the one stage the desk publishes.
 *
 * Roles and their powers are `ShowHost`, unchanged: that panel and `lib/shows.ts` are the permission
 * model, and there is no second one hiding in here.
 */
export default function ShowManager({
  show, setShow, projectId, sequences, tracks, script, links, stage, armedSequenceId, cueIndex,
  onClose, onFlash, onResend, onAddSequence, onAddScript, onRunSequence, onStage, onAddToSequence,
  onFire, onArmSequence, onOpenAudience,
}: Props) {
  const [theme] = useStudioTheme();
  const [audience, setAudience] = useState(false);
  const [panel, setPanel] = useState<"roles" | "chat">("roles");
  const [busy, setBusy] = useState(false);
  const [curtain, setCurtain] = useState(false);
  const curtainTimer = useRef<number | null>(null);
  const [blank, setBlank] = useState<Blank>(() => local.get<Blank>("show:blank", "black"));
  const hold = (b: Blank) => { setBlank(b); local.set("show:blank", b); };

  useEffect(() => () => { if (curtainTimer.current) window.clearTimeout(curtainTimer.current); }, []);

  // Escape steps back one: audience mode to the desk, the desk out of the show.
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (audience) setAudience(false); else onClose();
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [audience, onClose]);

  // The clock a live show is running against. setInterval on purpose: a rAF-driven tick stops in a
  // window nobody is painting, and the one number an operator glances at must not quietly freeze.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!show.startedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [show.startedAt]);

  const link = linksOf(links, show.id);
  const carries = (id: string) => id === show.sequenceId || link.seqs.includes(id);
  const carried = link.seqs.join(",");
  const seqs = useMemo(() => showSequences(sequences, show.sequenceId, link.seqs), [sequences, show.sequenceId, carried]);
  const plan = useMemo(() => planShow(seqs, tracks), [seqs, tracks]);
  const live = liveAt(plan, armedSequenceId, cueIndex);
  const from = plan[live]?.offset ?? 0;
  const coming = plan.slice(live + 1);
  const next = coming[0];
  const elapsed = show.startedAt ? (now - new Date(show.startedAt).getTime()) / 1000 : 0;

  /** Everything said in this show, as it is said, so the panel is a history rather than a flash. */
  const flash = (text: string) => { onFlash(text); logChat(show.id, { from: "you", text, kind: "message" }); };

  const goLive = async (live: boolean) => {
    setBusy(true);
    try {
      const at = live ? new Date().toISOString() : null;
      // Going live with no deck of its own picks up the first sequence dropped on the show, so the
      // room is not handed a live show with nothing in it.
      const deck = show.sequenceId ?? (live ? link.seqs[0] ?? null : null);
      await updateShow(show.id, { started_at: at, ...(deck && deck !== show.sequenceId ? { sequence_id: deck } : {}) });
      setShow({ ...show, startedAt: at, sequenceId: deck ?? show.sequenceId });
      if (curtainTimer.current) window.clearTimeout(curtainTimer.current);
      setCurtain(live);
      if (live) {
        curtainTimer.current = window.setTimeout(() => setCurtain(false), 1400);
        if (deck) onArmSequence?.(deck);
      }
      logChat(show.id, { from: "show", text: live ? "Live. Every device is locked in." : "Show ended.", kind: "event" });
    } catch (e) { toast("That did not work", (e as Error).message, "warn"); }
    finally { setBusy(false); }
  };

  /**
   * The two drags this screen was missing. A library item onto a sequence is the one the app most
   * obviously owed: the library has always been on this screen and has never been draggable, which
   * is what made the whole thing feel like a wall of buttons. A sequence onto the show is the same
   * gesture the project board already has, so it works the same way here.
   *
   * Both are `useDragList`, so the long-press-to-lift, the haptic, the autoscroll and the refusal to
   * turn a scroll into a drag are solved once. Both also have a plain control beside them -- a
   * select on the item, a button on the sequence -- because a drag alone is not reachable.
   */
  const libDrag = useDragList(() => {}, (i, target) => {
    if (target.startsWith("seq:")) onAddToSequence(target.slice(4), tracks[i].id);
  });
  const seqDrag = useDragList(() => {}, (i, target) => {
    if (target === `show:${show.id}`) onAddSequence(sequences[i].id);
  });
  const grip = "flex min-w-9 cursor-grab touch-pan-y items-center justify-center self-stretch text-muted hover:text-foreground active:cursor-grabbing";

  if (audience) return (
    // No token anywhere on this screen. What the room sees is structural, so the chrome over it is
    // written in the same literals rather than in whatever the desk's theme happens to be.
    <div className="fixed inset-0 z-[60] bg-black">
      <Stage stage={stage} blank={blank} className="absolute inset-0" />
      <CurtainTransition open={curtain} />
      <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-3 p-4 text-sm text-white/70">
        <span className="font-semibold text-white/90">{show.name}</span>
        <span className="text-white/40">{show.startedAt ? "live" : "standing by"} · audience mode</span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {!stage && (
            <button type="button" onClick={() => hold(blank === "black" ? "white" : "black")}
              className="rounded-full border border-white/25 px-3 py-1.5 hover:bg-white/10">
              Hold {blank === "black" ? "white" : "black"}
            </button>
          )}
          <button type="button" onClick={onOpenAudience}
            className="rounded-full border border-white/25 px-3 py-1.5 hover:bg-white/10">
            Send to its own window
          </button>
          <button type="button" onClick={() => setAudience(false)}
            className="rounded-full border border-white/25 px-3 py-1.5 hover:bg-white/10">
            Back to the manager
          </button>
        </span>
      </div>
    </div>
  );

  return (
    <div className={`${themeClass(theme)} fixed inset-0 z-[60] flex flex-col bg-background text-foreground`}>
      <CurtainTransition open={curtain} />
      {/* The header is the show, so it is also where a dragged sequence lands. */}
      <header data-drop={`show:${show.id}`}
        className={`flex flex-wrap items-center gap-3 border-b px-4 py-3 transition-colors ${seqDrag.over === `show:${show.id}` ? "border-accent bg-accent/15" : "border-border"}`}>
        <Radio size={17} className={show.startedAt ? "text-live" : "text-accent"} aria-hidden />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-black tracking-tight">{show.name}</h1>
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted">
            {show.startedAt ? `live · ${clock(elapsed)}` : show.password ?? "no key"}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* The deliberate act. Opening a show is looking at it; this is the one that reaches the room. */}
          {show.startedAt
            ? <Button size="sm" color="danger" variant="flat" isLoading={busy} startContent={<Square size={15} />}
                onPress={() => void goLive(false)}>End the show</Button>
            : <Button size="sm" color="primary" isLoading={busy} startContent={<Radio size={15} />} className="cue-leather"
                onPress={() => void goLive(true)}>Go live</Button>}
          <Button size="sm" variant="flat" startContent={<Monitor size={15} />} onPress={() => setAudience(true)}>Audience mode</Button>
          <Button size="sm" variant="light" startContent={<ExternalLink size={15} />} onPress={onOpenAudience}>Audience window</Button>
          <Button size="sm" variant="light" startContent={<Send size={15} />} onPress={onResend}>Resend the deck</Button>
          <DarkToggle />
          <Button isIconOnly size="sm" variant="light" aria-label="Close the show manager" onPress={onClose}><X size={16} /></Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 lg:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="min-w-0 space-y-4">
          {/* The audience screen, here, in the manager. The window opened beside it shows the same
              thing for the same reason: both read the one stage the desk publishes. */}
          <section className="space-y-2">
            <Stage stage={stage} blank={blank} className="aspect-video w-full rounded-2xl border border-border" />
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>{stage ? `On now: ${stage.label}` : `Nothing up. The room is holding ${blank}.`}</span>
              <button type="button" className="ml-auto underline decoration-dotted underline-offset-4 hover:text-foreground"
                onClick={() => hold(blank === "black" ? "white" : "black")}>
                Hold {blank === "black" ? "white" : "black"} when nothing is up
              </button>
            </div>
          </section>

          {/* What is coming, and when. */}
          <section className="glass-soft p-3">
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted">
              <Clock size={14} aria-hidden />Coming up
            </h2>
            {plan.length === 0 ? (
              <p className="mt-2 text-sm text-muted">This show carries no sequences yet. Drag one onto the header, or add it below.</p>
            ) : (<>
              <div className={`mt-2 flex flex-wrap items-center gap-3 rounded-xl border p-3 ${next ? "border-armed/50 bg-armed/10" : "border-border bg-surface/60"}`}>
                <span className="text-[11px] font-semibold uppercase tracking-[.2em] text-muted">Next</span>
                {next ? (<>
                  <span className={`font-mono text-lg font-black ${next.kind === "audio" ? "text-audio" : "text-visual"}`}>{next.number}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{next.label}</span>
                  <span className="text-xs text-muted">{next.sequence}</span>
                  {next.sequenceId === armedSequenceId
                    ? <Button size="sm" color="primary" startContent={<Play size={14} />} onPress={() => onFire(next.index)}>Go</Button>
                    : <Button size="sm" variant="flat" onPress={() => onRunSequence(next.sequenceId)}>Arm {next.sequence}</Button>}
                </>) : <span className="text-sm text-muted">That was the last cue.</span>}
              </div>

              <ol className="mt-2 space-y-1">
                {coming.slice(0, 12).map(cue => {
                  const gap = cue.offset - from;
                  return (
                    <li key={`${cue.sequenceId}:${cue.id}`} className="flex items-center gap-2 rounded-xl bg-surface/50 px-3 py-1.5 text-sm">
                      <span className={`w-7 shrink-0 text-center font-mono font-bold ${cue.kind === "audio" ? "text-audio" : "text-visual"}`}>{cue.number}</span>
                      <span className="min-w-0 flex-1 truncate">{cue.label}</span>
                      <span className="shrink-0 text-xs text-muted">{cue.sequence}</span>
                      <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted">
                        {gap > 0 ? `+${clock(gap)}` : "on the press"}
                      </span>
                      {cue.sequenceId === armedSequenceId && (
                        <Button isIconOnly size="sm" variant="light" aria-label={`Fire ${cue.label}`} onPress={() => onFire(cue.index)}>
                          <Play size={13} />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ol>
              <p className="mt-2 text-xs text-muted">
                Times are the sound that has to play before each cue can be reached, counted from the cue that is out.
                A slide or a video holds until somebody calls the next one, so it adds nothing: treat every number as
                the earliest a cue can land, not a schedule.
                {live < 0 && " Nothing has gone out yet, so the count starts at the top."}
              </p>
            </>)}
          </section>

          {/* The script, on the manager's own screen rather than in a window somebody has to find. */}
          <section className="glass-soft flex min-h-0 flex-col p-3">
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted">
              <FileText size={14} aria-hidden />Script
              {script?.html && !link.script && <Button className="ml-auto" size="sm" variant="flat" onPress={onAddScript}>Add to the show</Button>}
              {link.script && <span className="ml-auto text-[11px] normal-case tracking-normal text-muted">Goes out with the show</span>}
            </h2>
            {!script?.html
              ? <p className="mt-2 text-sm text-muted">No script in this project yet.</p>
              : <div className="mt-2 h-80 min-h-0"><ScriptReader doc={script} setDoc={() => {}} editable={false} /></div>}
          </section>

          {/* Sequences: drag one onto the header to put it in the show, or press the card. */}
          <section className="glass-soft p-3">
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted">
              <ListMusic size={14} aria-hidden />Sequences
            </h2>
            {sequences.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No sequences in this project yet.</p>
            ) : (
              <ol ref={seqDrag.list} className="mt-2 auto-grid">
                {sequences.map((s, i) => (
                  <li key={s.id} data-drop={`seq:${s.id}`}
                    className={`flex items-center gap-1 rounded-xl border p-2 transition-colors ${
                      libDrag.over === `seq:${s.id}` ? "border-accent bg-accent/25"
                        : carries(s.id) ? "border-accent bg-accent/15" : "border-border bg-surface/60"}`}>
                    <span role="button" tabIndex={-1} aria-label={`Drag ${s.name} onto the show`} className={grip}
                      onPointerDown={seqDrag.start(i)} onPointerMove={seqDrag.move} onPointerUp={seqDrag.end} onPointerCancel={seqDrag.end}>
                      <GripVertical size={13} aria-hidden />
                    </span>
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onAddSequence(s.id)}>
                      <span className="block truncate text-sm font-semibold">{s.name}</span>
                      <span className="block text-xs text-muted">
                        {s.items.length} {s.items.length === 1 ? "cue" : "cues"}{carries(s.id) ? " · in this show" : " · add to the show"}
                      </span>
                    </button>
                    <Button isIconOnly size="sm" variant="light" aria-label={`Run ${s.name} in presenter mode`}
                      title="Run this one on its own, in presenter mode" isDisabled={!s.items.length}
                      onPress={() => onRunSequence(s.id)}>
                      <Play size={14} />
                    </Button>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* The library, and the drag it was missing: a card goes straight onto a sequence card. */}
          <section className="glass-soft p-3">
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted">
              <Layers size={14} aria-hidden />Library
            </h2>
            {tracks.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Nothing in the library yet.</p>
            ) : (<>
              <ol ref={libDrag.list} className="mt-2 auto-grid">
                {tracks.map((t, i) => (
                  <li key={t.id} className="flex items-center gap-1 rounded-xl border border-border bg-surface/60 p-2">
                    <span role="button" tabIndex={-1} aria-label={`Drag ${t.title} onto a sequence`} className={grip}
                      onPointerDown={libDrag.start(i)} onPointerMove={libDrag.move} onPointerUp={libDrag.end} onPointerCancel={libDrag.end}>
                      <GripVertical size={13} aria-hidden />
                    </span>
                    <button type="button" className="min-w-0 flex-1 text-left disabled:cursor-default"
                      title={isVisual(t) ? "Put this up now" : "Sounds are fired from the deck"}
                      disabled={!isVisual(t)} onClick={() => onStage(t)}>
                      <span className="block truncate text-sm font-medium capitalize">{t.title}</span>
                      <span className="block text-xs capitalize text-muted">{kindOf(t)}</span>
                    </button>
                    {sequences.length > 0 && (
                      <Select aria-label={`Add ${t.title} to a sequence`} value=""
                        onChange={value => { if (value) onAddToSequence(value, t.id); }} size="sm" className="max-w-28 shrink-0"
                        options={[{ value: "", label: "Add to…" }, ...sequences.map(s => ({ value: s.id, label: s.name }))]} />
                    )}
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-xs text-muted">
                Drag a card onto a sequence above, or use the box on it. Both do the same thing, because a drag on its
                own is no use to a keyboard.
              </p>
            </>)}
          </section>
        </div>

        {/* Roles, their powers, the keys -- and what the room has been saying. Same panel the host
            has always had, so there is one permission model and it lives in lib/shows.ts. */}
        <aside className="glass flex min-h-0 min-w-0 flex-col gap-3 p-4">
          <div className="flex gap-1 rounded-full border border-border p-1 text-sm">
            <button type="button" onClick={() => setPanel("roles")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 ${panel === "roles" ? "bg-accent/20 font-semibold text-accent" : "text-muted hover:text-foreground"}`}>
              <Users size={14} aria-hidden />Jobs and keys
            </button>
            <button type="button" onClick={() => setPanel("chat")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 ${panel === "chat" ? "bg-accent/20 font-semibold text-accent" : "text-muted hover:text-foreground"}`}>
              <MessageSquare size={14} aria-hidden />Messages
            </button>
          </div>
          {panel === "roles"
            ? <ShowHost projectId={projectId} sequenceId={show.sequenceId ?? ""} show={show} setShow={setShow} onFlash={flash} />
            : <ShowChat className="min-h-0 flex-1" show={show.id} onSend={flash} />}
        </aside>
      </div>
    </div>
  );
}
