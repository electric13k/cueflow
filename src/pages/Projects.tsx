import { useEffect, useState } from "react";
import { Button, Input, Select } from "../ui";
import { FolderOpen, Pencil, Trash2, UserPlus, Users } from "lucide-react";
import Shell from "../components/Shell";
import { ProjectsSkeleton } from "../components/Skeleton";
import { CoachHelp } from "../components/Coach";
import { teach } from "../lib/coach";
import { toast } from "../lib/toast";
import { onAuth } from "../lib/store";
import {
  addCollaborator, createProject, currentProject, deleteProject, listMembers, listProjects,
  removeMember, setCurrentProject, setMemberRole, updateProject, type Member, type Project,
} from "../lib/projects";
import { ROLES, type Role } from "../lib/collab";

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [who, setWho] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("editor");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [fresh, setFresh] = useState("");
  const [busy, setBusy] = useState(false);
  const here = currentProject();

  // Taught here, not on mount: the control it points at only exists once the page has stopped
  // saying "Looking up your projects…".
  const load = () => void listProjects().then(p => { setProjects(p); setReady(true); teach("projects"); }).catch(e => { toast("Could not load projects", (e as Error).message, "warn"); setReady(true); });
  useEffect(() => onAuth(email => { setSignedIn(!!email); if (email) load(); else setReady(true); }), []);

  const open = (p: Project) => {
    setOpenId(p.id); setName(p.name); setCode(p.code); setMembers([]); setWho(""); setInviteRole("editor");
    void listMembers(p.id).then(setMembers).catch(() => setMembers([]));
  };

  const run = async (job: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await job(); toast("Done", done, "success"); load(); }
    catch (e) { toast("That did not work", (e as Error).message, "warn"); }
    finally { setBusy(false); }
  };

  /** Switching reloads: the open deck and the library both belong to the project you were in. */
  const switchTo = (id: string | null) => { setCurrentProject(id); location.assign("/studio"); };

  if (!ready) return <Shell width="max-w-3xl"><ProjectsSkeleton /></Shell>;

  if (!signedIn) return (
    <Shell width="max-w-3xl">
      <h1 className="text-3xl font-black tracking-tight">Projects</h1>
      <p className="mt-3 text-muted">
        A project is a separate library, a separate set of sequences and its own shows, one per
        production, so last term's assembly is not in the way of this term's play. Sign in to make one.
      </p>
      <Button className="mt-6" href="/studio" color="primary">Open the Studio</Button>
    </Shell>
  );

  return (
    <Shell width="max-w-3xl">
      <p className="text-[11px] font-semibold uppercase tracking-[.3em] text-accent">Projects</p>
      <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">One production, one project</h1>
      <p className="mt-3 text-muted">
        Each project keeps its own sounds, its own sequences and its own shows. People you add
        see all of it; everything outside a project stays yours alone.
      </p>

      <section data-coach="projects" className="glass mt-8 space-y-3 p-6">
        <h2 className="flex items-center gap-2 text-lg font-black tracking-tight">
          <FolderOpen size={18} className="text-accent" />Start one
          <CoachHelp id="projects" className="ml-auto" />
        </h2>
        <div className="flex flex-wrap gap-2">
          <Input className="min-w-48 flex-1" label="Name" value={fresh} onValueChange={setFresh} placeholder="Spring play" />
          <Button className="self-end" color="primary" isLoading={busy}
            onPress={() => void run(async () => { const p = await createProject(fresh); setFresh(""); open(p); }, "Project created.")}>
            Create
          </Button>
        </div>
      </section>

      <section className="mt-6 space-y-3">
        <button type="button" onClick={() => switchTo(null)}
          className={`glass block w-full p-5 text-left ${here ? "" : "ring-1 ring-accent"}`}>
          <p className="font-bold">Your personal library</p>
          <p className="text-sm text-muted">Everything not in a project. {here ? "Click to work here." : "You are working here."}</p>
        </button>

        {projects.map(p => (
          <div key={p.id} className={`glass p-5 ${here === p.id ? "ring-1 ring-accent" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-bold">{p.name}</p>
                <p className="text-sm text-muted">
                  Code <span className="font-mono tracking-widest text-foreground">{p.code}</span>
                  {p.role === "owner" ? " · yours" : " · shared with you"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={here === p.id ? "flat" : "bordered"} onPress={() => switchTo(p.id)}>
                  {here === p.id ? "Working here" : "Work here"}
                </Button>
                {p.role === "owner" && <Button size="sm" variant="light" startContent={<Pencil size={14} />} onPress={() => (openId === p.id ? setOpenId(null) : open(p))}>
                  {openId === p.id ? "Close manager" : "Edit and share"}
                </Button>}
              </div>
            </div>

            {openId === p.id && (
              <div className="mt-5 space-y-5 border-t border-white/10 pt-5">
                <div>
                  <p className="flex items-center gap-2 text-sm font-bold"><Pencil size={15} className="text-accent" />Edit project</p>
                  <p className="mt-1 text-xs text-muted">Change the project name or room code at any time. Existing collaborators keep access.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Input className="min-w-40 flex-1" label="Name" value={name} onValueChange={setName} />
                  <Input className="min-w-40 flex-1" label="Code" value={code} onValueChange={v => setCode(v.trim())} />
                  <Button className="self-end" isLoading={busy}
                    onPress={() => void run(() => updateProject(p.id, { name, code }), "Project updated.")}>Save</Button>
                </div>
                <p className="text-xs text-muted">
                  The code is yours to choose, 4 to 12 letters and numbers, and no two projects can
                  share one. Treat it like a password: anyone you give it to can ask to be let in.
                </p>

                <div className="space-y-2">
                  <h3 className="flex items-center gap-2 text-sm font-bold"><Users size={15} className="text-accent" />People</h3>
                  {members.length === 0 && <p className="text-sm text-muted">Nobody else yet. Add a collaborator below.</p>}
                  {members.map(m => (
                    <div key={m.userId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{m.username ? `@${m.username}` : m.displayName ?? "Someone"}</span>
                      <div className="flex items-center gap-2">
                        <Select aria-label={`Role for ${m.username ?? m.displayName ?? "collaborator"}`} value={m.role}
                          onChange={value => void run(async () => { await setMemberRole(p.id, m.userId, value as Role); setMembers(await listMembers(p.id)); }, "Role updated.")}
                          options={ROLES.map(r => ({ value: r.key, label: r.label }))} size="sm" className="min-w-24" />
                        <Button isIconOnly size="sm" variant="light" aria-label={`Remove ${m.username ?? m.displayName ?? "collaborator"}`}
                          onPress={() => void run(() => removeMember(p.id, m.userId), "Removed.")}><Trash2 size={14} /></Button>
                      </div>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-end gap-2">
                    <Input className="min-w-48 flex-1" label="Username or email" value={who} onValueChange={setWho} placeholder="stage_left" />
                    <Select label="Permission" value={inviteRole} onChange={value => setInviteRole(value as Role)}
                      options={ROLES.map(r => ({ value: r.key, label: r.label }))} className="min-w-32" />
                    <Button className="h-10" isLoading={busy} startContent={<UserPlus size={15} />}
                      onPress={() => void run(async () => { await addCollaborator(p.id, who, inviteRole); setWho(""); setMembers(await listMembers(p.id)); }, "Collaborator added.")}>
                      Add collaborator
                    </Button>
                  </div>
                </div>

                <Button size="sm" variant="light" className="text-live"
                  onPress={() => { if (confirm(`Delete "${p.name}"? Its sounds and sequences are unfiled, not deleted.`)) void run(() => deleteProject(p.id), "Project deleted."); }}>
                  Delete this project
                </Button>
              </div>
            )}
          </div>
        ))}
      </section>
    </Shell>
  );
}
