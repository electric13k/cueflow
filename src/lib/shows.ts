import { supabase, local } from "./store";
import { codeProblem, newCode } from "./projects";
import {
  addLocalRole, deleteLocalRole, deleteLocalShow, isLocalKey, isLocalRole, isLocalShowId, joinLocalShow, listLocalShows,
  localPerms, localRoles, localTicket, newLocalShow, rememberDoor, updateLocalRole, updateLocalShow,
} from "./localShow";

/**
 * What a role is allowed to do. Seven switches, and the host decides which ones each job gets --
 * followspot needs the cue list and nothing else, the deputy needs everything but the stage.
 */
export const PERMS = [
  { key: "cues", label: "See the cue list", hint: "The sequence, and which cue is live." },
  { key: "script", label: "See the script", hint: "The script reader, with their own keyword flashes." },
  { key: "stage", label: "See the stage", hint: "What the audience is looking at right now." },
  /**
   * The switch that makes a device an output rather than a viewer.
   *
   * Cue URLs used to go only to a device holding `fire`, on the reasoning that a screen which only
   * reads cues has no business downloading them. That left no way at all to describe the device
   * pointed at the audience: it has to make the sound and fill the screen, and it must not be able
   * to touch anything. This is that device, and it is the second holder of a cue URL.
   */
  { key: "play", label: "Play cues out loud", hint: "An output for the audience: sound comes out of it and the stage fills it." },
  { key: "fire", label: "Fire cues", hint: "Can call the next cue for everyone." },
  { key: "edit", label: "Edit the sequence", hint: "Can change cues mid-show." },
  { key: "message", label: "Send messages", hint: "Can flash a line on everyone else's screen." },
] as const;
export type Perm = typeof PERMS[number]["key"];

/**
 * The three jobs almost every show actually has, so that setting one up is three presses rather
 * than three role rows and twenty switches.
 *
 * A show is a controller, an output, and the people who need to hear the cue without touching it.
 * Everything else the switches above can still describe; these are the shapes worth having a name
 * for, and `ROLE_PRESETS` is what the host's "set this up for me" button writes.
 */
export type RolePreset = { key: string; name: string; hint: string; perms: Perm[] };
export const ROLE_PRESETS: RolePreset[] = [
  {
    key: "controller",
    name: "Controller",
    hint: "A phone in someone's hand. Calls the cues, scrolls the script, and everyone else follows it.",
    perms: ["cues", "script", "stage", "fire", "edit", "message"],
  },
  {
    key: "display",
    name: "Display",
    hint: "The screen and speakers the audience gets. No controls on it at all, on purpose.",
    perms: ["stage", "play"],
  },
  {
    key: "backstage",
    name: "Backstage",
    hint: "Hears every cue and reads along with whoever is holding the controller. Cannot fire.",
    perms: ["cues", "script", "message"],
  },
];

/**
 * A device with no way to touch the show and every way to be seen by the audience.
 *
 * Asked as a shape rather than a role name, because the name is the host's to choose: a job called
 * "Foyer TV" with these switches is still a display, and a controller that happens to also carry
 * `play` is still a controller.
 */
export const isDisplayRole = (perms: Perm[] | undefined) =>
  !!perms?.includes("play") && !perms.includes("cues") && !perms.includes("script") && !perms.includes("fire");

/** `password` is the collaborator key. Each job's own join key lives on its role, not here. */
export type Show = { id: string; name: string; password: string | null; sequenceId: string | null; startedAt: string | null; owner?: string | null };
export type Role = { id: string; name: string; perms: Perm[]; code: string | null };
/**
 * `status` is what the database says about this member, which is a different question from what the
 * host's tab last broadcast. Optional because a deployment whose database has not had 0003 applied
 * answers without it, and the honest reading of a missing answer is the one that was true before the
 * column gated anything: admitted.
 */
export type MemberStatus = "waiting" | "admitted" | "denied";
export type Ticket = { member: string; show: string; name: string; sequence: string | null; started: string | null; role: string | null; perms: Perm[]; host: boolean; status?: MemberStatus };

/** A ticket with no status came from a database that does not gate, so it is not held at the door. */
export const atTheDoor = (ticket: Ticket | null): MemberStatus | null =>
  !ticket ? null : ticket.status && ticket.status !== "admitted" ? ticket.status : null;

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

/**
 * Which authority answers for this show: Postgres, or the device it is running on.
 *
 * Asked of the show rather than of the build, and that distinction is the whole thing. The
 * Supabase URL and key are hardcoded as fallbacks in `store.ts`, so a client always exists and
 * `!supabase` is almost never true; a build that branched on it would have shipped an offline path
 * nobody could ever reach. A local show is told by its id, which is its code: `CF-` and six
 * characters. One string, and no second column to disagree with it.
 *
 * It also means the two kinds live side by side. The same operator can have cloud shows that
 * follow them between devices and a local one for the venue whose wifi is a rumour.
 */
const isLocal = (id: string) => isLocalShowId(id);

export async function listShows(projectId: string | null): Promise<Show[]> {
  // Both kinds, local first. A device that minted its own show used to be told it had none, which
  // is only true if a show has to be a row. Local shows are not filtered by project: a `Show`
  // carries no project, and the local list is one device's worth.
  const mine = listLocalShows();
  if (!supabase || !(await me())) return mine;
  const q = need().from("shows").select(COLUMNS).order("created_at", { ascending: false });
  const { data, error } = await (projectId ? q.eq("project_id", projectId) : q.is("project_id", null));
  if (error) throw new Error(error.message);
  return [...mine, ...(data ?? []).map(row)];
}

export async function createShow(name: string, projectId: string | null, sequenceId: string | null): Promise<Show> {
  // Nobody signed in used to be a refusal. An account is what makes a show follow you to another
  // device; it is not what makes a show, and "sign in to run a show" is the wrong answer to give
  // someone standing in a venue twenty minutes before a house opens. The show is minted here
  // instead, with the three preset jobs already on it.
  const user = supabase ? await me() : null;
  if (!user) return newLocalShow(name, sequenceId);
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
  if (isLocal(id)) return updateLocalShow(id, patch);
  const { error } = await need().from("shows").update(patch).eq("id", id);
  if (error) throw new Error(TAKEN(error) ? "Another show is already using that key." : error.message);
}

export const regeneratePassword = (id: string) => updateShow(id, { password: newCode() });
export const deleteShow = async (id: string) => { if (isLocal(id)) return deleteLocalShow(id); const { error } = await need().from("shows").delete().eq("id", id); if (error) throw new Error(error.message); };

export async function listRoles(showId: string): Promise<Role[]> {
  if (isLocal(showId)) return localRoles(showId);
  const { data, error } = await need().from("show_roles").select("id,name,perms,code").eq("show_id", showId).order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as Role[];
}
export async function addRole(showId: string, name: string, perms: Perm[]): Promise<Role> {
  if (isLocal(showId)) return addLocalRole(showId, name, perms);
  return await tryKeys<Role>(key => need().from("show_roles")
    .insert({ show_id: showId, name: name.trim() || "Crew", perms, code: key })
    .select("id,name,perms,code").single());
}
export async function updateRole(id: string, patch: { name?: string; perms?: Perm[]; code?: string }) {
  if (patch.code) {
    const problem = codeProblem(patch.code);
    if (problem) throw new Error(problem);
  }
  // A role id is a uuid either way, so its shape cannot answer this the way a show's id can.
  if (isLocalRole(id)) return updateLocalRole(id, patch);
  const { error } = await need().from("show_roles").update(patch).eq("id", id);
  if (error) throw new Error(TAKEN(error) ? "Another job is already using that key." : error.message);
}
export const regenerateRoleCode = (id: string) => updateRole(id, { code: newCode() });
export async function deleteRole(id: string) {
  if (isLocalRole(id)) return deleteLocalRole(id);
  const { error } = await need().from("show_roles").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// --- the door -------------------------------------------------------------------------------

/**
 * One box. A job's code puts you in that job; the show's password puts you in as a collaborator with
 * everything. Nothing to pick, so nothing to pick wrong five minutes before curtain.
 */
export async function joinShow(key: string, name: string): Promise<Ticket> {
  // A key this device already knows is answered here whether or not there is a cloud, because a
  // venue with a flaky uplink is exactly where a show that half reaches Postgres is worse than one
  // that never tries. Anything else still goes to the database when there is one.
  if (!supabase || isLocalKey(key)) {
    const local_ = joinLocalShow(key, name);
    local.set("ticket", local_);
    return local_;
  }
  const { data, error } = await need().rpc("join_show", { p_key: key.trim(), p_name: name.trim() });
  if (error) throw new Error(error.message.replace(/^.*?:\s*/, ""));
  const ticket = data as Ticket;
  local.set("ticket", ticket);
  return ticket;
}

/**
 * Whether this show's door is a database or the device running it.
 *
 * Asked rather than assumed, because the two doors answer differently and the difference matters
 * at exactly one place: on a local show nobody has heard of a device until it knocks, so a
 * stranger's `here` cannot be dropped for holding no permissions the way the cloud drops it.
 */
export const cloudDoor = (showId: string) => !!supabase && !isLocal(showId);

/**
 * Write down what the door said. A no-op on a cloud show, which already knows.
 *
 * Called on both sides of the wire. The joiner calls it so that a job the host granted survives a
 * reload; the host calls it so that the next `fire` from that device can be checked against
 * something. See `rememberDoor` in `localShow.ts`.
 */
export function noteDoor(member: string, show: string, state: "waiting" | "in" | "out", role: string | null, perms: Perm[], name?: string) {
  if (cloudDoor(show)) return;
  rememberDoor(member, show, state, role, perms, name);
  forgetMemberPerms(member);
}

export const savedTicket = () => local.get<Ticket | null>("ticket", null);
export const forgetTicket = () => local.set("ticket", null);

/** Re-reads what this device is allowed to see. The member id it got at the door is the key. */
export async function refreshTicket(member: string): Promise<Ticket | null> {
  // A seat on this device belongs to a local show, so there is no row to ask about and asking
  // would only fail. Checked before the client, because the client always exists.
  const seat = localTicket(member);
  if (seat) return seat;
  if (!supabase) return null;
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
  /** `sequence` is which list the index counts in. Without it a Go that overtakes a deck resend
   *  lands on whatever now sits at that position in the sequence the operator just left. */
  | { type: "cue"; index: number; label: string; sequence?: string }
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
  | { type: "flash"; text: string; from: string; member: string }
  /**
   * Where the controller has got to in the script.
   *
   * Backstage does not want a teleprompter running at its own speed; it wants the page the person
   * calling the show is looking at. `at` is a position in the script rather than a pixel offset,
   * because a phone at 18px and a monitor at 28px have completely different scroll heights and the
   * same block of text sits in a different place on each: the whole number is the index of the
   * block under the reading line, and the fraction is how far through that block the line has got.
   *
   * It takes the same route every other crew message takes. A controller sends it, the host checks
   * that the sender really holds `fire`, and the host re-broadcasts it; nobody applies one straight
   * off the wire, so a stranger with the show id cannot drag every script in the building.
   * `member` is the controller it came from, kept across the relay so that controller ignores the
   * echo of its own scrolling.
   */
  | { type: "scroll"; at: number; member: string }
  /**
   * The host answering the door, and re-answering it whenever the answer changes.
   *
   * One message rather than three, because admitting somebody, refusing them and changing their job
   * are the same act from the crew device's point of view: this is who you are in this room now.
   * `waiting` is the state that did not exist at all -- anyone with the key was simply in, and the
   * host's only sign that a stranger had arrived was a toast that accumulated nothing.
   *
   * Addressed, like the deck. A device applies only the one naming it.
   */
  | { type: "door"; member: string; state: "waiting" | "in" | "out"; role?: string | null; perms?: Perm[]; note?: string };

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
  if (!member) return [];
  // On a local show the seat on this device is the whole authority, and it is a synchronous read
  // of local storage: no request to fail, so nothing to cache and nothing to retry. Returning an
  // empty list here, which is what a build with no cloud did, meant the host refused every cue its
  // own crew called in a venue with no internet.
  if (isLocal(showId)) return localPerms(member, showId);
  if (!supabase) return [];
  const held = ticketCache.get(member);
  const usable = held && Date.now() - held.at < TICKET_TTL;
  // An answer is worth caching; a failure is not. Caching one meant a single dropped request denied
  // a member who genuinely holds `fire` for the next fifteen seconds, silently, while the wire and
  // the ticket were both fine. Forget it instead, so the next cue asks again.
  const fresh = usable
    ? held.ticket
    : refreshTicket(member).catch(() => { ticketCache.delete(member); return null; });
  if (fresh !== held?.ticket) ticketCache.set(member, { at: Date.now(), ticket: fresh });
  const ticket = await fresh;
  // A real member of some other show is still a stranger to this one.
  if (!ticket || ticket.show !== showId) return [];
  return ticket.host ? PERMS.map(p => p.key) : (ticket.perms ?? []);
}

export const memberCan = async (member: string, showId: string, perm: Perm) =>
  (await memberPerms(member, showId)).includes(perm);
