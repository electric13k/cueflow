import { createClient } from "@supabase/supabase-js";
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

export async function deleteTrackEverywhere(id: string, url: string) {
  tombstone(id);
  if (!supabase || !isUuid(id)) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("sequence_items").delete().eq("track_id", id);
  await supabase.from("tracks").delete().eq("id", id).eq("user_id", user.id);
  // The audio itself lives in a public bucket, leaving it behind would keep it playable by URL.
  const path = storagePath(url);
  if (path) await supabase.storage.from("audio").remove([decodeURIComponent(path)]);
}

export async function deleteSequenceEverywhere(id: string) {
  tombstone(id);
  if (!supabase || !isUuid(id)) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("sequence_items").delete().eq("sequence_id", id);
  await supabase.from("sequences").delete().eq("id", id).eq("user_id", user.id);
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
  const job = () => write(tracks, sequences, projectId).then(result => { if (result.ok) lastWriteSignature = signature; return result; });
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
  let skipped = 0;
  // Upsert, then remove what is no longer there. Deleting first left a window in which the rows were
  // gone, and anything that read or wrote during it saw a sequence with no cues.
  const seen = new Set<string>();
  for (const sequence of cloudSequences) {
    const items = sequence.items.filter(item => {
      // The same cue id landing in two sequences -- which a bad merge can produce -- is a primary
      // key collision waiting to happen. Keep the first one and drop the copy.
      if (!saved.has(item.trackId) || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
    skipped += sequence.items.length - items.length;
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

const when = (value?: string) => (value ? Date.parse(value) || 0 : 0);

/**
 * Which copy of a row to keep.
 *
 * The first two branches are the ones that matter and neither needs a clock: if this device has not
 * touched the row since the last sync, the other device's copy is simply newer, and vice versa. Only
 * when both changed is there a real conflict, and then the newer `updatedAt` wins with a tie going
 * to what is already on screen -- taking someone's work away in front of them is the worse failure.
 */
export function pick<T extends { updatedAt?: string }>(here: T, remote: T, base?: string): "here" | "remote" {
  const mine = shapeOf(here);
  const theirs = shapeOf(remote);
  if (mine === theirs) return "here";
  if (base !== undefined && base === mine) return "remote";
  if (base !== undefined && base === theirs) return "here";
  return when(remote.updatedAt) > when(here.updatedAt) ? "remote" : "here";
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
  const next: Baseline = {};
  const keep = (id: string, row: unknown) => { next[id] = shapeOf(row); };

  const mergedTracks: Track[] = [];
  const remoteTracks = new Map(cloud.tracks.map(track => [track.id, track]));
  for (const here of tracks) {
    if (isDeleted(here.id)) continue;
    const remote = remoteTracks.get(here.id);
    if (!remote) {
      // In the baseline but gone from the cloud means another device deleted it. Not in the
      // baseline means this device made it and it has not been saved yet.
      if (base[here.id] !== undefined) continue;
      mergedTracks.push(here);
      keep(here.id, here);
      continue;
    }
    remoteTracks.delete(here.id);
    const winner = pick(here, remote, base[here.id]) === "remote" ? { ...here, ...remote } : here;
    mergedTracks.push(winner);
    keep(here.id, winner);
  }
  for (const remote of remoteTracks.values()) {
    if (isDeleted(remote.id)) continue;
    mergedTracks.push(remote);
    keep(remote.id, remote);
  }

  const mergedSequences: Sequence[] = [];
  const remoteSequences = new Map(cloud.sequences.map(sequence => [sequence.id, sequence]));
  for (const here of sequences) {
    if (isDeleted(here.id)) continue;
    const remote = remoteSequences.get(here.id);
    if (!remote) {
      if (base[here.id] !== undefined) continue;
      mergedSequences.push(here);
      keep(here.id, here);
      here.items.forEach(item => keep(item.id, item));
      continue;
    }
    remoteSequences.delete(here.id);
    const fields = pick(here, remote, base[here.id]) === "remote" ? { ...here, ...remote } : here;
    const items = mergeItems(here.items, remote.items, base, keep);
    const merged = { ...fields, items };
    mergedSequences.push(merged);
    keep(merged.id, merged);
  }
  for (const remote of remoteSequences.values()) {
    if (isDeleted(remote.id)) continue;
    const items = remote.items.filter(item => !isDeleted(item.id));
    mergedSequences.push({ ...remote, items });
    keep(remote.id, remote);
    items.forEach(item => keep(item.id, item));
  }

  // One cue id can only live in one deck. Held across the whole merge, not per sequence: a cue that
  // moved decks on another device arrives in both copies, and saving both is a key collision.
  const held = new Set<string>();
  for (const sequence of mergedSequences) {
    sequence.items = sequence.items.filter(item => !held.has(item.id) && (held.add(item.id), true));
  }

  saveBaseline(next);
  return { tracks: mergedTracks, sequences: mergedSequences };
}

/**
 * The cues of one sequence, from both sides.
 *
 * Order comes from the remote copy for anything both sides know about, because `position` is what
 * the database stores and what every other device will agree on. A cue this device added and has not
 * saved yet has no agreed position, so it is appended rather than dropped.
 */
function mergeItems(here: SequenceItem[], remote: SequenceItem[], base: Baseline, keep: (id: string, row: unknown) => void) {
  const mine = new Map(here.map(item => [item.id, item]));
  const out: SequenceItem[] = [];
  for (const theirs of remote) {
    if (isDeleted(theirs.id)) continue;
    const ours = mine.get(theirs.id);
    mine.delete(theirs.id);
    const winner = !ours ? theirs : (pick(ours, theirs, base[theirs.id]) === "remote" ? { ...ours, ...theirs } : ours);
    out.push(winner);
    keep(winner.id, winner);
  }
  for (const ours of mine.values()) {
    if (isDeleted(ours.id)) continue;
    // Known at the last sync and absent from the cloud now: deleted on another device.
    if (base[ours.id] !== undefined) continue;
    out.push(ours);
    keep(ours.id, ours);
  }
  return out;
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
export function watchCloud(projectId: string | null, onChange: () => void, wait = 400) {
  const client = supabase;
  if (!client) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  const ping = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, wait);
  };
  // The topic includes the project so switching projects cannot leave a channel listening for the
  // one you left. Realtime rejects a second channel on the same topic in a tab, so this must differ
  // from the `show:<id>` topic the running show uses.
  const channel = client.channel(`cueflow:data:${projectId ?? "personal"}`);
  for (const table of ["tracks", "sequences", "sequence_items"]) {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, ping);
  }
  channel.subscribe();
  return () => {
    if (timer) clearTimeout(timer);
    void client.removeChannel(channel);
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
export function hasUpdatedAt(): Promise<boolean> {
  return (updatedAtProbe ??= (async () => {
    if (!supabase) return false;
    const { error } = await supabase.from("tracks").select("updated_at").limit(1);
    return !error;
  })());
}

// A project scopes every read: its own library, its own sequences. No project means the
// personal one, which is every row that was here before projects existed.
export async function hydrateCloud(projectId: string | null = null) { if (!supabase) return null; const { data: { user } } = await supabase.auth.getUser(); if (!user) return null;
  // Row-level security already limits this to rows you own or projects you belong to, so the only
  // question left is which of the two: a project's shared library, or the personal one. Filtering
  // by user_id as well would hide a collaborator's work, which is the whole point of a project.
  const where = projectId ? `eq.${projectId}` : "is.null";
  // Two spellings of each select rather than one built by hand: postgrest-js reads the column list
  // as a literal type, and a string it cannot see at compile time gives back no row type at all.
  const stamped = await hasUpdatedAt();
  const [trackResult, sequenceResult] = await Promise.all([
    stamped
      ? supabase.from("tracks").select("id,title,source_url,effects,kind,visual,created_at,updated_at").or(`project_id.${where}`)
      : supabase.from("tracks").select("id,title,source_url,effects,kind,visual,created_at").or(`project_id.${where}`),
    stamped
      ? supabase.from("sequences").select("id,name,created_at,updated_at").or(`project_id.${where}`)
      : supabase.from("sequences").select("id,name,created_at").or(`project_id.${where}`),
  ]);
  const tracks = trackResult.data as (TrackRow[] | null);
  const sequences = sequenceResult.data as (SequenceRow[] | null);
  if (!tracks || !sequences) return null;
  const ids = sequences.map(sequence => sequence.id);
  const itemColumns = "id,sequence_id,track_id,label,effects,visual,link,position";
  const itemQuery = ids.length
    ? (stamped
      ? await supabase.from("sequence_items").select(`${itemColumns},updated_at`).in("sequence_id", ids).order("position")
      : await supabase.from("sequence_items").select(itemColumns).in("sequence_id", ids).order("position"))
    : { data: [] };
  const items = itemQuery.data as (ItemRow[] | null);
  return { tracks: tracks.map(row => ({ id: row.id, title: row.title, url: row.source_url, effects: row.effects, kind: row.kind ?? "audio", visual: row.visual ?? undefined, slides: row.visual?.deckSlides ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at ?? undefined } as Track)), sequences: sequences.map(sequence => ({ id: sequence.id, name: sequence.name, createdAt: sequence.created_at, updatedAt: sequence.updated_at ?? undefined, items: (items ?? []).filter(item => item.sequence_id === sequence.id).map(item => ({ id: item.id, trackId: item.track_id, label: item.label, effects: item.effects, visual: item.visual ?? undefined, slideIndex: item.visual?.deckSlideIndex ?? undefined, link: item.link ?? undefined, updatedAt: item.updated_at ?? undefined } as SequenceItem)) } as Sequence)) };
}
