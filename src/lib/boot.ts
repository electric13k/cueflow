import { restoreShowsFromDisk } from "./localShow";
import { openBakedShow } from "./bakedShow";

/**
 * What has to happen to this device's storage before anything reads it, in the one order that works.
 *
 * Two steps and the order between them is the whole point. `restoreShowsFromDisk` puts back shows a
 * WebView's local storage has lost, and `openBakedShow` imports the show an installer was built
 * around, but only onto a device that has none. Run the wrong way round, a reinstall on a baked
 * build would see an empty device, import the pack over the top, and then restore the real show
 * beside it: two copies of one production, five minutes before a house opens, and nobody there
 * knowing which one has tonight's changes in it.
 *
 * One promise, memoised, because both the module that starts it and the component that waits for
 * its answer need the same one. Starting it twice would run the import twice.
 */
let started: Promise<string | null> | null = null;

export function bootDevice(): Promise<string | null> {
  started ??= restoreShowsFromDisk()
    .catch(error => { console.warn("[show] nothing was restored from disk", error); return 0; })
    .then(() => openBakedShow())
    .catch(error => { console.warn("[show] the show baked into this app was not opened", error); return null; });
  return started;
}
