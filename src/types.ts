/** bass/mid/treble are in dB, 0 being flat. Older saved effects have none, so they read as 0. */
export type Effects = { speed: number; volume: number; gain: number; reverb: number; fadeIn: number; fadeOut: number; distortion: number; reverse: boolean; bass?: number; mid?: number; treble?: number };

/** What a library asset is. Legacy tracks have no `kind`, so anything undefined is audio. */
export type Kind = "audio" | "image" | "video" | "embed";
export type Transition = "cut" | "fade" | "slide" | "zoom";

/**
 * Non-destructive look/playback settings for a visual asset. Images use the framing and colour
 * fields; video adds trim/mute/rate. Nothing here re-encodes anything, the presenter applies it at
 * display time (ponytail: in-browser video export needs ffmpeg.wasm or WebCodecs, add that only if
 * someone actually needs a rendered file rather than a cue that looks right on the night).
 */
export type Visual = {
  fit: "cover" | "contain";
  zoom: number; rotate: number; flipH: boolean;
  brightness: number; contrast: number; saturate: number; blur: number;
  /** Warm (+) / cool (-) wash, -100..100, and a 0..1 corner darkening. Older saved looks have neither. */
  temp?: number; vignette?: number;
  caption: string;
  trimIn: number; trimOut: number; muted: boolean; rate: number; loop: boolean;
  transition: Transition;
};

export type Track = {
  id: string; title: string; url: string; storagePath?: string; duration?: number;
  kind?: Kind; mime?: string; visual?: Visual;
  effects: Effects; createdAt: string; pending?: boolean; error?: boolean;
};
export type SequenceItem = { id: string; trackId: string; label: string; effects: Effects; visual?: Visual };
export type Sequence = { id: string; name: string; items: SequenceItem[]; createdAt: string };

/** What the audience window is showing right now. `n` bumps per cue so a repeat still animates. */
export type Stage = { url: string; kind: Kind; visual: Visual; label: string; n: number } | null;

export const defaultEffects = (): Effects => ({ speed: 1, volume: 0.9, gain: 1, reverb: 0, fadeIn: 0, fadeOut: 0, distortion: 0, reverse: false, bass: 0, mid: 0, treble: 0 });
export const cloneEffects = (effects: Effects): Effects => ({ ...effects });
export const defaultVisual = (): Visual => ({
  fit: "contain", zoom: 1, rotate: 0, flipH: false,
  brightness: 1, contrast: 1, saturate: 1, blur: 0, temp: 0, vignette: 0,
  caption: "", trimIn: 0, trimOut: 0, muted: false, rate: 1, loop: false, transition: "fade",
});
export const kindOf = (track: Pick<Track, "kind">) => track.kind ?? "audio";

/** a, b, … z, aa, ab … for the visual cues. */
const letters = (n: number) => { let s = ""; for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(97 + (n - 1) % 26) + s; return s; };

/**
 * Sound cues count 1, 2, 3; anything that fills the screen counts a, b, c. Two runs of labels in one
 * deck means "play 3" and "put up b" are unambiguous over comms, which one shared numbering is not.
 */
export function cueNumbers(kinds: Kind[]) {
  let sound = 0, visual = 0;
  return kinds.map(kind => (kind === "audio" ? String(++sound) : letters(visual++)));
}
export const isVisual = (track: Pick<Track, "kind">) => kindOf(track) !== "audio";
