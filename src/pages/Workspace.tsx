import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, FileText, Film, Image as ImageIcon, ListMusic, Pencil, Presentation, Radio, Volume2 } from "lucide-react";
import Shell from "../components/Shell";
import { Button } from "../ui";
import { currentProject, listProjects, type Project } from "../lib/projects";
import { listShows, type Show } from "../lib/shows";
import { listSessions, type EditorSession } from "../lib/editorSessions";
import { search, type Facets } from "../lib/search";
import { local, onAuth } from "../lib/store";
import { loadScript } from "../lib/script";
import { kindOf, type Sequence, type Track } from "../types";

const trackIcons = { audio: Volume2, image: ImageIcon, video: Film, embed: Presentation };
const rise = (d = 0) => ({ initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: .45, delay: d, ease: [.16, 1, .3, 1] as const } });

/**
 * One row of the workspace, whatever it is a row of. Everything the ranking needs is on it, so the
 * five kinds can be sorted against each other instead of in five separate piles.
 */
type Entry = {
  id: string;
  kind: "session" | "sequence" | "library" | "show" | "script";
  title: string;
  /** The small print on the right: cue count, show key, what an unfinished edit is unfinished in. */
  note: string;
  /** Where one click lands. For a session that is the editor it was left in, on the same item. */
  href: string;
  at?: string | null;
  Icon: typeof Volume2;
  tint: string;
};

const facet = (e: Entry): Facets => ({ text: [e.title, e.note], kind: e.kind, updatedAt: e.at });

const labels: Record<Entry["kind"], string> = {
  session: "Unfinished edit", sequence: "Sequence", library: "Library", show: "Show", script: "Script",
};

export default function Workspace() {
  const project = currentProject();
  const key = (k: string) => (project ? `${k}:${project}` : k);
  const [tracks] = useState<Track[]>(() => local.get(key("tracks"), []));
  const [sequences] = useState<Sequence[]>(() => local.get(key("sequences"), []));
  const [script] = useState(() => (typeof localStorage === "undefined" ? null : loadScript()));
  const [shows, setShows] = useState<Show[]>([]);
  const [sessions, setSessions] = useState<EditorSession[]>([]);
  const [name, setName] = useState<string>(project ? "…" : "Personal workspace");

  useEffect(() => onAuth(email => {
    if (!email) return;
    void listShows(project).then(setShows).catch(() => setShows([]));
    void listSessions(project).then(setSessions).catch(() => setSessions([]));
    if (project) void listProjects().then((all: Project[]) => setName(all.find(p => p.id === project)?.name ?? "Project"));
  }), [project]);

  /**
   * Recency alone puts the sound you imported and never used above the sequence you have run all
   * week, so the blend in `lib/search` does the ordering: recency with a three-day half-life,
   * saturating usage, pins above both. One list, because a workspace is a place you resume from and
   * five separately-sorted piles make you look in five places for the one thing you were doing.
   */
  const entries = useMemo(() => {
    const titles = new Map(tracks.map(t => [t.id, t.title]));
    const list: Entry[] = [];

    for (const s of sessions) list.push({
      id: `session:${s.kind}:${s.itemId}`, kind: "session",
      title: titles.get(s.itemId) ?? "Untitled",
      note: `${s.kind} edit in progress`,
      href: `/studio?tab=editor&track=${s.itemId}`,
      at: s.updatedAt, Icon: Pencil, tint: "text-brass",
    });

    for (const s of sequences) list.push({
      id: `sequence:${s.id}`, kind: "sequence", title: s.name,
      note: `${s.items.length} ${s.items.length === 1 ? "cue" : "cues"}`,
      href: `/studio?tab=sequence&seq=${s.id}`,
      at: s.createdAt, Icon: ListMusic, tint: "text-accent",
    });

    // A library item with a session open is the same thing twice; the session is the more useful of
    // the two, so the plain row stands down.
    const resuming = new Set(sessions.map(s => s.itemId));
    for (const t of tracks) {
      if (resuming.has(t.id)) continue;
      list.push({
        id: `library:${t.id}`, kind: "library", title: t.title, note: kindOf(t),
        href: `/studio?tab=editor&track=${t.id}`, at: t.createdAt,
        Icon: trackIcons[kindOf(t)], tint: kindOf(t) === "audio" ? "text-audio" : "text-visual",
      });
    }

    for (const s of shows) list.push({
      id: `show:${s.id}`, kind: "show", title: s.name,
      note: s.startedAt ? "live" : (s.password ?? "no key"),
      href: "/show", at: s.startedAt, Icon: Radio, tint: s.startedAt ? "text-live" : "text-muted",
    });

    if (script?.html) list.push({
      id: "script", kind: "script", title: script.name || "Script",
      note: `${script.cues.length} marked`, href: "/script", at: null,
      Icon: FileText, tint: "text-brass",
    });

    return search(list, facet, { sort: "importance" });
  }, [sessions, sequences, tracks, shows, script]);

  return (
    <Shell>
      <motion.div {...rise()}>
        <p className="font-mono text-[11px] uppercase tracking-[.32em] text-brass">{project ? "Project" : "Everything not in a project"}</p>
        <h1 className="mt-2 text-4xl font-bold sm:text-5xl">{name}</h1>
        <p className="mt-3 text-sm text-muted">
          Sequences, unfinished edits, library, shows and script, most important first.
        </p>
      </motion.div>

      <section className="mt-8">
        {entries.length === 0
          ? <p className="rounded-md border border-dashed border-white/15 px-4 py-6 text-sm text-muted">Nothing here yet. Open the Studio and add a sound or a slide.</p>
          : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {entries.map((e, i) => (
                <motion.li key={e.id} {...rise(Math.min(i, 12) * .04)}>
                  <Link to={e.href} className="glass glass-hover flex items-center gap-3 px-3 py-2.5">
                    <e.Icon size={16} className={e.tint} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{e.title}</span>
                      <span className="font-mono text-[10px] uppercase tracking-[.18em] text-muted">{labels[e.kind]}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-muted">{e.kind === "session" ? "Resume" : e.note}</span>
                  </Link>
                </motion.li>
              ))}
            </ul>
          )}
      </section>

      <div className="mt-12">
        <Button href="/studio" color="primary" size="lg" endContent={<ArrowRight size={17} />}>Open the Studio</Button>
      </div>
    </Shell>
  );
}
