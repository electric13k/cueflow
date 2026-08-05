import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { FolderClosed, FolderOpen, Home, Plus, Radio, Settings, UserRound } from "lucide-react";
import { currentProject, listProjects, setCurrentProject, type Project } from "../lib/projects";
import { onAuth } from "../lib/store";

/**
 * The one place the hierarchy is visible: a project holds a library, its running orders, its script
 * and its shows. Everything outside a project is the personal workspace. Nothing else belongs here --
 * this is a list of places, not a menu of features.
 */
export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [signedIn, setSignedIn] = useState(false);
  const here = currentProject();
  const { pathname } = useLocation();

  useEffect(() => onAuth(email => {
    setSignedIn(!!email);
    if (email) void listProjects().then(setProjects).catch(() => setProjects([]));
    else setProjects([]);
  }), []);

  /** Switching reloads: the library, the open deck and the shows all change with the project. */
  const open = (id: string | null) => { setCurrentProject(id); location.assign("/workspace"); };

  const row = "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors";
  const on = "bg-accent/12 text-foreground";
  const off = "text-muted hover:bg-white/5 hover:text-foreground";

  return (
    <nav aria-label="Workspace" className="flex h-full flex-col gap-6 p-4">
      <Link to="/workspace" onClick={onNavigate} className={`${row} ${pathname === "/workspace" ? on : off}`}>
        <Home size={16} /> Recents
      </Link>

      <div className="space-y-1">
        <p className="px-3 pb-1 font-mono text-[10px] uppercase tracking-[.28em] text-muted">Workspaces</p>
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
        {signedIn
          ? <Link to="/projects" onClick={onNavigate} className={`${row} ${off}`}><Plus size={16} /> New project</Link>
          : <p className="px-3 py-2 text-xs text-muted">Sign in to keep projects.</p>}
      </div>

      <div className="mt-auto space-y-1">
        <Link to="/show" onClick={onNavigate} className={`${row} ${pathname === "/show" ? on : off}`}><Radio size={16} /> Join a show</Link>
        <Link to="/settings" onClick={onNavigate} className={`${row} ${pathname === "/settings" ? on : off}`}><Settings size={16} /> Settings</Link>
        <Link to="/account" onClick={onNavigate} className={`${row} ${pathname === "/account" ? on : off}`}><UserRound size={16} /> Account</Link>
      </div>
    </nav>
  );
}
