import { useEffect, useState } from "react";
import { FileText, Layers, ListMusic, Monitor, Play, Radio, Send, X } from "lucide-react";
import { Button } from "../ui";
import DarkToggle from "./DarkToggle";
import ShowHost from "./ShowHost";
import Stage from "./Stage";
import { local } from "../lib/store";
import { themeClass, useStudioTheme } from "../lib/theme";
import { linksOf, type LinkMap } from "../lib/showLinks";
import type { Show } from "../lib/shows";
import type { ScriptDoc } from "../lib/script";
import { kindOf, type Sequence, type Stage as StageState, type Track } from "../types";

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
  onClose: () => void;
  onFlash: (text: string) => void;
  onResend: () => void;
  onAddSequence: (seqId: string) => void;
  onAddScript: () => void;
  /** A sequence on its own, in presenter mode: arms the deck and opens the audience window. */
  onRunSequence: (seqId: string) => void;
  onStage: (track: Track) => void;
};

/**
 * The show manager: a show opened out of the grid takes the whole screen, and everything else on the
 * project screen becomes furniture around it. Sequences, the library and the script are still here
 * and still reachable, as grids, because you cannot build a show without them -- but they are no
 * longer the subject, the show is.
 *
 * It opens in audience mode, always. A show is a thing a room looks at, so the first thing the
 * manager shows you is what the room would be looking at right now, and that is a black screen until
 * something is fired. The desk is one press away and never the other way round.
 *
 * Roles and their powers are `ShowHost`, unchanged: that panel and `lib/shows.ts` are the permission
 * model, and there is no second one hiding in here.
 */
export default function ShowManager({
  show, setShow, projectId, sequences, tracks, script, links, stage,
  onClose, onFlash, onResend, onAddSequence, onAddScript, onRunSequence, onStage,
}: Props) {
  const [theme] = useStudioTheme();
  const [audience, setAudience] = useState(true);
  const [blank, setBlank] = useState<Blank>(() => local.get<Blank>("show:blank", "black"));
  const hold = (b: Blank) => { setBlank(b); local.set("show:blank", b); };

  // Escape steps back one: audience mode to the desk, the desk out of the show.
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (audience) setAudience(false); else onClose();
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [audience, onClose]);

  const link = linksOf(links, show.id);
  const carries = (id: string) => id === show.sequenceId || link.seqs.includes(id);

  if (audience) return (
    // No token anywhere on this screen. What the room sees is structural, so the chrome over it is
    // written in the same literals rather than in whatever the desk's theme happens to be.
    <div className="fixed inset-0 z-[60] bg-black">
      <Stage stage={stage} blank={blank} className="absolute inset-0" />
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
          <button type="button" onClick={() => setAudience(false)}
            className="rounded-full border border-white/25 px-3 py-1.5 hover:bg-white/10">
            Open the manager
          </button>
        </span>
      </div>
    </div>
  );

  return (
    <div className={`${themeClass(theme)} fixed inset-0 z-[60] flex flex-col bg-background text-foreground`}>
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <Radio size={17} className={show.startedAt ? "text-live" : "text-accent"} aria-hidden />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-black tracking-tight">{show.name}</h1>
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted">
            {show.startedAt ? "live" : show.password ?? "no key"}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="flat" startContent={<Monitor size={15} />} onPress={() => setAudience(true)}>Audience mode</Button>
          <Button size="sm" variant="light" startContent={<Send size={15} />} onPress={onResend}>Resend the deck</Button>
          <DarkToggle />
          <Button isIconOnly size="sm" variant="light" aria-label="Close the show manager" onPress={onClose}><X size={16} /></Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0 space-y-4">
          <section className="space-y-2">
            <Stage stage={stage} blank={blank} className="aspect-video w-full rounded-2xl border border-border" />
            <p className="text-xs text-muted">{stage ? stage.label : `Nothing up. The room is holding ${blank}.`}</p>
          </section>

          <section className="glass-soft p-3">
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted">
              <ListMusic size={14} aria-hidden />Sequences
            </h2>
            {sequences.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No sequences in this project yet.</p>
            ) : (
              <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {sequences.map(s => (
                  <div key={s.id} className={`flex items-center gap-1 rounded-xl border p-2 ${carries(s.id) ? "border-accent bg-accent/15" : "border-border bg-surface/60"}`}>
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
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="glass-soft p-3">
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted">
              <FileText size={14} aria-hidden />Script
            </h2>
            {!script?.html ? (
              <p className="mt-2 text-sm text-muted">No script in this project yet.</p>
            ) : (
              <div className={`mt-2 flex items-center gap-2 rounded-xl border p-2 ${link.script ? "border-accent bg-accent/15" : "border-border bg-surface/60"}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{script.name || "Script"}</span>
                  <span className="block text-xs text-muted">{script.cues.length} marked {script.cues.length === 1 ? "cue" : "cues"}</span>
                </span>
                {link.script
                  ? <span className="text-xs text-muted">Goes out with the show</span>
                  : <Button size="sm" variant="flat" onPress={onAddScript}>Add to the show</Button>}
              </div>
            )}
          </section>

          <section className="glass-soft p-3">
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted">
              <Layers size={14} aria-hidden />Library
            </h2>
            {tracks.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Nothing in the library yet.</p>
            ) : (
              <div className="mt-2 grid gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {tracks.map(t => (
                  <button key={t.id} type="button" onClick={() => onStage(t)}
                    className="rounded-xl border border-border bg-surface/60 p-2 text-left hover:border-accent">
                    <span className="block truncate text-sm font-medium capitalize">{t.title}</span>
                    <span className="block text-xs capitalize text-muted">{kindOf(t)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Roles, their powers, the keys and the switch that calls the show on. Same panel the host
            has always had, so there is one permission model and it lives in lib/shows.ts. */}
        <aside className="glass min-w-0 p-4">
          <ShowHost projectId={projectId} sequenceId={show.sequenceId ?? ""} show={show} setShow={setShow} onFlash={onFlash} />
        </aside>
      </div>
    </div>
  );
}
