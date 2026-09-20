/**
 * A show file the operating system handed the app, on its way to the screen that opens it.
 *
 * Installed as a PWA, CueFlow is registered for `.cueflow` files, so double-clicking one launches
 * the app and delivers the handle through `launchQueue`. That fires once, early, at a moment when
 * the screen that knows how to review an import may not be mounted yet, and the handle is gone if
 * nobody takes it. So it is taken here and parked, and the screen collects it when it arrives.
 *
 * Parked rather than imported. Double-clicking a file is a clear instruction to open it and not a
 * clear instruction to write a production onto this device, merge its media into this library and
 * take a job in it. The review card gets to run, exactly as it does for a file chosen by hand.
 */

let waiting: File | null = null;
const listeners = new Set<(file: File) => void>();

/** Hand a file over. Anyone already watching gets it now; anyone later gets it from `takeOpenedShow`. */
export function offerOpenedShow(file: File) {
  waiting = file;
  for (const listen of listeners) listen(file);
}

/** Whether one is waiting, without taking it. Lets a screen decide to show the import at all. */
export const peekOpenedShow = () => waiting;

/** Collect the parked file, once. Returns null when there is none, which is the normal case. */
export function takeOpenedShow(): File | null {
  const file = waiting;
  waiting = null;
  return file;
}

export function onOpenedShow(listener: (file: File) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

type LaunchParams = { files?: FileSystemFileHandle[] };
type LaunchQueue = { setConsumer: (consume: (params: LaunchParams) => void) => void };

/**
 * Start listening for files the OS sends.
 *
 * Chromium only, today: Safari and Firefox ship no `launchQueue`, so there the file picker and the
 * drop target on the show screen are the way in. Guarded rather than feature-detected loudly,
 * because an absent API here costs nothing and warning about it would be noise on two thirds of
 * the browsers this runs in.
 */
export function watchForOpenedShows() {
  const queue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
  if (!queue) return;
  try {
    queue.setConsumer(async params => {
      for (const handle of params.files ?? []) {
        try { offerOpenedShow(await handle.getFile()); }
        catch (error) { console.warn("[show] a file this app was launched with could not be read", error); }
      }
    });
  } catch (error) {
    console.warn("[show] this browser would not hand over the file it was launched with", error);
  }
}
