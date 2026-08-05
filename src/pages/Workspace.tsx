import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, FileText, Film, Image as ImageIcon, ListMusic, Menu, Pencil, Presentation, Radio, Volume2, X } from "lucide-react";
import Backdrop from "../components/Backdrop";
import Nav from "../components/Nav";
import Sidebar from "../components/Sidebar";
import { Button } from "../ui";
import { currentProject, listProjects, type Project } from "../lib/projects";
import { listShows, type Show } from "../lib/shows";
import { local, onAuth } from "../lib/store";
import { loadScript } from "../lib/script";
import { kindOf, type Sequence, type Track } from "../types";

const icons = { audio: Volume2, image: ImageIcon, video: Film, embed: Presentation };
const rise = (d = 0) => ({ initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: .45, delay: d, ease: [.16, 1, .3, 1] as const } });

/** A shell with the hierarchy down the left. On a phone the sidebar is a drawer, not a squeeze. */
export function Shell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative min-h-screen">
      <Backdrop />
      <Nav />
      <div className="mx-auto flex max-w-7xl gap-6 px-4 sm:px-6 lg:px-8">
        <aside className="sticky top-20 hidden h-[calc(100vh-6rem)] w-60 shrink-0 lg:block">
          <div className="glass h-full overflow-y-auto"><Sidebar /></div>
        </aside>
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button aria-label="Close menu" className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-72 overflow-y-auto border-r border-white/10 bg-background">
              <div className="flex justify-end p-2"><Button isIconOnly size="sm" variant="light" aria-label="Close" onPress={() => setOpen(false)}><X size={16} /></Button></div>
              <Sidebar onNavigate={() => setOpen(false)} />
            </div>
          </div>
        )}
        <main className="min-w-0 flex-1 py-8">
          <Button className="mb-4 lg:hidden" size="sm" variant="bordered" startContent={<Menu size={15} />} onPress={() => setOpen(true)}>Workspaces</Button>
          {children}
        </main>
      </div>
    </div>
  );
}

function Section({ title, count, href, children }: { title: string; count: number; href: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-2xl font-bold">{title}</h2>
        <Link to={href} className="font-mono text-[11px] uppercase tracking-[.2em] text-muted hover:text-accent">
          {count} · open
        </Link>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const empty = (line: string) => <p className="rounded-md border border-dashed border-white/15 px-4 py-6 text-sm text-muted">{line}</p>;

export default function Workspace() {
  const project = currentProject();
  const key = (k: string) => (project ? `${k}:${project}` : k);
  const [tracks] = useState<Track[]>(() => local.get(key("tracks"), []));
  const [sequences] = useState<Sequence[]>(() => local.get(key("sequences"), []));
  const [script] = useState(() => (typeof localStorage === "undefined" ? null : loadScript()));
  const [shows, setShows] = useState<Show[]>([]);
  const [name, setName] = useState<string>(project ? "…" : "Personal workspace");

  useEffect(() => onAuth(email => {
    if (!email) return;
    void listShows(project).then(setShows).catch(() => setShows([]));
    if (project) void listProjects().then((all: Project[]) => setName(all.find(p => p.id === project)?.name ?? "Project"));
  }), [project]);

  const recent = [...tracks].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")).slice(0, 6);

  return (
    <Shell>
      <motion.div {...rise()}>
        <p className="font-mono text-[11px] uppercase tracking-[.32em] text-brass">{project ? "Project" : "Everything not in a project"}</p>
        <h1 className="mt-2 text-4xl font-bold sm:text-5xl">{name}</h1>
      </motion.div>

      <Section title="Recent" count={tracks.length} href="/studio">
        {recent.length === 0
          ? empty("Nothing here yet. Open the Studio and add a sound or a slide.")
          : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {recent.map((t, i) => {
                const Icon = icons[kindOf(t)];
                return (
                  <motion.li key={t.id} {...rise(i * .04)} className="glass flex items-center gap-3 px-3 py-2.5">
                    <Icon size={16} className={kindOf(t) === "audio" ? "text-audio" : "text-visual"} />
                    <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                    <Link to={`/studio?tab=editor&track=${t.id}`}
                      className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-[.16em] text-muted hover:text-accent">
                      <Pencil size={12} /> Edit
                    </Link>
                  </motion.li>
                );
              })}
            </ul>
          )}
      </Section>

      <Section title="Running orders" count={sequences.length} href="/studio?tab=sequence">
        {sequences.length === 0
          ? empty("No running orders yet. A running order is the list you call from.")
          : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {sequences.map((s, i) => (
                <motion.li key={s.id} {...rise(i * .04)}>
                  <Link to={`/studio?tab=sequence&seq=${s.id}`} className="glass glass-hover flex items-center gap-3 px-3 py-2.5">
                    <ListMusic size={16} className="text-accent" />
                    <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
                    <span className="font-mono text-[11px] text-muted">{s.items.length}</span>
                  </Link>
                </motion.li>
              ))}
            </ul>
          )}
      </Section>

      <Section title="Script" count={script?.cues.length ?? 0} href="/script">
        {!script?.html
          ? empty("No script loaded. Import a Word or PDF file and name the words that matter.")
          : (
            <Link to="/script" className="glass glass-hover flex items-center gap-3 px-3 py-2.5">
              <FileText size={16} className="text-brass" />
              <span className="min-w-0 flex-1 truncate text-sm">{script.name || "Script"}</span>
              <span className="font-mono text-[11px] text-muted">{script.cues.length} marked</span>
            </Link>
          )}
      </Section>

      <Section title="Shows" count={shows.length} href="/studio">
        {shows.length === 0
          ? empty("No shows yet. A show is one performance, across every device in the room.")
          : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {shows.map((s, i) => (
                <motion.li key={s.id} {...rise(i * .04)} className="glass flex items-center gap-3 px-3 py-2.5">
                  <Radio size={16} className={s.startedAt ? "text-live" : "text-muted"} />
                  <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
                  <span className="font-mono text-[11px] tracking-widest text-muted">{s.password}</span>
                </motion.li>
              ))}
            </ul>
          )}
      </Section>

      <div className="mt-12">
        <Button href="/studio" color="primary" size="lg" endContent={<ArrowRight size={17} />}>Open the Studio</Button>
      </div>
    </Shell>
  );
}
