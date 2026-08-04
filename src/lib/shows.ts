import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, local } from "./store";
import { codeProblem, newCode } from "./projects";

/**
 * What a role is allowed to do. Six switches, and the host decides which ones each job gets --
 * followspot needs the cue list and nothing else, the deputy needs everything but the stage.
 */
export const PERMS = [
  { key: "cues", label: "See the cue list", hint: "The running order, and which cue is live." },
  { key: "script", label: "See the script", hint: "The script reader, with their own keyword flashes." },
  { key: "stage", label: "See the stage", hint: "What the audience is looking at right now." },
  { key: "fire", label: "Fire cues", hint: "Can call the next cue for everyone." },
  { key: "edit", label: "Edit the running order", hint: "Can change cues mid-show." },
  { key: "message", label: "Send messages", hint: "Can flash a line on everyone else's screen." },
] as const;
export type Perm = typeof PERMS[number]["key"];

/** `password` is the collaborator key. Each job's own join key lives on its role, not here. */
export type Show = { id: string; name: string; password: string | null; sequenceId: string | null; startedAt: string | null };
export type Role = { id: string; name: string; perms: Perm[]; code: string | null };
export type Ticket = { member: string; show: string; name: string; sequence: string | null; started: string | null; role: string | null; perms: Perm[]; host: boolean };

const need = () => { if (!supabase) throw new Error("Cloud is not configured for this build."); return supabase; };
const me = async () => (await need().auth.getUser()).data.user;
const row = (s: { id: string; name: string; password: string | null; sequence_id: string | null; started_at: string | null }): Show =>
  ({ id: s.id, name: s.name, password: s.password, sequenceId: s.sequence_id, startedAt: s.started_at });
const COLUMNS = "id,name,password,sequence_id,started_at";

/**
 * Every key in the system -- every role code and every show password -- shares one namespace,
 * because the door takes one box and has to know what you meant by what you typed. The database
 * enforces it; here we just retry, since two people naming a show at the same second is likelier
 * than a genuine 31^6 collision.
 */
const TAKEN = (e: { code?: string; message?: string }) => e.code === "23505" || /already using that key/i.test(e.message ?? "");
type Attempt = { data: unknown; error: { code?: string; message?: string } | null };
async function tryKeys<T>(attempt: (key: string) => PromiseLike<Attempt>): Promise<T> {
  for (let n = 0; n < 4; n++) {
    const { data, error } = await attempt(newCode());
    if (!error) return data as T;
    if (!TAKEN(error)) throw new Error(error.message ?? "Unknown error");
  }
  throw new Error("Could not find a free key. Try again.");
}

export async function listShows(projectId: string | null): Promise<Show[]> {
  if (!supabase) return [];
  if (!(await me())) return [];
  const q = need().from("shows").select(COLUMNS).order("created_at", { ascending: false });
  const { data, error } = await (projectId ? q.eq("project_id", projectId) : q.is("project_id", null));
  if (error) throw new Error(error.message);
  return (data ?? []).map(row);
}

export async function createShow(name: string, projectId: string | null, sequenceId: string | null): Promise<Show> {
  const user = await me();
  if (!user) throw new Error("Sign in to run a show.");
  const made = await tryKeys(key => need().from("shows")
    .insert({ name: name.trim() || "Untitled show", password: key, owner: user.id, project_id: projectId, sequence_id: sequenceId })
    .select(COLUMNS).single());
  return row(made as Parameters<typeof row>[0]);
}

export async function updateShow(id: string, patch: { name?: string; password?: string | null; sequence_id?: string | null; started_at?: string | null }) {
  if (patch.password) {
    const problem = codeProblem(patch.password);
    if (problem) throw new Error(problem);
  }
  const { error } = await need().from("shows").update(patch).eq("id", id);
  if (error) throw new Error(TAKEN(error) ? "Another show is already using that key." : error.message);
}

export const regeneratePassword = (id: string) => updateShow(id, { password: newCode() });
export const deleteShow = async (id: string) => { const { error } = await need().from("shows").delete().eq("id", id); if (error) throw new Error(error.message); };

export async function listRoles(showId: string): Promise<Role[]> {
  const { data, error } = await need().from("show_roles").select("id,name,perms,code").eq("show_id", showId).order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as Role[];
}
export async function addRole(showId: string, name: string, perms: Perm[]): Promise<Role> {
  return await tryKeys<Role>(key => need().from("show_roles")
    .insert({ show_id: showId, name: name.trim() || "Crew", perms, code: key })
    .select("id,name,perms,code").single());
}
export async function updateRole(id: string, patch: { name?: string; perms?: Perm[]; code?: string }) {
  if (patch.code) {
    const problem = codeProblem(patch.code);
    if (problem) throw new Error(problem);
  }
  const { error } = await need().from("show_roles").update(patch).eq("id", id);
  if (error) throw new Error(TAKEN(error) ? "Another job is already using that key." : error.message);
}
export const regenerateRoleCode = (id: string) => updateRole(id, { code: newCode() });
export async function deleteRole(id: string) {
  const { error } = await need().from("show_roles").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// --- the door -------------------------------------------------------------------------------

/**
 * One box. A job's code puts you in that job; the show's password puts you in as a collaborator with
 * everything. Nothing to pick, so nothing to pick wrong five minutes before curtain.
 */
export async function joinShow(key: string, name: string): Promise<Ticket> {
  const { data, error } = await need().rpc("join_show", { p_key: key.trim(), p_name: name.trim() });
  if (error) throw new Error(error.message.replace(/^.*?:\s*/, ""));
  const ticket = data as Ticket;
  local.set("ticket", ticket);
  return ticket;
}

export const savedTicket = () => local.get<Ticket | null>("ticket", null);
export const forgetTicket = () => local.set("ticket", null);

/** Re-reads what this device is allowed to see. The member id it got at the door is the key. */
export async function refreshTicket(member: string): Promise<Ticket | null> {
  const { data, error } = await need().rpc("show_state", { p_member: member });
  if (error || !data) return null;
  return { member, ...(data as Omit<Ticket, "member">) };
}

// --- the channel ----------------------------------------------------------------------------

/**
 * Everything that happens during a show is a broadcast, not a row: a cue fired ten seconds ago is of
 * no use to anyone, and writing it down would only slow the fire down. The show id is a uuid, so
 * knowing it is the same as being in the room.
 */
export type DeckCue = { id: string; label: string; number: string; kind: string };
export type ShowMsg =
  /** The host, telling the room where it is. `deck` is the whole running order, sent on request. */
  | { type: "deck"; show: string; cues: DeckCue[]; index: number; script?: string; stage?: { url: string; kind: string; label: string } | null }
  | { type: "cue"; index: number; label: string }
  | { type: "start"; at: string }
  | { type: "end" }
  /** …and the room, talking back. */
  | { type: "here"; who: string; role: string | null }
  | { type: "fire"; index: number; from: string }
  | { type: "relabel"; id: string; label: string; from: string }
  | { type: "flash"; text: string; from: string };

/**
 * Realtime refuses a payload much past 256 KB, and a long script is the only thing here that gets
 * close. Send what fits and say so, rather than having the whole deck message silently vanish.
 */
export const SCRIPT_LIMIT = 180_000;

export function showChannel(showId: string, onMessage: (m: ShowMsg) => void): { send: (m: ShowMsg) => void; close: () => void } {
  const client = supabase;
  if (!client) return { send: () => {}, close: () => {} };
  const channel: RealtimeChannel = client.channel(`show:${showId}`, { config: { broadcast: { self: false } } });
  channel.on("broadcast", { event: "msg" }, ({ payload }) => onMessage(payload as ShowMsg)).subscribe();
  return {
    send: m => void channel.send({ type: "broadcast", event: "msg", payload: m }),
    close: () => void client.removeChannel(channel),
  };
}
