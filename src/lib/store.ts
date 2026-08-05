import { createClient } from "@supabase/supabase-js";
import type { Sequence, SequenceItem, Track } from "../types";
const url = import.meta.env.VITE_SUPABASE_URL, key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key) : null;

// Auth: email + password. Cloud save/hydrate already gate on getUser(), so signing in activates them.
export async function signUp(email: string, password: string) { if (!supabase) throw new Error("Cloud not configured"); const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}${import.meta.env.BASE_URL}studio` } }); if (error) throw error; }
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
export function persist(tracks: Track[], sequences: Sequence[], projectId: string | null = null): Promise<SyncState> {
  const job = () => write(tracks, sequences, projectId);
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
    effects: track.effects, kind: track.kind ?? "audio", visual: track.visual ?? null,
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
        label: item.label, effects: item.effects, visual: item.visual ?? null,
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
 * Folds a cloud copy into what this device already has. Sequences that exist on both sides get the
 * union of their cues rather than being skipped, which is what made work done on a second device
 * look like it never arrived.
 */
export function mergeInto(tracks: Track[], sequences: Sequence[], cloud: { tracks: Track[]; sequences: Sequence[] }) {
  const merged = { tracks: [...tracks], sequences: [...sequences] };
  // One cue id can only live in one deck. Held across the whole merge, not per sequence: a cue that
  // moved decks on another device arrives in both copies, and saving both is a key collision.
  const held = new Set(merged.sequences.flatMap(s => s.items.map(item => item.id)));
  for (const track of cloud.tracks) {
    if (isDeleted(track.id) || merged.tracks.some(t => t.id === track.id)) continue;
    merged.tracks.push(track);
  }
  for (const remote of cloud.sequences) {
    if (isDeleted(remote.id)) continue;
    const fresh = remote.items.filter(item => !held.has(item.id) && !isDeleted(item.id));
    fresh.forEach(item => held.add(item.id));
    const at = merged.sequences.findIndex(s => s.id === remote.id);
    if (at < 0) { merged.sequences.push({ ...remote, items: fresh }); continue; }
    const here = merged.sequences[at];
    if (fresh.length) merged.sequences[at] = { ...here, items: [...here.items, ...fresh] };
  }
  return merged;
}

// A project scopes every read: its own library, its own running orders. No project means the
// personal one, which is every row that was here before projects existed.
export async function hydrateCloud(projectId: string | null = null) { if (!supabase) return null; const { data: { user } } = await supabase.auth.getUser(); if (!user) return null;
  // Row-level security already limits this to rows you own or projects you belong to, so the only
  // question left is which of the two: a project's shared library, or the personal one. Filtering
  // by user_id as well would hide a collaborator's work, which is the whole point of a project.
  const where = projectId ? `eq.${projectId}` : "is.null";
  const { data: tracks } = await supabase.from("tracks").select("id,title,source_url,effects,kind,visual,created_at").or(`project_id.${where}`); const { data: sequences } = await supabase.from("sequences").select("id,name,created_at").or(`project_id.${where}`); if (!tracks || !sequences) return null; const ids = sequences.map(sequence => sequence.id); const { data: items } = ids.length ? await supabase.from("sequence_items").select("id,sequence_id,track_id,label,effects,visual,link,position").in("sequence_id", ids).order("position") : { data: [] }; return { tracks: tracks.map(row => ({ id: row.id, title: row.title, url: row.source_url, effects: row.effects, kind: row.kind ?? "audio", visual: row.visual ?? undefined, createdAt: row.created_at } as Track)), sequences: sequences.map(sequence => ({ id: sequence.id, name: sequence.name, createdAt: sequence.created_at, items: (items ?? []).filter(item => item.sequence_id === sequence.id).map(item => ({ id: item.id, trackId: item.track_id, label: item.label, effects: item.effects, visual: item.visual ?? undefined, link: item.link ?? undefined } as SequenceItem)) } as Sequence)) };
}
