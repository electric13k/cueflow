import { loadBinds, type Action } from "./keys";

/**
 * Hardware that is not a keyboard: a MIDI pad, a USB gamepad, a page-turner pedal.
 *
 * "Add more physical buttons even on pc" was the ask, and it is not really about buttons. An
 * operator calling a show has one hand on a fader and their eyes on the stage, and hunting for a
 * specific key on a laptop in the dark is the part that goes wrong. A pad or a pedal is a target you
 * can find without looking.
 *
 * Everything here resolves to the same `Action` union the keyboard already uses, so there is one
 * list of things CueFlow can be told to do, one place they are bound, and one storage key. A
 * controller is another way of saying an action, not a second control scheme to keep in step.
 *
 * Both APIs are absent in some browsers and blocked in others, so nothing here throws: an absent
 * API is simply a controller that never fires.
 */

/** The order the actions are offered to a controller that binds by position rather than by name. */
const PAD_ORDER: Action[] = [
  "nextCue", "prevCue", "playPause", "stopAll",
  "nextVisual", "prevVisual", "volUp", "volDown",
];

type Fire = (action: Action) => void;

/**
 * Web MIDI.
 *
 * Note-on with velocity 0 is note-off on a lot of hardware, which is why the velocity is checked
 * rather than the status byte alone; without that a pad fires its cue again when released, and
 * firing a cue twice is worse than not firing it.
 *
 * Notes map by position: the lowest note the device sends takes the first action, and so on up. A
 * pad's own numbering differs per manufacturer and asking somebody to look up their controller's
 * note table before they can step a cue is how a feature goes unused.
 */
export function listenToMidi(fire: Fire): () => void {
  const nav = navigator as Navigator & { requestMIDIAccess?: (o?: { sysex: boolean }) => Promise<MIDIAccess> };
  if (typeof nav.requestMIDIAccess !== "function") return () => {};

  let stopped = false;
  let access: MIDIAccess | null = null;
  let lowest: number | null = null;

  const onMessage = (event: MIDIMessageEvent) => {
    const data = event.data;
    if (!data || data.length < 3) return;
    const [status, note, velocity] = data;
    // 0x90 is note-on on channel 1; the low nibble is the channel, which we do not care about.
    if ((status & 0xf0) !== 0x90 || velocity === 0) return;
    // The first note seen anchors the map, so a 25-key controller and a 61-key one both start at
    // their own bottom note rather than at a number chosen here.
    if (lowest === null || note < lowest) lowest = note;
    const action = PAD_ORDER[note - lowest];
    if (action) fire(action);
  };

  const attach = (midi: MIDIAccess) => {
    midi.inputs.forEach(input => { input.onmidimessage = onMessage; });
  };

  void nav.requestMIDIAccess({ sysex: false })
    .then(midi => {
      if (stopped) return;
      access = midi;
      attach(midi);
      // Plugging a controller in after the page loaded is the normal case, not the exception.
      midi.onstatechange = () => { if (!stopped) attach(midi); };
    })
    // Refused permission, no device, or a browser that has the method and not the capability.
    .catch(() => {});

  return () => {
    stopped = true;
    access?.inputs.forEach(input => { input.onmidimessage = null; });
    if (access) access.onstatechange = null;
  };
}

/**
 * Gamepads, which includes most USB foot pedals and presentation remotes, because they enumerate as
 * one rather than as a MIDI device.
 *
 * There is no event for a button press: the API is a poll. This reads inside one animation frame
 * loop and holds the previous frame's state so a held button fires once, on the edge, instead of
 * sixty times a second. A held button firing repeatedly would step through an entire cue stack in
 * the time it takes to notice.
 *
 * The loop only runs while a pad is actually connected, so a machine with no controller pays
 * nothing for this.
 */
export function listenToGamepads(fire: Fire): () => void {
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return () => {};
  if (typeof requestAnimationFrame !== "function") return () => {};

  let raf = 0;
  let stopped = false;
  const held = new Map<string, boolean>();

  const poll = () => {
    if (stopped) return;
    let anyConnected = false;
    for (const pad of navigator.getGamepads()) {
      if (!pad) continue;
      anyConnected = true;
      pad.buttons.forEach((button, i) => {
        const key = `${pad.index}:${i}`;
        const down = button.pressed;
        if (down && !held.get(key)) {
          const action = PAD_ORDER[i];
          if (action) fire(action);
        }
        held.set(key, down);
      });
    }
    // Nothing plugged in: stop spinning and wait to be woken by the connect event.
    raf = anyConnected ? requestAnimationFrame(poll) : 0;
  };

  const wake = () => { if (!stopped && !raf) raf = requestAnimationFrame(poll); };
  window.addEventListener("gamepadconnected", wake);
  wake();

  return () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener("gamepadconnected", wake);
  };
}

/**
 * Both at once, which is what a caller actually wants.
 *
 * The bindings are read at fire time rather than captured when this is set up, so rebinding a key in
 * Settings takes effect on the next press instead of on the next reload.
 */
export function listenToControllers(run: (action: Action) => void): () => void {
  const fire = (action: Action) => { if (loadBinds()[action] !== "") run(action); };
  const offMidi = listenToMidi(fire);
  const offPads = listenToGamepads(fire);
  return () => { offMidi(); offPads(); };
}

/** What a settings screen shows: the actions a controller can reach, in the order it reaches them. */
export const padOrder = (): readonly Action[] => PAD_ORDER;

/** Whether this browser could talk to hardware at all, for wording a settings screen honestly. */
export const controllersPossible = () =>
  typeof navigator !== "undefined" &&
  (typeof (navigator as { requestMIDIAccess?: unknown }).requestMIDIAccess === "function" ||
    typeof navigator.getGamepads === "function");
