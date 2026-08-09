import { local, supabase } from "./store";
import { debounce, serialize } from "./autosync";

/**
 * An editor session is resumable per-item edit state. Opening a sound, a picture, a clip or a deck
 * in an editor starts one; it holds whatever that editor is in the middle of (crop box, trim in and
 * out, the adjustment module stack, the undo history) so that reopening the item lands exactly
 * where you left off, on this device or the next one.
 *
 * The row is owner-scoped by RLS and unique per (user, item, editor), which is the conflict target
 * every save upserts on. Nothing here deletes and re-inserts.
 */
export type EditorKind = "audio" | "image" | "video" | "slides";

/** One step of history. Editors put their own payload in; the id is all this module needs. */
export type UndoEntry = { id: string; label?: string; at?: string };
/** Free-form per editor, except that `undo` is a log and is treated as one when two copies meet. */
export type SessionState = { undo?: UndoEntry[]; [key: string]: unknown };

export type EditorSession = {
  id?: string;
  itemId: string;
  kind: EditorKind;
  projectId: string | null;
  state: SessionState;
  /** ISO. Decides which side of a merge wins for everything that is not the undo log. */
  updatedAt: string;
};

const cacheKey = (itemId: string, kind: EditorKind) => `session:${kind}:${itemId}`;
const at = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : 0; };

/**
 * Fold two copies of the same session together. Two devices, or a device and its own cached copy,
 * can each hold edits the other has not seen, and picking one wholesale throws away real work.
 *
 * Scalars take the newer side, key by key, so an older copy still contributes a field the newer one
 * never set. The undo history is a log rather than a value: it takes the union, older entries
 * first, deduped by entry id, because appending a step on one device must not erase a step appended
 * on the other, and the same step arriving twice must not appear twice.
 */
export function mergeSession(a: EditorSession | null, b: EditorSession | null): EditorSession | null {
  if (!a || !b) return a ?? b;
  const [older, newer] = at(a.updatedAt) > at(b.updatedAt) ? [b, a] : [a, b];
  const undo: UndoEntry[] = [];
  const seen = new Set<string>();
  for (const entry of [...(older.state.undo ?? []), ...(newer.state.undo ?? [])]) {
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    undo.push(entry);
  }
  const state: SessionState = { ...older.state, ...newer.state };
  if (undo.length) state.undo = undo; else delete state.undo;
  return { ...newer, id: newer.id ?? older.id, state };
}

type Row = { id: string; project_id: string | null; item_id: string; kind: EditorKind; state: SessionState | null; updated_at: string };
const fromRow = (r: Row): EditorSession => ({
  id: r.id, itemId: r.item_id, kind: r.kind, projectId: r.project_id,
  state: r.state ?? {}, updatedAt: r.updated_at,
});
const COLUMNS = "id,project_id,item_id,kind,state,updated_at";

/**
 * Every session this account holds, newest first. Pass a project id to scope it to that project,
 * or null for the personal library; omit it entirely and you get all of them, which is what the
 * Workspace wants.
 */
export async function listSessions(projectId?: string | null): Promise<EditorSession[]> {
  if (!supabase) return [];
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  let query = supabase.from("editor_sessions").select(COLUMNS).order("updated_at", { ascending: false });
  if (projectId !== undefined) query = projectId ? query.eq("project_id", projectId) : query.is("project_id", null);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map(fromRow);
}

/**
 * What to reopen the item with. The cached copy and the account's copy are merged rather than one
 * being preferred: this device may have edited while signed out, and the other device may have
 * edited since.
 */
export async function loadSession(itemId: string, kind: EditorKind): Promise<EditorSession | null> {
  const cached = local.get<EditorSession | null>(cacheKey(itemId, kind), null);
  if (!supabase) return cached;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return cached;
  const { data } = await supabase.from("editor_sessions").select(COLUMNS)
    .eq("item_id", itemId).eq("kind", kind).maybeSingle();
  const merged = mergeSession(cached, data ? fromRow(data as Row) : null);
  if (merged) local.set(cacheKey(itemId, kind), merged);
  return merged;
}

/**
 * Saves are serialized per item, so two of them can never interleave on one row, and upserted on
 * (user, item, kind) so a second device's row is updated rather than duplicated. The local copy is
 * written first and unconditionally: signed out, offline or cloud-less, the session still resumes.
 */
export function saveSession(session: EditorSession) {
  const stamped = { ...session, updatedAt: new Date().toISOString() };
  local.set(cacheKey(session.itemId, session.kind), stamped);
  return serialize(cacheKey(session.itemId, session.kind), async () => {
    if (!supabase) return stamped;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return stamped;
    const { data, error } = await supabase.from("editor_sessions").upsert({
      user_id: user.id, project_id: stamped.projectId, item_id: stamped.itemId,
      kind: stamped.kind, state: stamped.state, updated_at: stamped.updatedAt,
    }, { onConflict: "user_id,item_id,kind" }).select(COLUMNS).maybeSingle();
    if (error) throw new Error(error.message);
    const saved = data ? fromRow(data as Row) : stamped;
    local.set(cacheKey(saved.itemId, saved.kind), saved);
    return saved;
  });
}

/** Same write, debounced: an editor can call this on every slider move. */
export function autoSaveSession(session: EditorSession, wait = 600) {
  debounce(cacheKey(session.itemId, session.kind), wait, () => { void saveSession(session); });
}

/** Ends the session. Called when an edit is committed or thrown away, not on every close. */
export async function deleteSession(itemId: string, kind: EditorKind) {
  local.set(cacheKey(itemId, kind), null); // reads back as "no session", which is what absent means
  if (!supabase) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.from("editor_sessions").delete()
    .eq("item_id", itemId).eq("kind", kind).eq("user_id", user.id);
  if (error) throw new Error(error.message);
}
