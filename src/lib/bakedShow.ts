import { bakedShow, nativeStore } from "./nativeStore";
import { importPack, readPack } from "./showPack";
import { listLocalShows, localTicket } from "./localShow";
import { local } from "./store";

/**
 * The show an installer was built around, opened once, on first start.
 *
 * This is the thing that makes a custom build worth cutting. The generic app is empty, so getting a
 * production into it means finding the file on the device, in a dark wing, on a phone, five minutes
 * before a house opens. A baked installer skips all of that: the crew member installs one file and
 * the app is already this show, already in their job, with nothing to type and nothing to fetch.
 *
 * Exactly once, and the marker is what guarantees that. Re-importing on every start would undo
 * every edit made since: a stage manager who renamed a cue on the tablet would find it renamed back
 * the next morning, by an app that never told them it had done it. So the pack is a starting point,
 * not a source of truth, and after the first start it is ignored.
 */

const DONE = "bakedShow";

type Opened = { showId: string; at: string; role: string | null };

export const bakedShowOpened = () => local.get<Opened | null>(DONE, null);

/**
 * Import the baked show if there is one and it has never been opened.
 *
 * Returns the show id when this call is what put it there, and null every other time, so the caller
 * can tell "just imported, take them to it" from "already here, leave them where they are".
 *
 * The extra guard on an empty device is belt and braces with the marker. Local storage in a WebView
 * can be cleared by the OS reclaiming space or by a reinstall, which would wipe the marker and
 * re-import over a show the company had been rehearsing all week. `restoreShowsFromDisk` runs
 * first for exactly that case, so by the time this is called a device that has been used already
 * has its shows back, and this stays out of the way.
 */
export async function openBakedShow(): Promise<string | null> {
  if (!nativeStore()) return null;
  if (bakedShowOpened()) return null;
  if (listLocalShows().length) return null;

  let file: Blob | null = null;
  try { file = await bakedShow(); } catch { return null; }
  if (!file) return null;

  try {
    const pack = await readPack(file);
    const result = await importPack(pack);
    const ticket = localTicket(result.member);
    if (ticket) local.set("ticket", ticket);
    local.set(DONE, { showId: result.showId, at: new Date().toISOString(), role: pack.manifest.role?.name ?? null } satisfies Opened);
    return result.showId;
  } catch (error) {
    /*
     * A damaged pack must not stop the app starting. Somebody holding an installer whose show will
     * not open still needs the app underneath it: they can type a key, or open a file that works.
     * No marker is written, so a later build with a good pack still gets its chance.
     */
    console.warn("[show] the show baked into this app would not open", error);
    return null;
  }
}
