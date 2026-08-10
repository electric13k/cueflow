import { local } from "./store";

/**
 * The room talking, kept.
 *
 * Messages between devices are Realtime broadcasts, which is right for a cue and wrong for a
 * sentence: a broadcast is gone the moment it is read, so anybody who looked away lost it. This
 * keeps a per-show history on the device that saw it. It is still silent, and it is still not a
 * record of the show: a line nobody's device was open for was never received and is not here.
 *
 * ponytail: localStorage, per show. The ceiling is that history is per device rather than per show,
 * and the upgrade is a `show_messages` table with the same RLS as `shows`, at which point this
 * becomes its cache.
 */
export type ChatLine = { id: string; at: string; from: string; text: string; kind: "message" | "event" };

/** Long enough to scroll back through a performance, short enough that the write stays cheap. */
export const CAP = 200;
const key = (show: string) => `chat:${show}`;
const watchers = new Set<(show: string) => void>();

/**
 * Upsert by id, then cap. Two windows on one device write the same history, and the same broadcast
 * can be logged by more than one of them, so the merge has to be idempotent rather than an append.
 */
export function merge(history: ChatLine[], line: ChatLine): ChatLine[] {
  if (history.some(l => l.id === line.id)) return history;
  return [...history, line].slice(-CAP);
}

export const loadChat = (show: string): ChatLine[] => (show ? local.get<ChatLine[]>(key(show), []) : []);

export function logChat(show: string, line: Omit<ChatLine, "id" | "at"> & Partial<Pick<ChatLine, "id" | "at">>) {
  if (!show || !line.text) return;
  const full: ChatLine = {
    id: line.id ?? crypto.randomUUID(),
    at: line.at ?? new Date().toISOString(),
    from: line.from, text: line.text, kind: line.kind,
  };
  const before = loadChat(show);
  const after = merge(before, full);
  if (after === before) return;
  local.set(key(show), after);
  watchers.forEach(fn => fn(show));
}

/** Panels subscribe rather than poll, so a line logged anywhere in the tab lands everywhere at once. */
export function onChat(fn: (show: string) => void) {
  watchers.add(fn);
  return () => { watchers.delete(fn); };
}

export function clearChat(show: string) {
  if (!show) return;
  local.set(key(show), []);
  watchers.forEach(fn => fn(show));
}
