import { local } from "./store";
import type { Sequence } from "../types";

/**
 * The guided tutorial: point at the real control, then wait for the person to actually press it.
 *
 * Two rules decide the shape of this file.
 *
 * **It watches, it does not instrument.** A step is finished when a fact about the app becomes true,
 * not when a particular button reports being clicked. So `done()` reads the same localStorage the
 * Studio writes, or looks for something in the DOM. That means every way of doing a thing counts:
 * the button, the keyboard, a drag, or the user wandering off and doing it their own way. It also
 * means the Studio needs no tutorial code threaded through it, which is what kept the last attempt
 * from ever being finished.
 *
 * **A step whose anchor is missing is not shown.** That is enforced in `Spotlight.useAnchor`, and it
 * is why the order below matters: each step creates the state the next step's control needs to
 * exist. You cannot point at Arm before there is a sequence to arm.
 */

export type Step = {
  id: string;
  /** Selector for the control this step is about. Missing anchor, no step. */
  anchor: string;
  /** One line. The demonstration is the teaching; prose is what the old tour did instead of teaching. */
  say: string;
  /** Where the step lives, so the tour can say "you have wandered off" rather than pointing nowhere. */
  route?: string;
  /** True once the user has really done it. */
  done: () => boolean;
  /**
   * Completion that cannot be watched for, so pressing the highlighted control is what finishes the
   * step. A popup window and a dialog opening over the page both leave nothing behind to observe.
   */
  onPress?: true;
};

const KEY = "cueflow:tour";
type State = { done: boolean; step: number };

export const getTour = (): State => {
  try { return { done: false, step: 0, ...JSON.parse(localStorage.getItem(KEY) || "{}") } as State; }
  catch { return { done: false, step: 0 }; }
};
export const setTour = (s: Partial<State>) => localStorage.setItem(KEY, JSON.stringify({ ...getTour(), ...s }));
/** Has this browser ever been offered the tour? Distinct from having finished it. */
export const tourSeen = () => localStorage.getItem(KEY) !== null;

type Session = { selectedId?: string; sequenceId?: string; cueIndex?: number };
const session = (): Session => local.get<Session>("session", {});
const sequences = () => local.get<Sequence[]>("sequences", []);
const onScreen = (sel: string) => !!document.querySelector(sel);

export const steps: Step[] = [
  {
    id: "sidebar",
    // The panel is a drawer on a phone, so its Studio link is not on the page. The button that
    // opens the drawer is, and it is the first thing to press either way.
    anchor: "[data-tour='studio-link'], [data-tour='menu']",
    route: "/workspace",
    say: "This is where your work lives. Open the Studio.",
    done: () => location.pathname.endsWith("/studio"),
  },
  {
    id: "library",
    anchor: "[data-coach='add']",
    route: "/studio",
    say: "A demo library is loaded. Press a card to hear it.",
    done: () => !!session().selectedId,
  },
  {
    id: "sequence",
    anchor: "[data-tour='new-sequence']",
    route: "/studio",
    say: "A show is a list. Make one.",
    done: () => sequences().length > 0,
  },
  {
    id: "cues",
    // The tab on a desk, the pane button on a phone. Only one of the two is ever in the DOM.
    anchor: "[data-tour='deck-tab'], [data-tour='pane-deck']",
    route: "/studio",
    say: "Now put two cues in it, from the library.",
    done: () => sequences().some(s => s.items.length >= 2),
  },
  {
    id: "arm",
    anchor: "[data-coach='arm']",
    route: "/studio",
    say: "Arm it. Nothing goes out until you call it.",
    // The armed frame is drawn around the whole window, and only while armed.
    done: () => onScreen(".armed-frame"),
  },
  {
    id: "fire",
    anchor: "[data-coach='transport'], [data-tour='armed-banner']",
    route: "/studio",
    say: "Send cue one.",
    done: () => (session().cueIndex ?? -1) >= 0,
  },
  {
    id: "presenter",
    anchor: "[data-coach='presenter']",
    route: "/studio",
    say: "This is the window the room sees. Open it.",
    done: () => false,
    onPress: true,
  },
  {
    id: "script",
    anchor: "[data-coach='script']",
    route: "/studio",
    say: "A script is loaded too. Open the reader.",
    done: () => onScreen(".script-prose"),
  },
  {
    id: "show",
    anchor: "[data-coach='show']",
    route: "/studio",
    say: "Last one: a show hands the deck to everyone else's phone.",
    done: () => false,
    onPress: true,
  },
];

