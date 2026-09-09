/**
 * Whether the cloud is actually answering, as one fact the whole app can read.
 *
 * The pieces to know this already existed and were thrown away. `watchCloud` computes liveness and
 * offers it as `onLive`, which nothing passed. `hydrateCloud` distinguishes "no account" (`null`)
 * from "the read failed" (`false`), which the Studio collapsed into one branch. So a paused project
 * -- every table, bucket and socket gone -- reached the operator as "Nothing to sync. Sign in to
 * sync across devices." while they were signed in. They then went looking for a sign-in problem
 * they did not have.
 *
 * Three states, because there are three, and telling them apart is the entire point:
 *
 * - `off`   no account, or no cloud in this build. Local-only is a legitimate way to run CueFlow,
 *           not a fault, so it is not dressed as one.
 * - `live`  signed in and the realtime channel is subscribed. Another device's edit will arrive.
 * - `down`  signed in and the cloud is not answering. The show still runs, the library still saves
 *           locally, and nothing will reach anybody else until this clears.
 *
 * Deliberately not folded into `offline.ts`: that module is about pinning media onto a device on
 * purpose, and reusing its vocabulary here would make "offline" mean two different things.
 */
export type SyncState = "off" | "live" | "down";

let state: SyncState = "off";
const watchers = new Set<(s: SyncState) => void>();

export const syncState = () => state;

/**
 * Announce a state. Idempotent on purpose: `watchCloud` re-reports `false` on every failed retry,
 * and with the backoff running up to 30s that is a steady drip of identical values. Re-rendering
 * the chrome for each one would be work with nothing to show for it.
 */
export function setSyncState(next: SyncState) {
  if (next === state) return;
  state = next;
  for (const watcher of watchers) watcher(state);
}

/** Subscribe, and get the current state immediately: a component mounting mid-outage must see it. */
export function onSyncState(watcher: (s: SyncState) => void) {
  watchers.add(watcher);
  watcher(state);
  return () => { watchers.delete(watcher); };
}

/** What the chrome says. Short label for the pill, longer line for the tooltip and the toast. */
export const describeSync = (s: SyncState) => ({
  off: {
    label: "On this device",
    detail: "Your work is saved in this browser. Sign in to have it follow you to your other devices and to the rest of the crew.",
  },
  live: {
    label: "Synced",
    detail: "Signed in and connected. Edits made on another device arrive here on their own.",
  },
  down: {
    label: "Not syncing",
    detail: "You are signed in, but CueFlow cannot reach the cloud. Your work is still being saved in this browser and the show still runs. Nothing will reach your other devices or the crew until the connection is back.",
  },
}[s]);
