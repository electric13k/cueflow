/**
 * Teaching on discovery. A tour that fires everything at you on the first load is a tour nobody
 * remembers -- you are being told about controls you have no reason to care about yet. Each lesson
 * here waits until you open the thing it explains, says one sentence, and never comes back.
 */
export type Lesson = { id: string; title: string; body: string; target?: string };

export const lessons: Record<string, Lesson> = {
  studio: {
    id: "studio",
    title: "This is the board",
    body: "Everything for your show lives here. Nothing plays until you fire it.",
  },
  library: {
    id: "library",
    title: "The library",
    body: "Sounds, pictures, video and slides. Add them here, tidy them later.",
    target: "[data-coach='add']",
  },
  editor: {
    id: "editor",
    title: "The editor",
    body: "Trim, level and tone a sound — or crop and grade a picture. It never leaves your browser.",
  },
  sequence: {
    id: "sequence",
    title: "The running order",
    body: "Drag cues into the order you will call them. Sound counts 1, 2, 3; anything the room sees counts a, b, c.",
    target: "[data-coach='arm']",
  },
  armed: {
    id: "armed",
    title: "Armed",
    body: "The frame is amber and the arrows are live. Press → to send cue one.",
  },
  script: {
    id: "script",
    title: "The script",
    body: "Import it, name the words that matter, and the screen flashes just before each one arrives.",
    target: "[data-coach='script']",
  },
  show: {
    id: "show",
    title: "Shows",
    body: "Hand out a key and the rest of the room joins on their own devices. Silent, no accounts.",
    target: "[data-coach='show']",
  },
};

const KEY = "cueflow:taught";
const taught = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
export const hasLearned = (id: string) => taught().includes(id);
export function markLearned(id: string) {
  const all = taught();
  if (!all.includes(id)) localStorage.setItem(KEY, JSON.stringify([...all, id]));
}
export const forgetLessons = () => localStorage.removeItem(KEY);

/** Ask for a lesson. Silently does nothing if it has already been given. */
export function teach(id: keyof typeof lessons) {
  if (hasLearned(id) || !lessons[id]) return;
  window.dispatchEvent(new CustomEvent("cueflow:teach", { detail: id }));
}
