import { useState } from "react";
import { FileText, GripVertical, Plus, Radio, Trash2 } from "lucide-react";
import { Button, Input, Tooltip } from "../ui";
import { CoachHelp } from "./Coach";
import { ShowsSkeleton, ScriptSkeleton } from "./Skeleton";
import { useDragList } from "../lib/dragList";
import { linksOf, type LinkMap } from "../lib/showLinks";
import type { Show } from "../lib/shows";
import type { ScriptDoc } from "../lib/script";
import type { Sequence } from "../types";

/**
 * What sits above the tabs on a project screen: the shows, and beside them the script.
 *
 * Both start as a single button. Making the first one turns that button into a grid and the grid is
 * where it stays, a project that has ever had a show is a project whose shows are the subject, and
 * a screen whose furniture moves back and forth under you is a screen you have to re-learn. Only
 * deleting every last one puts the button back.
 *
 * Shows get the bigger half because a show is the bigger thing; hovering either one lifts it and
 * pushes the other back, so whichever you reached for is the one in focus.
 */
type Props = {
  shows: Show[];
  links: LinkMap;
  sequences: Sequence[];
  script: ScriptDoc | null;
  /** Persisted, not derived: the grid has to be there on the first paint, before the shows arrive. */
  showsGrid: boolean;
  scriptGrid: boolean;
  loading?: boolean;
  busy?: boolean;
  /** The drop target the page's own drag is over, so a show lights up under a dragged sequence. */
  over?: string | null;
  onCreateShow: (name: string) => void;
  onOpenShow: (show: Show) => void;
  onDeleteShow: (show: Show) => void;
  onOpenScript: () => void;
  onScriptToShow: (showId: string) => void;
};

const panel = (lifted: boolean, dimmed: boolean) =>
  `glass p-4 transition-all duration-300 ${lifted ? "z-10 scale-[1.02] shadow-glass" : ""} ${dimmed ? "opacity-60" : "opacity-100"}`;

export default function ShowsBoard({
  shows, links, sequences, script, showsGrid, scriptGrid, loading, busy, over,
  onCreateShow, onOpenShow, onDeleteShow, onOpenScript, onScriptToShow,
}: Props) {
  const [focus, setFocus] = useState<"shows" | "script" | null>(null);
  const [name, setName] = useState("");
  const [naming, setNaming] = useState(false);
  // The script is one card, so it never reorders; it only ever leaves for a show.
  const scriptDrag = useDragList(() => {}, (_i, target) => target.startsWith("show:") && onScriptToShow(target.slice(5)));
  const hot = over ?? scriptDrag.over;
  const seqName = (id: string) => sequences.find(s => s.id === id)?.name ?? "a sequence";

  const create = () => { const v = name.trim(); if (!v) return; onCreateShow(v); setName(""); setNaming(false); };

  return (
    <div className="mt-6 grid items-start gap-4 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section onMouseEnter={() => setFocus("shows")} onMouseLeave={() => setFocus(null)}
        className={panel(focus === "shows", focus === "script")}>
        <div className="flex items-center gap-2">
          <Radio size={16} className="text-accent" aria-hidden />
          <h2 className="text-sm font-bold uppercase tracking-widest">Shows</h2>
          <CoachHelp id="show" className="ml-auto" />
        </div>

        {loading ? <ShowsSkeleton /> : !showsGrid && !naming ? (
          <Button data-coach="show" className="mt-3 h-24 w-full text-base" color="primary" variant="flat" isDisabled={busy}
            startContent={<Plus size={18} />} onPress={() => setNaming(true)}>
            Create a show
          </Button>
        ) : (<>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {shows.map(s => {
              const link = linksOf(links, s.id);
              const carried = link.seqs.filter(id => sequences.some(q => q.id === id));
              return (
                <div key={s.id} data-drop={`show:${s.id}`}
                  className={`flex min-h-24 flex-col rounded-xl border p-3 transition-colors ${hot === `show:${s.id}` ? "border-accent bg-accent/20" : s.startedAt ? "border-live/50 bg-live/10" : "border-border bg-surface/60"}`}>
                  <button type="button" className="flex-1 text-left" onClick={() => onOpenShow(s)}>
                    <span className="block truncate font-bold">{s.name}</span>
                    <span className="mt-1 block font-mono text-[11px] uppercase tracking-widest text-muted">
                      {s.startedAt ? "live" : "open manager"}
                    </span>
                    <span className="mt-1 block text-xs text-muted">
                      {s.sequenceId ? seqName(s.sequenceId) : "no sequence yet"}
                      {carried.length > 1 ? ` +${carried.length - 1} more` : ""}
                      {link.script ? " · script" : ""}
                    </span>
                  </button>
                  <span className="mt-1 flex justify-end">
                    <Tooltip content="Delete this show">
                      <Button isIconOnly size="sm" variant="light" color="danger" aria-label={`Delete ${s.name}`} onPress={() => onDeleteShow(s)}>
                        <Trash2 size={14} />
                      </Button>
                    </Tooltip>
                  </span>
                </div>
              );
            })}

            {naming ? (
              <div className="flex min-h-24 flex-col justify-center gap-2 rounded-xl border border-dashed border-accent/60 p-3">
                <Input autoFocus label="Show name" value={name} onValueChange={setName}
                  placeholder="Opening night" onKeyDown={e => { if (e.key === "Enter") create(); }} />
                <div className="flex gap-2">
                  <Button size="sm" color="primary" onPress={create}>Create</Button>
                  <Button size="sm" variant="light" onPress={() => { setNaming(false); setName(""); }}>Cancel</Button>
                </div>
              </div>
            ) : (
              <button type="button" data-coach="show" onClick={() => setNaming(true)}
                className="flex min-h-24 items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm text-muted transition-colors hover:border-accent hover:text-foreground">
                <Plus size={16} /> New show
              </button>
            )}
          </div>
          <p className="mt-3 text-xs text-muted">Drag a sequence or the script onto a show to add it. Several sequences can go into one.</p>
        </>)}
      </section>

      <section onMouseEnter={() => setFocus("script")} onMouseLeave={() => setFocus(null)}
        className={panel(focus === "script", focus === "shows")}>
        <div className="flex items-center gap-2">
          <FileText size={15} className="text-brass" aria-hidden />
          <h2 className="text-sm font-bold uppercase tracking-widest">Script</h2>
          <CoachHelp id="script" className="ml-auto" />
        </div>

        {loading ? <ScriptSkeleton /> : !scriptGrid ? (
          <Button data-coach="script" className="mt-3 h-16 w-full" variant="bordered" startContent={<Plus size={16} />} onPress={onOpenScript}>
            Add a script
          </Button>
        ) : (
          <div className="mt-3 grid gap-2">
            <div className="flex min-h-16 items-center gap-2 rounded-xl border border-border bg-surface/60 p-2">
              <span
                role="button" tabIndex={-1} aria-label="Drag the script onto a show"
                className="flex min-w-11 cursor-grab touch-pan-y items-center justify-center self-stretch text-muted hover:text-foreground active:cursor-grabbing"
                onPointerDown={scriptDrag.start(0)} onPointerMove={scriptDrag.move}
                onPointerUp={scriptDrag.end} onPointerCancel={scriptDrag.end}
              >
                <GripVertical size={15} aria-hidden />
              </span>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpenScript}>
                <span className="block truncate text-sm font-semibold">{script?.name || "Script"}</span>
                <span className="block text-xs text-muted">{script?.cues.length ?? 0} marked {script?.cues.length === 1 ? "cue" : "cues"}</span>
              </button>
            </div>
            <Button size="sm" variant="light" onPress={onOpenScript}>Open the reader</Button>
          </div>
        )}
      </section>
    </div>
  );
}
