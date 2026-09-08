import { createClient } from "@supabase/supabase-js";
import { toast } from "./toast";
import type { Sequence, SequenceItem, Track } from "../types";
// Supabase publishable credentials are safe to ship in a browser build. The fallback keeps the
// static Pages deployment functional when its build environment is not injected by Cloudflare.
const url = import.meta.env.VITE_SUPABASE_URL || "https://uumbvunbgcbkzoenupay.supabase.co";
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_UVLFeDFDrxvAeVesqdEeHw_pdQRrzLb";
export const supabase = createClient(url, key);

// Auth: email + password. Cloud save/hydrate already gate on getUser(), so signing in activates them.
export async function signUp(email: string, password: string) { if (!supabase) throw new Error("Cloud not configured"); const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}${import.meta.env.BASE_URL}workspace` } }); if (error) throw error; }
// NOTE: emailRedirectTo only works if the URL is allow-listed in Supabase → Authentication → URL
// Configuration. Otherwise Supabase falls back to Site URL, which defaults to http://localhost:3000.
/**
 * Email or username, whichever they typed. A username cannot be resolved to an address in the
 * browser without publishing a username-to-email directory to anyone holding the anon key, so that
 * half runs in an edge function and the address never comes back here.
 */
export async function signIn(who: string, password: string) {
  if (!supabase) throw new Error("Cloud not configured");
  const id = who.trim();
  if (id.includes("@")) {
    const { error } = await supabase.auth.signInWithPassword({ email: id, password });
    if (error) throw error;
    return;
  }
  const res = await fetch(`${url}/functions/v1/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key },
    body: JSON.stringify({ username: id, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.session) throw new Error(body.error ?? "That username and password did not match an account.");
  const { error } = await supabase.auth.setSession(body.session);
  if (error) throw error;
}

/** Google, if it is switched on for this project. Nothing here holds a secret; Supabase does. */
export async function signInWith(provider: "google" | "github") {
  if (!supabase) throw new Error("Cloud not configured");
  const { error } = await supabase.auth.signInWithOAuth({
    provider, options: { redirectTo: `${location.origin}${import.meta.env.BASE_URL}workspace` },
  });
  if (error) throw error;
}
/**
 * Attaching Google to an account that already exists, which is a different operation from signing in
 * with it and cannot be done by signing in with it.
 *
 * Supabase links two identities automatically only when the addresses match and both are verified.
 * Someone who signed up as `sam@work.com` with a password and holds `sam@gmail.com` gets a second,
 * separate account instead, and their library does not follow. This is the deliberate way across.
 *
 * The redirect comes back to the account page rather than the workspace: this journey started with
 * someone looking at their sign-in methods, so that is where the answer belongs.
 *
 * Requires "Allow manual linking" in Supabase, Authentication, Providers. Without it the call fails
 * with a 422 that says nothing useful to the person reading it, hence the rewrite below.
 */
export async function linkGoogle() {
  if (!supabase) throw new Error("Cloud not configured");
  const { data, error } = await supabase.auth.linkIdentity({
    provider: "google",
    options: {
      redirectTo: `${location.origin}${import.meta.env.BASE_URL}account`,
      skipBrowserRedirect: true,
    },
  });
  if (error) {
    if (/manual linking|linking identities/i.test(error.message)) throw new Error("Google account linking is disabled for this project.");
    if (/provider.*(not enabled|unsupported)|google.*(not enabled|disabled)/i.test(error.message)) throw new Error("Google sign-in is disabled for this project.");
    if (/redirect|allow.?list|not allowed/i.test(error.message)) throw new Error("This account page is not an approved Google redirect URL.");
    if (/already linked|identity.*exists/i.test(error.message)) throw new Error("That Google account is already connected to another CueFlow account.");
    throw new Error(error.message);
  }
  if (!data?.url) throw new Error("Google did not return an authorization URL. Try again.");
  window.location.assign(data.url);
}

export type Identity = { id: string; provider: string; email?: string };

export async function listIdentities(): Promise<Identity[]> {
  if (!supabase) return [];
  const { data } = await supabase.auth.getUserIdentities();
  return (data?.identities ?? []).map(i => ({ id: i.identity_id ?? i.id, provider: i.provider, email: i.identity_data?.email as string | undefined }));
}

/**
 * Unlinking the only way into an account locks its owner out permanently, so the guard is here as
 * well as in the button that calls it. Supabase refuses this too, and it should stay refused twice.
 */
export async function unlinkIdentity(id: string) {
  if (!supabase) throw new Error("Cloud not configured");
  const { data } = await supabase.auth.getUserIdentities();
  const all = data?.identities ?? [];
  if (all.length < 2) throw new Error("This is the only way into your account, so it cannot be removed.");
  const target = all.find(i => (i.identity_id ?? i.id) === id);
  if (!target) throw new Error("That sign-in method is already gone.");
  const { error } = await supabase.auth.unlinkIdentity(target);
  if (error) throw error;
}

export async function signOut() { await supabase?.auth.signOut(); }
export function onAuth(cb: (email: string | null) => void) { if (!supabase) { cb(null); return () => {}; } supabase.auth.getUser().then(({ data }) => cb(data.user?.email ?? null)); const { data } = supabase.auth.onAuthStateChange((_e, session) => cb(session?.user?.email ?? null)); return () => data.subscription.unsubscribe(); }
export const local = { get<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(`cueflow:${key}`) || "") as T; } catch { return fallback; } }, set(key: string, value: unknown) { localStorage.setItem(`cueflow:${key}`, JSON.stringify(value)); } };
// Session-free upload: anon key writes to the public/ prefix (RLS policy allows it), bucket is public-read.
export async function uploadTrack(file: File) { if (!supabase) return URL.createObjectURL(file); const path = `public/${crypto.randomUUID()}-${file.name}`; const { error } = await supabase.storage.from("audio").upload(path, file, { contentType: file.type || "audio/mpeg", upsert: false }); if (error) throw error; return supabase.storage.from("audio").getPublicUrl(path).data.publicUrl; }
const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

// Tombstones. Deleting locally is not enough: every re-hydrate would pull the row back from the
// cloud. The remote delete below handles the signed-in case; this covers the rest (signed out,
// offline, request failed) so a deleted sound never returns.
const tombstones = () => new Set(local.get<string[]>("deleted", []));
export const isDeleted = (id: string) => tombstones().has(id);
function tombstone(id: string) { const t = tombstones(); t.add(id); local.set("deleted", [...t].slice(-500)); }

/** Storage path out of a public object URL: …/object/public/audio/public/<file> -> public/<file> */
const storagePath = (publicUrl: string) => publicUrl.split("/object/public/audio/")[1] ?? null;
/** The same path as the storage API itself names it: decoded, and without any download query. */
const objectPath = (publicUrl: string) => {
  const path = storagePath(publicUrl);
  return path ? decodeURIComponent(path.split("?")[0]) : null;
};

export type DeleteResult = { ok: boolean; reason?: string };

/**
 * supabase-js resolves with an `{ error }` rather than throwing, so a call whose error is never read
 * is a no-op that reads exactly like a success. Both helpers below are called fire-and-forget, so
 * the only place a refused delete can be reported from is here: without it the row stays in the
 * cloud, the audio stays playable by its public URL, and the only thing hiding either is a local
 * tombstone list that is capped and eventually evicts.
 */
function deleteFailed(what: string, failures: string[]): DeleteResult {
  if (!failures.length) return { ok: true };
  toast(`${what} is still in your account`, `${failures[0]} It is hidden on this device; removing it again once the connection is back will finish the job.`, "warn");
  return { ok: false, reason: failures[0] };
}

export async function deleteTrackEverywhere(id: string, url: string): Promise<DeleteResult> {
  tombstone(id);
  if (!supabase || !isUuid(id)) return { ok: true };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: true };
  const failures: string[] = [];
  const { error: cues } = await supabase.from("sequence_items").delete().eq("track_id", id);
  if (cues) failures.push(cues.message);
  const { error: row } = await supabase.from("tracks").delete().eq("id", id).eq("user_id", user.id);
  if (row) failures.push(row.message);
  // The audio itself lives in a public bucket, leaving it behind would keep it playable by URL.
  const path = objectPath(url);
  if (path) {
    const { error: blob } = await supabase.storage.from("audio").remove([path]);
    if (blob) failures.push(blob.message);
  }
  return deleteFailed("That sound", failures);
}

export async function deleteSequenceEverywhere(id: string): Promise<DeleteResult> {
  tombstone(id);
  if (!supabase || !isUuid(id)) return { ok: true };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: true };
  const failures: string[] = [];
  const { error: cues } = await supabase.from("sequence_items").delete().eq("sequence_id", id);
  if (cues) failures.push(cues.message);
  const { error: row } = await supabase.from("sequences").delete().eq("id", id).eq("user_id", user.id);
  if (row) failures.push(row.message);
  return deleteFailed("That sequence", failures);
}
/**
 * What the last save actually did. Every call used to discard its error, so a rejected write looked
 * exactly like a successful one: the reason no cue ever reached the cloud (sequence_items.track_id
 * is a foreign key, so one cue pointing at a local-only sound failed the whole batch, silently).
 */
export type SyncState = { cloud: boolean; ok: boolean; reason?: string; skipped?: number };

/**
 * Saves run one at a time. Every keystroke used to fire its own, and two overlapping runs would
 * interleave -- one deleted a sequence's cues while the other was still inserting them, and the
 * second insert then collided with the first on the primary key. That is the "duplicate key value
 * violates unique constraint" every action was producing. A save asked for while one is in flight
 * waits, and a third replaces the second: only the newest state is worth writing.
 */
let inFlight: Promise<SyncState> = Promise.resolve({ cloud: false, ok: true });
let queued: (() => Promise<SyncState>) | null = null;
let lastWriteSignature = "";
const writeSignature = (tracks: Track[], sequences: Sequence[], projectId: string | null) => JSON.stringify({
  projectId,
  tracks: tracks.map(track => [track.id, track.title, track.url, track.kind, track.effects, track.visual]),
  sequences: sequences.map(sequence => [sequence.id, sequence.name, sequence.items]),
});
export function persist(tracks: Track[], sequences: Sequence[], projectId: string | null = null): Promise<SyncState> {
  const signature = writeSignature(tracks, sequences, projectId);
  if (signature === lastWriteSignature && !queued) return Promise.resolve({ cloud: !!supabase, ok: true });
  // Only a write that actually reached the cloud counts as written. A signed-out save also returns
  // `ok`, and remembering its signature meant the first save after signing in matched it, returned
  // without writing and rendered "saved" -- so nothing left the device until the next edit.
  const job = () => write(tracks, sequences, projectId).then(result => { if (result.ok && result.cloud) lastWriteSignature = signature; return result; });
  queued = job;
  const run = inFlight.then(async () => {
    if (queued !== job) return { cloud: true, ok: true } as SyncState; // a newer save superseded this one
    queued = null;
    return job();
  });
  inFlight = run.catch(() => ({ cloud: false, ok: true }));
  return run;
}

async function write(tracks: Track[], sequences: Sequence[], projectId: string | null): Promise<SyncState> {
  local.set(projectId ? `tracks:${projectId}` : "tracks", tracks);
  local.set(projectId ? `sequences:${projectId}` : "sequences", sequences);
  if (!supabase) return { cloud: false, ok: true, reason: "Cloud is not configured for this build." };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { cloud: false, ok: true, reason: "Sign in to save to your account." };

  const cloudTracks = tracks.filter(track => isUuid(track.id));
  const { error: trackError } = await supabase.from("tracks").upsert(cloudTracks.map(track => ({
    id: track.id, user_id: user.id, title: track.title, source_url: track.url,
    // Nothing wrote `storage_path`, so the retention sweep could not tell a member's upload from an
    // ownerless guest one and put every file under `public/` on the 30-day guest clock.
    storage_path: track.storagePath ?? objectPath(track.url),
    effects: track.effects, kind: track.kind ?? "audio", visual: track.visual ? { ...track.visual, ...(track.slides ? { deckSlides: track.slides } : {}) } : null,
    project_id: projectId,
  })));
  if (trackError) return { cloud: true, ok: false, reason: trackError.message };

  const cloudSequences = sequences.filter(sequence => isUuid(sequence.id));
  const { error: seqError } = await supabase.from("sequences").upsert(
    cloudSequences.map(sequence => ({ id: sequence.id, user_id: user.id, name: sequence.name, project_id: projectId })),
  );
  if (seqError) return { cloud: true, ok: false, reason: seqError.message };

  // A cue can only be stored once its sound is, so drop the ones whose track never made it rather
  // than losing the whole sequence to a foreign-key error.
  const saved = new Set(cloudTracks.map(track => track.id));
  // Two different things were both counted as "skipped" and both reported as saved. A cue whose
  // sound is demo material or some other non-UUID id was never cloud material and is nobody's
  // problem; a cue dropped because its id was already taken, or because the sound it points at is
  // not in the library, is work that silently did not leave the device and has to be said out loud.
  let skipped = 0;
  let lost = 0;
  // Upsert, then remove what is no longer there. Deleting first left a window in which the rows were
  // gone, and anything that read or wrote during it saw a sequence with no cues.
  const seen = new Set<string>();
  for (const sequence of cloudSequences) {
    const items = sequence.items.filter(item => {
      // The same cue id landing in two sequences -- which a bad merge can produce -- is a primary
      // key collision waiting to happen. Keep the first one and drop the copy.
      if (seen.has(item.id)) { lost += 1; return false; }
      if (!saved.has(item.trackId)) { if (isUuid(item.trackId)) lost += 1; else skipped += 1; return false; }
      seen.add(item.id);
      return true;
    });
    if (items.length) {
      const { error } = await supabase.from("sequence_items").upsert(items.map((item, position) => ({
        id: item.id, sequence_id: sequence.id, track_id: item.trackId, position,
        label: item.label, effects: item.effects, visual: item.visual || item.slideIndex !== undefined ? { ...(item.visual ?? {}), ...(item.slideIndex !== undefined ? { deckSlideIndex: item.slideIndex } : {}) } : null,
        // Only keep a link whose partner survived the track filter above, or it points at nothing.
        link: item.link && items.some(other => other.id === item.link) ? item.link : null,
      })), { onConflict: "id" });
      if (error) return { cloud: true, ok: false, reason: error.message };
    }
    const stale = supabase.from("sequence_items").delete().eq("sequence_id", sequence.id);
    const { error: gone } = items.length ? await stale.not("id", "in", `(${items.map(i => i.id).join(",")})`) : await stale;
    if (gone) return { cloud: true, ok: false, reason: gone.message };
  }
  if (lost) return {
    cloud: true, ok: false, skipped: skipped + lost,
    reason: `${lost} ${lost === 1 ? "cue is" : "cues are"} not in your account: the sound behind ${lost === 1 ? "it is" : "them are"} no longer in this library.`,
  };
  return { cloud: true, ok: true, skipped };
}
/**
 * What the cloud last told us each row looked like.
 *
 * This is the third leg of the merge, and the reason it can tell an edit from an absence. With only
 * two copies -- mine and theirs -- a row that differs is ambiguous: did I change it, did they, or
 * did they delete something I still have? With a baseline, each of those is a different answer.
 *
 * Kept per device in localStorage, because it describes this device's last sync, not a shared fact.
 */
const BASELINE = "syncBase";
type Baseline = Record<string, string>;
const baseline = () => local.get<Baseline>(BASELINE, {});
const saveBaseline = (next: Baseline) => local.set(BASELINE, next);
/** Which deck a cue sat in, and what order a sequence's cues came back in, at the last sync. */
const deckKey = (id: string) => `deck:${id}`;
const orderKey = (id: string) => `order:${id}`;

/** Row identity for comparison: everything the user can change, and nothing the server sets. */
export const rowShape = (row: unknown) => {
  const copy = { ...(row as Record<string, unknown>) };
  delete copy.updatedAt;
  delete copy.pending;
  delete copy.error;
  // A sequence's cues are merged item by item, so the sequence's own shape is its own fields.
  delete copy.items;
  return JSON.stringify(copy, Object.keys(copy).sort());
};
const shapeOf = rowShape;

/**
 * Which copy of a row to keep.
 *
 * The branch that matters needs no clock: if this device has not touched the row since the last
 * sync, the other device's copy is simply newer.
 *
 * When both sides changed there is no honest tie-break to reach for, so the copy in front of the
 * operator stands. `updatedAt` is written by the database trigger and refreshed only by a pull, so
 * the local value is the time the *server* last wrote the row and never the time anybody typed:
 * comparing it against a server-set remote one made the other device win by construction, and an
 * unsaved edit vanished off the screen with nothing said. Losing the visible copy is the worse of
 * the two failures, and the one the operator cannot see coming.
 */
export function pick<T>(here: T, remote: T, base?: string): "here" | "remote" {
  const mine = shapeOf(here);
  if (mine === shapeOf(remote)) return "here";
  return base !== undefined && base === mine ? "remote" : "here";
}

/**
 * Folds a cloud copy into what this device already has.
 *
 * This used only to add. An existing track was skipped outright, so a remote rename, a new URL or a
 * changed effect was thrown away; an existing sequence got the union of its cues, so a reorder was
 * lost and a deletion came straight back. Worse, the stale device then saved its own arrays over the
 * top, so the second device did not merely fail to see the first device's work, it destroyed it.
 *
 * Now it is a three-way merge against `BASELINE`, so an edit, an absence and a deletion are three
 * different things, and a cue removed on one device stays removed on the other.
 */
export function mergeInto(tracks: Track[], sequences: Sequence[], cloud: { tracks: Track[]; sequences: Sequence[] }) {
  const base = baseline();
  const remoteTracks = new Map(cloud.tracks.map(track => [track.id, track]));
  const remoteSequences = new Map(cloud.sequences.map(sequence => [sequence.id, sequence]));
  const owner = deckOwners(sequences, cloud.sequences, base);

  const mergedTracks: Track[] = [];
  const haveTrack = new Set<string>();
  for (const here of tracks) {
    haveTrack.add(here.id);
    if (isDeleted(here.id)) continue;
    const remote = remoteTracks.get(here.id);
    // In the baseline but gone from the cloud means another device deleted it. Not in the
    // baseline means this device made it and it has not been saved yet.
    if (!remote) { if (base[here.id] === undefined) mergedTracks.push(here); continue; }
    mergedTracks.push(pick(here, remote, base[here.id]) === "remote" ? { ...here, ...remote } : here);
  }
  for (const remote of cloud.tracks) {
    if (isDeleted(remote.id) || haveTrack.has(remote.id)) continue;
    mergedTracks.push(remote);
  }

  const mergedSequences: Sequence[] = [];
  const haveSequence = new Set<string>();
  for (const here of sequences) {
    haveSequence.add(here.id);
    if (isDeleted(here.id)) continue;
    const remote = remoteSequences.get(here.id);
    if (!remote) {
      if (base[here.id] !== undefined) continue;
      mergedSequences.push({ ...here, items: mergeItems(here.id, here.items, [], base, owner) });
      continue;
    }
    const fields = pick(here, remote, base[here.id]) === "remote" ? { ...here, ...remote } : here;
    mergedSequences.push({ ...fields, items: mergeItems(here.id, here.items, remote.items, base, owner) });
  }
  for (const remote of cloud.sequences) {
    if (isDeleted(remote.id) || haveSequence.has(remote.id)) continue;
    mergedSequences.push({ ...remote, items: mergeItems(remote.id, [], remote.items, base, owner) });
  }

  saveBaseline(confirmed(base, tracks, sequences, cloud));
  return { tracks: mergedTracks, sequences: mergedSequences };
}

/**
 * Which deck each cue belongs in, decided once for the whole merge.
 *
 * A cue dragged from one sequence to another arrives in both copies, and a sequence looked at on its
 * own cannot tell that move from a duplicate: it saw a cue it did not have and took it, so a move
 * made here came back undone with the cue in both decks. Comparing both decks against the deck the
 * cloud last reported answers it properly, and it also answers the question a per-sequence merge
 * cannot: the side that moved the cue is the side that owns it.
 */
function deckOwners(here: Sequence[], remote: Sequence[], base: Baseline) {
  const hereDecks = new Map<string, string>();
  const cloudDecks = new Map<string, string>();
  for (const sequence of here) for (const item of sequence.items) hereDecks.set(item.id, sequence.id);
  for (const sequence of remote) for (const item of sequence.items) cloudDecks.set(item.id, sequence.id);

  const owner = new Map<string, string>();
  for (const id of new Set([...hereDecks.keys(), ...cloudDecks.keys()])) {
    const hereDeck = hereDecks.get(id);
    const cloudDeck = cloudDecks.get(id);
    const was = base[deckKey(id)];
    // Gone from one side. If the side that still has it has not moved it either, the other side
    // deleted it and the delete stands. A move is an edit, not an absence, so it survives.
    if (hereDeck === undefined) { if (cloudDeck !== undefined && was !== cloudDeck) owner.set(id, cloudDeck); continue; }
    if (cloudDeck === undefined) { if (was !== hereDeck) owner.set(id, hereDeck); continue; }
    // In both, and in different decks: whoever moved it away from the deck the cloud last reported
    // owns it, and when that is nobody or both, the deck in front of the operator wins.
    owner.set(id, was === hereDeck && cloudDeck !== hereDeck ? cloudDeck : hereDeck);
  }
  return owner;
}

/**
 * The cues of one sequence, from both sides.
 *
 * Which cues belong here is already settled; what is left is their content and their order. Order is
 * three-way like everything else: the cloud's order is taken only when this device has not moved
 * anything since the last sync, so an unsaved rearrangement is not reverted on the next ping. It
 * used to be taken unconditionally, on the grounds that `position` is what the database stores.
 */
function mergeItems(sequenceId: string, here: SequenceItem[], remote: SequenceItem[], base: Baseline, owner: Map<string, string>) {
  const belongs = (id: string) => owner.get(id) === sequenceId && !isDeleted(id);
  const mine = new Map(here.filter(item => belongs(item.id)).map(item => [item.id, item]));
  const theirs = new Map(remote.filter(item => belongs(item.id)).map(item => [item.id, item]));
  const hereOrder = [...mine.keys()];
  const cloudOrder = [...theirs.keys()];

  // Compared over the cues that are still in this deck, so one cue added or deleted elsewhere does
  // not read as though the whole thing had been rearranged.
  const live = new Set([...hereOrder, ...cloudOrder]);
  const stored = base[orderKey(sequenceId)];
  const was = stored === undefined ? null : stored.split(",").filter(id => live.has(id)).join(",");
  const takeCloud = was !== null && hereOrder.join(",") === was && cloudOrder.join(",") !== was;

  const out: SequenceItem[] = [];
  const added = new Set<string>();
  const push = (id: string) => {
    if (added.has(id)) return;
    const ours = mine.get(id);
    const other = theirs.get(id);
    const row = ours && other ? (pick(ours, other, base[id]) === "remote" ? { ...ours, ...other } : ours) : ours ?? other;
    if (!row) return;
    added.add(id);
    out.push(row);
  };
  for (const id of takeCloud ? cloudOrder : hereOrder) push(id);
  for (const id of takeCloud ? hereOrder : cloudOrder) push(id);
  return out;
}

/**
 * The baseline this merge earns: exactly what the cloud just said about every row it mentioned, and
 * nothing at all for a row it did not have.
 *
 * It used to record the merge winner, which meant a row whose write had not landed -- an unsaved
 * edit, a failed save, a cue the write deliberately skipped -- was written down as confirmed by a
 * cloud that had never seen it. The next merge then read "in the baseline, absent from the cloud" as
 * deleted on another device and dropped it, and the save after that removed it from the cloud too.
 * Two merge cycles is nothing: a realtime ping, a remount, a manual sync, a double-invoked effect.
 *
 * Rows this merge never looked at are left where they are rather than wiped. The baseline is one map
 * for every project, and replacing it wholesale erased the entries for the project just left, so
 * going back made every row there look brand new and re-uploaded ones another device had deleted.
 */
function confirmed(base: Baseline, tracks: Track[], sequences: Sequence[], cloud: { tracks: Track[]; sequences: Sequence[] }) {
  const next: Baseline = { ...base };
  const forget = (id: string) => { delete next[id]; delete next[deckKey(id)]; };

  const cloudTracks = new Set(cloud.tracks.map(track => track.id));
  for (const track of cloud.tracks) next[track.id] = shapeOf(track);
  for (const track of tracks) if (!cloudTracks.has(track.id)) forget(track.id);

  const cloudSequences = new Set(cloud.sequences.map(sequence => sequence.id));
  const cloudItems = new Set<string>();
  for (const sequence of cloud.sequences) {
    next[sequence.id] = shapeOf(sequence);
    next[orderKey(sequence.id)] = sequence.items.map(item => item.id).join(",");
    for (const item of sequence.items) {
      cloudItems.add(item.id);
      next[item.id] = shapeOf(item);
      next[deckKey(item.id)] = sequence.id;
    }
  }
  for (const sequence of sequences) {
    if (!cloudSequences.has(sequence.id)) { forget(sequence.id); delete next[orderKey(sequence.id)]; }
    for (const item of sequence.items) if (!cloudItems.has(item.id)) forget(item.id);
  }
  return next;
}

/**
 * Tells this device when another one changes the library, so it does not have to be reloaded.
 *
 * There was no table subscription anywhere in the app: the only `.channel(` call was the show
 * broadcast, and everything else pulled once on mount. Two people in one project could work for an
 * hour without either seeing the other, which is most of what "the database is not syncing" meant.
 *
 * Coalesced, because one drag of a cue produces a burst of row changes and re-merging per row would
 * be both wasteful and visibly jumpy.
 */
export function watchCloud(projectId: string | null, onChange: () => void, wait = 400, onLive?: (live: boolean) => void) {
  const client = supabase;
  if (!client) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let channel: ReturnType<typeof client.channel> | null = null;
  let attempt = 0;
  let stopped = false;
  const ping = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, wait);
  };
  // The topic includes the project so switching projects cannot leave a channel listening for the
  // one you left. Realtime rejects a second channel on the same topic in a tab, so this must differ
  // from the `show:<id>` topic the running show uses.
  const topic = `cueflow:data:${projectId ?? "personal"}`;
  const open = () => {
    const live = client.channel(topic);
    channel = live;
    for (const table of ["tracks", "sequences", "sequence_items"]) {
      live.on("postgres_changes", { event: "*", schema: "public", table }, ping);
    }
    // The status was thrown away, so a subscription that never came up -- realtime switched off, an
    // expired token, a timeout -- left the app silently back where it started, two people in one
    // project neither of them seeing the other. Say so, and keep trying.
    live.subscribe(status => {
      if (status === "SUBSCRIBED") { attempt = 0; onLive?.(true); return; }
      if (status !== "CHANNEL_ERROR" && status !== "TIMED_OUT") return;
      console.warn(`cueflow: realtime ${status} on ${topic}`);
      onLive?.(false);
      if (stopped) return;
      void client.removeChannel(live);
      channel = null;
      retry = setTimeout(open, Math.min(30_000, 1_000 * 2 ** attempt++));
    });
  };
  open();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (retry) clearTimeout(retry);
    if (channel) void client.removeChannel(channel);
  };
}

/** Wipes what this device believes the cloud holds. Used when switching account or project. */
export const forgetBaseline = () => saveBaseline({});

/**
 * Whether the database has the sync timestamps yet.
 *
 * They arrive with migration 0002, which is applied by hand against a live database with real shows
 * in it, so this build has to work either side of that. Asked once per session: without the column
 * the merge falls back to comparing content alone, which is still far better than the add-only merge
 * it replaced, and gains the tie-break the moment the migration lands.
 */
type Stamped = { updated_at?: string | null };
type TrackRow = Stamped & { id: string; title: string; source_url: string; effects: Track["effects"]; kind?: Track["kind"]; visual?: (NonNullable<Track["visual"]> & { deckSlides?: Track["slides"] }) | null; created_at: string };
type SequenceRow = Stamped & { id: string; name: string; created_at: string };
type ItemRow = Stamped & { id: string; sequence_id: string; track_id: string; label: string; effects: SequenceItem["effects"]; visual?: (NonNullable<SequenceItem["visual"]> & { deckSlideIndex?: number }) | null; link?: string | null; position: number };

let updatedAtProbe: Promise<boolean> | null = null;
/** Postgres says 42703 when a column is not there. Anything else is a failed request, not an answer. */
const columnMissing = (error: { code?: string } | null) => error?.code === "42703";
/**
 * Only a "yes" is remembered. Treating every error as "the column is missing" and caching it for the
 * tab meant one offline blip on the probe turned the merge timestamp-blind for the rest of the
 * session, and a "no" cached the same way meant applying the migration changed nothing until reload.
 * An inconclusive probe throws, so a caller can decline to merge rather than merge against a guess.
 */
export function hasUpdatedAt(): Promise<boolean> {
  return (updatedAtProbe ??= (async () => {
    if (!supabase) return false;
    const { error } = await supabase.from("tracks").select("updated_at").limit(1);
    if (!error) return true;
    if (columnMissing(error)) return false;
    throw new Error(error.message);
  })().then(
    yes => { if (!yes) updatedAtProbe = null; return yes; },
    error => { updatedAtProbe = null; throw error; },
  ));
}

export type CloudCopy = { tracks: Track[]; sequences: Sequence[] };

/**
 * What the cloud holds, or why it could not be read.
 *
 * `null` is "there is nothing to pull": no cloud in this build, or nobody signed in. `false` is "the
 * pull failed", which is a different thing entirely and used to be reported as the same `null`.
 *
 * The distinction is not cosmetic. Every query's error went unread and a missing sub-query result
 * was coerced to an empty array, so one transient PostgREST failure arrived as a sequence with no
 * cues: the merge read that as every cue having been deleted on another device, dropped them, and
 * the next save deleted them from the cloud as well, all of it reported as a successful sync. A pull
 * that cannot be trusted must stop the merge, not feed it.
 */
// A project scopes every read: its own library, its own sequences. No project means the
// personal one, which is every row that was here before projects existed.
export async function hydrateCloud(projectId: string | null = null): Promise<CloudCopy | null | false> { if (!supabase) return null; const { data: { user } } = await supabase.auth.getUser(); if (!user) return null;
  // Row-level security already limits this to rows you own or projects you belong to, so the only
  // question left is which of the two: a project's shared library, or the personal one. Filtering
  // by user_id as well would hide a collaborator's work, which is the whole point of a project.
  const where = projectId ? `eq.${projectId}` : "is.null";
  // Two spellings of each select rather than one built by hand: postgrest-js reads the column list
  // as a literal type, and a string it cannot see at compile time gives back no row type at all.
  let stamped: boolean;
  try { stamped = await hasUpdatedAt(); } catch { return false; }
  const [trackResult, sequenceResult] = await Promise.all([
    stamped
      ? supabase.from("tracks").select("id,title,source_url,effects,kind,visual,created_at,updated_at").or(`project_id.${where}`)
      : supabase.from("tracks").select("id,title,source_url,effects,kind,visual,created_at").or(`project_id.${where}`),
    stamped
      ? supabase.from("sequences").select("id,name,created_at,updated_at").or(`project_id.${where}`)
      : supabase.from("sequences").select("id,name,created_at").or(`project_id.${where}`),
  ]);
  if (trackResult.error || sequenceResult.error) return false;
  const tracks = trackResult.data as (TrackRow[] | null);
  const sequences = sequenceResult.data as (SequenceRow[] | null);
  if (!tracks || !sequences) return false;
  const ids = sequences.map(sequence => sequence.id);
  const itemColumns = "id,sequence_id,track_id,label,effects,visual,link,position";
  const itemQuery = ids.length
    ? (stamped
      ? await supabase.from("sequence_items").select(`${itemColumns},updated_at`).in("sequence_id", ids).order("position")
      : await supabase.from("sequence_items").select(itemColumns).in("sequence_id", ids).order("position"))
    : { data: [] as unknown[], error: null };
  // A failed cue query used to become `(items ?? [])`, one line of coercion that emptied every
  // sequence in the show and then wrote the emptying back to the cloud.
  if (itemQuery.error || !itemQuery.data) return false;
  const items = itemQuery.data as ItemRow[];
  return { tracks: tracks.map(row => ({ id: row.id, title: row.title, url: row.source_url, effects: row.effects, kind: row.kind ?? "audio", visual: row.visual ?? undefined, slides: row.visual?.deckSlides ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at ?? undefined } as Track)), sequences: sequences.map(sequence => ({ id: sequence.id, name: sequence.name, createdAt: sequence.created_at, updatedAt: sequence.updated_at ?? undefined, items: items.filter(item => item.sequence_id === sequence.id).map(item => ({ id: item.id, trackId: item.track_id, label: item.label, effects: item.effects, visual: item.visual ?? undefined, slideIndex: item.visual?.deckSlideIndex ?? undefined, link: item.link ?? undefined, updatedAt: item.updated_at ?? undefined } as SequenceItem)) } as Sequence)) };
}
