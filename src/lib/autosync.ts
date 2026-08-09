import { persist, type SyncState } from "./store";
import type { Sequence, Track } from "../types";

/**
 * Auto sync, always on. This is not a second sync engine: the write itself is still `persist()` in
 * store.ts, which already serializes per resource, upserts rather than delete-then-inserts and
 * dedupes on merge. What lives here is the trigger and the word a page renders.
 */
export type SyncStatus = "idle" | "saving" | "saved" | "offline";

/**
 * Four words, and only four. A write that never reached the cloud because this build has none, or
 * because nobody is signed in, still saved to this device, so it reads as "saved" rather than as a
 * failure. "offline" is reserved for a write that was meant to reach the account and did not.
 */
export const statusOf = (state: SyncState): SyncStatus => (state.ok ? "saved" : "offline");

let status: SyncStatus = "idle";
const watchers = new Set<(s: SyncStatus) => void>();
export const syncStatus = () => status;
/** Subscribe; the callback fires immediately with the current value and on every change after. */
export function onSyncStatus(cb: (s: SyncStatus) => void) {
  watchers.add(cb);
  cb(status);
  return () => { watchers.delete(cb); };
}
function setStatus(next: SyncStatus) {
  if (next === status) return;
  status = next;
  for (const w of [...watchers]) w(next);
}

// setTimeout, never requestAnimationFrame: a save has to fire in a tab that is not being painted,
// and rAF simply does not run there. The presenter window sitting in front of the deck is exactly
// that case.
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** Debounce per key. The last call within `wait` wins; earlier ones are dropped, not queued. */
export function debounce(key: string, wait: number, fn: () => void) {
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => { timers.delete(key); fn(); }, wait));
}

const tails = new Map<string, Promise<unknown>>();
const pending = new Map<string, () => unknown>();
/**
 * Serialize per resource. One job at a time per key, and a job asked for while one is in flight is
 * replaced by anything newer that arrives before its turn: only the latest state is worth writing.
 * A superseded job resolves undefined rather than running.
 */
export function serialize<T>(key: string, job: () => Promise<T>): Promise<T | undefined> {
  pending.set(key, job);
  const run = (tails.get(key) ?? Promise.resolve()).then(() => {
    if (pending.get(key) !== job) return undefined;
    pending.delete(key);
    return job();
  });
  tails.set(key, run.catch(() => undefined));
  return run;
}

/**
 * Call on every edit. Coalesces a burst of keystrokes or a drag into one write, reports what
 * happened, and never throws at the caller: a failed save is a status, not an exception.
 */
export function autoSave(tracks: Track[], sequences: Sequence[], projectId: string | null = null, wait = 500) {
  debounce("store", wait, () => {
    setStatus("saving");
    persist(tracks, sequences, projectId).then(
      state => setStatus(statusOf(state)),
      () => setStatus("offline"),
    );
  });
}

/** Write now, skipping the debounce. For closing a tab or leaving a project. */
export function flushSave(tracks: Track[], sequences: Sequence[], projectId: string | null = null) {
  clearTimeout(timers.get("store"));
  timers.delete("store");
  setStatus("saving");
  return persist(tracks, sequences, projectId).then(
    state => { setStatus(statusOf(state)); return state; },
    () => { setStatus("offline"); return { cloud: true, ok: false } as SyncState; },
  );
}
