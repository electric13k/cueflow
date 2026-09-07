import { supabase, local } from "./store";
import { codeProblem, newCode } from "./projects";

/**
 * What a role is allowed to do. Six switches, and the host decides which ones each job gets --
 * followspot needs the cue list and nothing else, the deputy needs everything but the stage.
 */
export const PERMS = [
  { key: "cues", label: "See the cue list", hint: "The sequence, and which cue is live." },
  { key: "script", label: "See the script", hint: "The script reader, with their own keyword flashes." },
  { key: "stage", label: "See the stage", hint: "What the audience is looking at right now." },
  { key: "fire", label: "Fire cues", hint: "Can call the next cue for everyone." },
  { key: "edit", label: "Edit the sequence", hint: "Can change cues mid-show." },
  { key: "message", label: "Send messages", hint: "Can flash a line on everyone else's screen." },
] as const;
export type Perm = typeof PERMS[number]["key"];

/** `password` is the collaborator key. Each job's own join key lives on its role, not here. */
export type Show = { id: string; name: string; password: string | null; sequenceId: string | null; startedAt: string | null; owner?: string | null };
export type Role = { id: string; name: string; perms: Perm[]; code: string | null };
export type Ticket = { member: string; show: string; name: string; sequence: string | null; started: string | null; role: string | null; perms: Perm[]; host: boolean };

const need = () => { if (!supabase) throw new Error("Cloud is not configured for this build."); return supabase; };
const me = async () => (await need().auth.getUser()).data.user;
const row = (s: { id: string; name: string; password: string | null; sequence_id: string | null; started_at: string | null; owner?: string | null }): Show =>
  ({ id: s.id, name: s.name, password: s.password, sequenceId: s.sequence_id, startedAt: s.started_at, owner: s.owner ?? null });
const COLUMNS = "id,name,password,sequence_id,started_at,owner";

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
/**
 * `url` and `effects` are only sent to a member the server says holds `fire`.
 *
 * Withholding them from everybody was deliberate -- "a device that only reads cues has no business
 * being able to download them" -- but it also meant the person actually calling the cue heard
 * nothing, because the sound only ever played on the machine the file happened to be stored on. A
 * device that is allowed to fire a cue has to be able to make the sound; a device that is only
 * reading the list still gets a label and nothing else.
 *
 * Never a `blob:` URL. Those are scoped to the document that made them, so one on the wire is a
 * cue that cannot possibly load anywhere else -- see `playableUrl`.
 */
export type DeckCue = { id: string; label: string; number: string; kind: string; url?: string; effects?: unknown };

/**
 * The URL to put on the wire, or nothing.
 *
 * A `blob:` URL belongs to one document and means the file is still uploading, or its upload
 * failed. Broadcasting it produces a cue that silently never loads on any other device, which is
 * worse than a cue that is honestly marked as not being available yet.
 */
export const playableUrl = (url: string | undefined) =>
  url && !url.startsWith("blob:") && !url.startsWith("data:") ? url : undefined;
export type ShowMsg =
  /**
   * The host, telling the room where it is. `deck` is the whole sequence, sent on request.
   *
   * `sequence` is the id of the sequence these cues came from, and it is what makes a crew `fire`
   * safe: the host used to index whatever sequence the operator happened to have open, so switching
   * sequences mid-show turned a crew "Go" on cue 4 into whatever now sat at position 4.
   */
  | { type: "deck"; to?: string; show: string; sequence: string; cues: DeckCue[]; index: number; script?: string; stage?: { url: string; kind: string; label: string; slideIndex?: number } | null }
  | { type: "cue"; index: number; label: string }
  | { type: "start"; at: string }
  | { type: "end" }
  /**
   * …and the room, talking back. Every one of these carries `member`, the id the server handed out
   * at the door, because the host verifies what the sender is allowed to do before acting on it.
   * A message with no member is from something that never came through the door, and is ignored.
   */
  | { type: "here"; who: string; role: string | null; member: string }
  | { type: "fire"; index: number; sequence: string; from: string; member: string }
  | { type: "relabel"; id: string; label: string; from: string; member: string }
  | { type: "flash"; text: string; from: string; member: string };

/**
 * Realtime refuses a payload much past 256 KB, and a long script is the only thing here that gets
 * close. Send what fits and say so, rather than having the whole deck message silently vanish.
 */
export const SCRIPT_LIMIT = 180_000;

/**
 * What a member of this show is allowed to do, according to the server rather than according to the
 * message that just arrived.
 *
 * The room is a broadcast, so anyone holding the show id can put a `fire` on the wire, and until now
 * the host acted on it: the perms decided which buttons a crew device drew, not what the host would
 * accept. `show_state` is the same call the door uses, so this asks the database the same question
 * the joiner's own ticket answers, and a revoked role stops working here too.
 *
 * Cached briefly. Without it a busy show re-asks on every cue; with it a revocation takes at most
 * `TICKET_TTL` to bite, which is the trade worth making.
 */
const TICKET_TTL = 15_000;
const ticketCache = new Map<string, { at: number; ticket: Promise<Ticket | null> }>();

export function forgetMemberPerms(member?: string) {
  if (member) ticketCache.delete(member); else ticketCache.clear();
}

export async function memberPerms(member: string, showId: string): Promise<Perm[]> {
  if (!member || !supabase) return [];
  const held = ticketCache.get(member);
  const fresh = held && Date.now() - held.at < TICKET_TTL
    ? held.ticket
    : refreshTicket(member).catch(() => null);
  if (fresh !== held?.ticket) ticketCache.set(member, { at: Date.now(), ticket: fresh });
  const ticket = await fresh;
  // A real member of some other show is still a stranger to this one.
  if (!ticket || ticket.show !== showId) return [];
  return ticket.host ? PERMS.map(p => p.key) : (ticket.perms ?? []);
}

export const memberCan = async (member: string, showId: string, perm: Perm) =>
  (await memberPerms(member, showId)).includes(perm);
