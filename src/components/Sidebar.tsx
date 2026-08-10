import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { FolderClosed, FolderOpen, Home, LogIn, Plus, Radio, Settings, SlidersHorizontal, UserRound } from "lucide-react";
import { currentProject, listProjects, setCurrentProject, type Project } from "../lib/projects";
import { useSignedIn } from "./RequireAuth";
import { teach } from "../lib/coach";
import { CoachHelp } from "./Coach";

/**
 * The one place the hierarchy is visible: a project holds a library, its sequences, its script and
 * its shows. Everything outside a project is the personal workspace. Nothing else belongs here --
 * this is a list of places, not a menu of features.
 *
 * Signed out there is no hierarchy to show, and every place it would list is a route that will not
 * render, so it lists the two that will and offers the way in.
 */
export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const signedIn = useSignedIn();
  const here = currentProject();
  const { pathname } = useLocation();

  useEffect(() => {
    if (!signedIn) { setProjects([]); return; }
    void listProjects().then(setProjects).catch(() => setProjects([]));
  }, [signedIn]);

  // The hierarchy explains itself the first time you can see it.
  useEffect(() => teach("sidebar"), []);

  /** Switching reloads: the library, the open deck and the shows all change with the project. */
  // BASE_URL, because GitHub Pages serves the app from /<repo>/ and a bare "/workspace" leaves it.
  const open = (id: string | null) => { setCurrentProject(id); location.assign(`${import.meta.env.BASE_URL}workspace`); };

  // min-h-11 is 44px, the smallest target a thumb hits reliably. At py-2 these were 36px rows and
  // picking a project on a phone took two goes.
  const row = "flex min-h-11 w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors";
  const on = "bg-accent/12 text-foreground";
  const off = "text-muted hover:bg-white/5 hover:text-foreground";

  if (!signedIn) return (
    <nav data-coach="sidebar" aria-label="Workspace" className="flex h-full flex-col gap-6 p-4">
      <Link to="/studio" onClick={onNavigate} className={`${row} ${pathname === "/studio" ? on : off}`}>
        <SlidersHorizontal size={16} /> Studio
      </Link>
      <div className="space-y-2 rounded-md border border-dashed border-white/15 p-3">
        <p className="text-xs text-muted">Your sounds and sequences live in this browser. An account gives them a workspace that follows you.</p>
        {/* One auth modal in the app, and the nav owns it. This asks for it rather than cloning it. */}
        <button type="button" className={`${row} ${off}`} onClick={() => { onNavigate?.(); window.dispatchEvent(new Event("cueflow:signin")); }}>
          <LogIn size={16} /> Sign in
        </button>
      </div>
      <div className="mt-auto space-y-1">
        <Link to="/settings" onClick={onNavigate} className={`${row} ${pathname === "/settings" ? on : off}`}><Settings size={16} /> Settings</Link>
      </div>
    </nav>
  );

  return (
    <nav data-coach="sidebar" aria-label="Workspace" className="flex h-full flex-col gap-6 p-4">
      <Link to="/workspace" onClick={onNavigate} className={`${row} ${pathname === "/workspace" ? on : off}`}>
        <Home size={16} /> Recents
      </Link>

      <div className="space-y-1">
        <div className="flex items-center justify-between pb-1 pl-3 pr-1">
          <p className="font-mono text-[10px] uppercase tracking-[.28em] text-muted">Workspaces</p>
          <CoachHelp id="sidebar" />
        </div>
        <button type="button" onClick={() => { open(null); onNavigate?.(); }} className={`${row} ${here ? off : on}`}>
          <FolderOpen size={16} /> Personal
        </button>
        {projects.map(p => (
          <button key={p.id} type="button" onClick={() => { open(p.id); onNavigate?.(); }}
            className={`${row} ${here === p.id ? on : off}`}>
            {here === p.id ? <FolderOpen size={16} /> : <FolderClosed size={16} />}
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
          </button>
        ))}
        <Link to="/projects" onClick={onNavigate} className={`${row} ${pathname === "/projects" ? on : off}`}><Plus size={16} /> New project</Link>
      </div>

      <div className="mt-auto space-y-1">
        <Link to="/studio" onClick={onNavigate} className={`${row} ${pathname === "/studio" ? on : off}`}><SlidersHorizontal size={16} /> Studio</Link>
        <Link to="/show" onClick={onNavigate} className={`${row} ${pathname === "/show" ? on : off}`}><Radio size={16} /> Join a show</Link>
        <Link to="/settings" onClick={onNavigate} className={`${row} ${pathname === "/settings" ? on : off}`}><Settings size={16} /> Settings</Link>
        <Link to="/account" onClick={onNavigate} className={`${row} ${pathname === "/account" ? on : off}`}><UserRound size={16} /> Account</Link>
      </div>
    </nav>
  );
}
