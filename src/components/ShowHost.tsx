import { useEffect, useState } from "react";
import { Button, Input, Switch } from "../ui";
import { Copy, Plus, RefreshCw, Send, Square, Trash2, Radio } from "lucide-react";
import { toast } from "../lib/toast";
import {
  addRole, createShow, deleteRole, deleteShow, listRoles, listShows, PERMS, regeneratePassword,
  regenerateRoleCode, updateRole, updateShow, type Perm, type Role, type Show,
} from "../lib/shows";

/**
 * The host's side of a show: the code people type, the jobs they can hold, and the switch that turns
 * a rehearsal into a performance. Everything that happens once it is live goes over the channel in
 * the Studio, not through here.
 */
export default function ShowHost({ projectId, sequenceId, show, setShow, onFlash }: {
  projectId: string | null;
  sequenceId: string;
  show: Show | null;
  setShow: (s: Show | null) => void;
  onFlash: (text: string) => void;
}) {
  const [shows, setShows] = useState<Show[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [roleName, setRoleName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = () => void listShows(projectId).then(setShows).catch(e => toast("Could not load shows", (e as Error).message, "warn"));
  useEffect(reload, [projectId]);
  useEffect(() => {
    setName(show?.name ?? ""); setPassword(show?.password ?? "");
    if (show) void listRoles(show.id).then(setRoles).catch(() => setRoles([]));
    else setRoles([]);
  }, [show?.id, show?.password]);

  const run = async (job: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await job(); if (done) toast("Done", done, "success"); reload(); }
    catch (e) { toast("That did not work", (e as Error).message, "warn"); }
    finally { setBusy(false); }
  };

  const refresh = async () => { const list = await listShows(projectId); setShows(list); if (show) setShow(list.find(s => s.id === show.id) ?? null); };

  const togglePerm = (role: Role, perm: Perm) => {
    const next = role.perms.includes(perm) ? role.perms.filter(p => p !== perm) : [...role.perms, perm];
    setRoles(rs => rs.map(r => (r.id === role.id ? { ...r, perms: next } : r)));
    void updateRole(role.id, { perms: next }).catch(e => toast("Could not save the role", (e as Error).message, "warn"));
  };

  if (!show) return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        A show is one performance across however many devices are in the room. Everyone types the same
        code, no accounts, and what each of them can see and do comes from the job you give them.
      </p>
      <div className="flex flex-wrap gap-2">
        <Input className="min-w-48 flex-1" label="Name this show" value={name} onValueChange={setName} placeholder="Friday night" />
        <Button className="self-end" color="primary" isLoading={busy} startContent={<Plus size={15} />}
          onPress={() => void run(async () => setShow(await createShow(name, projectId, sequenceId || null)), "Show created.")}>
          Create
        </Button>
      </div>
      {shows.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[.2em] text-muted">Or reopen one</p>
          {shows.map(s => (
            <button key={s.id} type="button" onClick={() => setShow(s)}
              className="flex w-full items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2 text-left text-sm hover:bg-white/10">
              <span>{s.name}</span>
              <span className="font-mono tracking-widest text-muted">{s.password}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.2em] text-muted">Collaborator password</p>
          <p className="font-mono text-3xl font-black tracking-[.3em] text-accent">{show.password ?? "-"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="bordered" startContent={<Copy size={14} />}
            onPress={() => void navigator.clipboard?.writeText(`${location.origin}/show, ${show.password ?? ""}`).then(() => toast("Copied", "Only give that to someone who should run the show with you.", "success"))}>
            Copy
          </Button>
          <Button size="sm" variant="light" startContent={<RefreshCw size={14} />} isLoading={busy}
            onPress={() => void run(async () => { await regeneratePassword(show.id); await refresh(); }, "New password. The old one no longer works.")}>
            New password
          </Button>
          <Button size="sm" variant="light" onPress={() => setShow(null)}>Close</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input className="min-w-40 flex-1" label="Name" value={name} onValueChange={setName} />
        <Input className="min-w-40 flex-1" label="Password" value={password} onValueChange={v => setPassword(v.trim())} autoComplete="off" />
        <Button className="self-end" isLoading={busy}
          onPress={() => void run(async () => {
            await updateShow(show.id, { name, password: password.trim() || null });
            await refresh();
          }, "Saved.")}>
          Save
        </Button>
      </div>
      <p className="text-xs text-muted">
        The password lets someone in as a <strong>collaborator</strong>: everything a job can see, plus
        firing cues, editing them and calling the show on. Give it only to the person running it with
        you. It is yours to choose, 4 to 12 letters and numbers, and it may be the same string as one
        of the job keys below, but it can never be a key another show is already using. Nothing to
        recover if it is lost: type a new one and tell the person who needs it.
      </p>

      <section className="space-y-3">
        <h3 className="text-sm font-bold">Jobs and their keys</h3>
        <p className="text-xs text-muted">
          Each job has its own key. Whoever types it lands in that job, you decide who does what by
          deciding who gets which key, and a key you replace stops working the moment you save it.
        </p>
        {roles.map(role => (
          <div key={role.id} className="rounded-2xl bg-white/5 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input size="sm" className="min-w-32 flex-1" value={role.name}
                onValueChange={v => { setRoles(rs => rs.map(r => (r.id === role.id ? { ...r, name: v } : r))); }} />
              <Input size="sm" className="min-w-28 flex-1 font-mono" value={role.code ?? ""}
                onValueChange={v => { setRoles(rs => rs.map(r => (r.id === role.id ? { ...r, code: v.trim() } : r))); }} />
              <Button size="sm" variant="light" isLoading={busy}
                onPress={() => void run(async () => { await updateRole(role.id, { name: role.name, code: role.code ?? undefined }); setRoles(await listRoles(show.id)); }, "Saved.")}>
                Save
              </Button>
              <Button isIconOnly size="sm" variant="light" aria-label="New key for this job" isLoading={busy}
                onPress={() => void run(async () => { await regenerateRoleCode(role.id); setRoles(await listRoles(show.id)); }, "New key. The old one no longer works.")}>
                <RefreshCw size={14} />
              </Button>
              <Button isIconOnly size="sm" variant="light" aria-label="Delete job"
                onPress={() => void run(async () => { await deleteRole(role.id); setRoles(rs => rs.filter(r => r.id !== role.id)); }, "")}>
                <Trash2 size={14} />
              </Button>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {PERMS.map(p => (
                <label key={p.key} className="flex items-start gap-2 text-sm">
                  <Switch size="sm" isSelected={role.perms.includes(p.key)} onValueChange={() => togglePerm(role, p.key)} aria-label={p.label} />
                  <span><span className="font-medium">{p.label}</span><br /><span className="text-xs text-muted">{p.hint}</span></span>
                </label>
              ))}
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Input className="min-w-40 flex-1" size="sm" label="New job" value={roleName} onValueChange={setRoleName} placeholder="Followspot" />
          <Button className="self-end" size="sm" isLoading={busy}
            onPress={() => void run(async () => { setRoles([...roles, await addRole(show.id, roleName, ["cues"])]); setRoleName(""); }, "")}>
            Add job
          </Button>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-bold">Say something</h3>
        <div className="flex gap-2">
          <Input className="flex-1" value={message} onValueChange={setMessage} placeholder="Hold the next cue"
            onKeyDown={e => { if (e.key === "Enter" && message.trim()) { onFlash(message.trim()); setMessage(""); } }} />
          <Button isIconOnly color="primary" aria-label="Flash it"
            onPress={() => { if (message.trim()) { onFlash(message.trim()); setMessage(""); } }}><Send size={16} /></Button>
        </div>
        <p className="text-xs text-muted">It flashes on every device in the show. No sound, ever, that is the point.</p>
      </section>

      <section className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
        {show.startedAt
          ? <Button color="danger" variant="flat" startContent={<Square size={15} />} isLoading={busy}
              onPress={() => void run(async () => { await updateShow(show.id, { started_at: null }); await refresh(); }, "Show ended.")}>End the show</Button>
          : <Button color="primary" startContent={<Radio size={15} />} isLoading={busy}
              onPress={() => void run(async () => { await updateShow(show.id, { started_at: new Date().toISOString(), sequence_id: sequenceId || null }); await refresh(); }, "Live. Every device is locked in.")}>Start the show</Button>}
        <Button size="sm" variant="light" className="ml-auto text-live"
          onPress={() => { if (confirm(`Delete "${show.name}"?`)) void run(async () => { await deleteShow(show.id); setShow(null); }, "Show deleted."); }}>
          Delete
        </Button>
      </section>
    </div>
  );
}
