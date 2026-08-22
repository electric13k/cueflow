import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import Shell from "../components/Shell";
import RecentTile from "../components/RecentTile";
import { RecentsSkeleton } from "../components/Skeleton";
import {
  GRID_CLASS, GRID_STYLE, MONTH_DAYS, groupRecents, withinMonth,
  type RecentEntry, type RecentKind,
} from "../components/recents";
import { Button } from "../ui";
import { currentProject, listProjects, type Project } from "../lib/projects";
import { listShows, type Show } from "../lib/shows";
import { listSessions, type EditorSession } from "../lib/editorSessions";
import { search, type Facets } from "../lib/search";
import { local, onAuth } from "../lib/store";
import { loadScript } from "../lib/script";
import { cueNumbers, kindOf, type Sequence, type Track } from "../types";

const rise = (d = 0) => ({ initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: .45, delay: d, ease: [.16, 1, .3, 1] as const } });

const facet = (e: RecentEntry): Facets => ({ text: [e.title, e.note], kind: e.kind, updatedAt: e.at });

/** A library track's kind and a tile's kind are the same idea; only the deck is named differently. */
const tileKind = (track: Track): RecentKind => (kindOf(track) === "embed" ? "deck" : kindOf(track) as RecentKind);

export default function Workspace() {
  const project = currentProject();
  const key = (k: string) => (project ? `${k}:${project}` : k);
  const [tracks] = useState<Track[]>(() => local.get(key("tracks"), []));
  const [sequences] = useState<Sequence[]>(() => local.get(key("sequences"), []));
  const [script] = useState(() => (typeof localStorage === "undefined" ? null : loadScript()));
  const [shows, setShows] = useState<Show[]>([]);
  const [sessions, setSessions] = useState<EditorSession[]>([]);
  const [name, setName] = useState<string>(project ? "…" : "Personal workspace");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    const off = onAuth(email => {
      if (!email) { setShows([]); setSessions([]); setLoading(false); return; }
      setLoading(true);
      void Promise.allSettled([
        listShows(project).then(r => { if (live) setShows(r); }),
        listSessions(project).then(r => { if (live) setSessions(r); }),
        project
          ? listProjects().then((all: Project[]) => { if (live) setName(all.find(p => p.id === project)?.name ?? "Project"); })
          : Promise.resolve(),
      ]).then(() => { if (live) setLoading(false); });
    });
    return () => { live = false; off(); };
  }, [project]);

  /**
   * Recents used to be one flat pile of everything this account had ever touched, ranked and left
   * at that. Two things were wrong with it: a list with no categories makes you read all of it to
   * find any of it, and a list with no horizon eventually contains a sound you imported in March.
   *
   * So the horizon comes first: one month, `withinMonth`, applied before anything is ranked. Then
   * the ranking, which is `lib/search`'s importance blend and not a second copy of it, because a
   * sequence you have run all week has to be able to outrank a picture you added this morning.
   * Then the categories, which only group what survived; the order inside each one is the order the
   * ranking produced.
   */
  const groups = useMemo(() => {
    const now = Date.now();
    const titles = new Map(tracks.map(t => [t.id, t.title]));
    const kinds = new Map(tracks.map(t => [t.id, kindOf(t)]));
    const list: RecentEntry[] = [];

    for (const s of sessions) list.push({
      id: `session:${s.kind}:${s.itemId}`, kind: "session",
      title: titles.get(s.itemId) ?? "Untitled",
      note: `${s.kind} edit in progress`,
      href: `/studio?tab=editor&track=${s.itemId}`,
      at: s.updatedAt,
    });

    for (const s of sequences) {
      // The preview calls cues the way the operator does, so the numbering has to be the sequence's
      // own: sound counts 1, 2, 3 and anything the room sees counts a, b, c.
      const cueKinds = s.items.map(i => kinds.get(i.trackId) ?? "audio");
      const numbers = cueNumbers(cueKinds);
      list.push({
        id: `sequence:${s.id}`, kind: "sequence", title: s.name,
        note: `${s.items.length} ${s.items.length === 1 ? "cue" : "cues"}`,
        href: `/studio?tab=sequence&seq=${s.id}`,
        at: s.createdAt,
        cues: s.items.map((item, i) => ({
          n: numbers[i],
          label: item.label || titles.get(item.trackId) || "Untitled",
          kind: cueKinds[i],
        })),
      });
    }

    // A library item with a session open is the same thing twice; the session is the more useful of
    // the two, so the plain tile stands down.
    const resuming = new Set(sessions.map(s => s.itemId));
    for (const t of tracks) {
      if (resuming.has(t.id)) continue;
      list.push({
        id: `library:${t.id}`, kind: tileKind(t), title: t.title, note: kindOf(t),
        href: `/studio?tab=editor&track=${t.id}`, at: t.createdAt, src: t.url,
      });
    }

    for (const s of shows) list.push({
      id: `show:${s.id}`, kind: "show", title: s.name,
      note: s.startedAt ? "live" : (s.password ?? "no key"),
      href: "/show", at: s.startedAt,
    });

    if (script?.html) list.push({
      id: "script", kind: "script", title: script.name || "Script",
      note: `${script.cues.length} marked`, href: "/script", at: null,
    });

    return groupRecents(search(list.filter(e => withinMonth(e.at, now)), facet, { sort: "importance", now }));
  }, [sessions, sequences, tracks, shows, script]);

  return (
    <Shell>
      <motion.div {...rise()}>
        <p className="font-mono text-[11px] uppercase tracking-[.32em] text-brass">{project ? "Project" : "Everything not in a project"}</p>
        <h1 className="mt-2 text-4xl font-bold sm:text-5xl">{name}</h1>
        <p className="mt-3 text-sm text-muted">
          The last {MONTH_DAYS} days, by category, most important first. Everything older is still in the Studio.
        </p>
      </motion.div>

      <section className="mt-8">
        {loading
          ? <RecentsSkeleton />
          : groups.length === 0
            ? (
              <p className="rounded-md border border-dashed border-white/15 px-4 py-6 text-sm text-muted">
                Nothing from the last {MONTH_DAYS} days. Open the Studio and add a sound or a slide.
              </p>
            )
            : (
              <div className="space-y-8">
                {groups.map((group, g) => (
                  <motion.section key={group.id} {...rise(.06 + g * .05)}>
                    <div className="flex items-baseline justify-between gap-3">
                      <h2 className="font-mono text-[11px] uppercase tracking-[.28em] text-brass">{group.title}</h2>
                      <span className="font-mono text-[10px] text-muted">{group.items.length}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted">{group.blurb}</p>
                    <ul className={`mt-3 ${GRID_CLASS}`} style={GRID_STYLE}>
                      {group.items.map((entry, i) => (
                        <RecentTile key={entry.id} entry={entry} delay={Math.min(i, 10) * .03} />
                      ))}
                    </ul>
                  </motion.section>
                ))}
              </div>
            )}
      </section>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: .3, margin: "0px 0px -8% 0px" }}
        transition={{ duration: .45, ease: [.16, 1, .3, 1] }}
        className="mt-12">
        <Button href="/studio" color="primary" size="lg" endContent={<ArrowRight size={17} />}>Open the Studio</Button>
      </motion.div>
    </Shell>
  );
}
