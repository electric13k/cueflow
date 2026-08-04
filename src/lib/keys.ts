import { local } from "./store";

/**
 * Configurable keybinds: arrows drive cues, WASD drives whatever is on the screen, other keys nudge
 * live effects. Shared by the Studio (which listens for them) and Settings (which changes them),
 * so there is one list and one storage key rather than two that drift.
 */
export type Action = "nextCue" | "prevCue" | "playPause" | "nextVisual" | "prevVisual" | "zoomIn" | "zoomOut" | "volUp" | "volDown" | "speedUp" | "speedDown" | "reverbUp" | "reverbDown";

export const keyActions: { id: Action; label: string; def: string }[] = [
  { id: "nextCue", label: "Next cue", def: "ArrowRight" }, { id: "prevCue", label: "Previous cue", def: "ArrowLeft" },
  { id: "playPause", label: "Play / pause", def: " " },
  { id: "nextVisual", label: "Next slide or video", def: "d" }, { id: "prevVisual", label: "Previous slide or video", def: "a" },
  { id: "zoomIn", label: "Zoom the stage in", def: "w" }, { id: "zoomOut", label: "Zoom the stage out", def: "s" },
  { id: "volUp", label: "Volume +", def: "ArrowUp" }, { id: "volDown", label: "Volume −", def: "ArrowDown" },
  { id: "speedUp", label: "Speed +", def: "]" }, { id: "speedDown", label: "Speed −", def: "[" },
  { id: "reverbUp", label: "Reverb +", def: "r" }, { id: "reverbDown", label: "Reverb −", def: "e" },
];

export const defaultBinds = Object.fromEntries(keyActions.map(a => [a.id, a.def])) as Record<Action, string>;
export const loadBinds = () => ({ ...defaultBinds, ...local.get<Record<Action, string>>("keybinds", defaultBinds) });
export const saveBinds = (binds: Record<Action, string>) => local.set("keybinds", binds);

export const keyLabel = (k: string) =>
  k === " " ? "Space" : ({ ArrowRight: "→", ArrowLeft: "←", ArrowUp: "↑", ArrowDown: "↓" } as Record<string, string>)[k] ?? (k.length === 1 ? k.toUpperCase() : k);

/** Two actions on one key means one of them silently stops working, so name the clash. */
export const clashes = (binds: Record<Action, string>) => {
  const seen = new Map<string, Action>();
  const bad = new Set<Action>();
  for (const action of keyActions) {
    const key = binds[action.id];
    if (!key) continue;
    const first = seen.get(key);
    if (first) { bad.add(first); bad.add(action.id); } else seen.set(key, action.id);
  }
  return bad;
};
