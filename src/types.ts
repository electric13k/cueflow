export type Effects = { speed: number; volume: number; gain: number; reverb: number; fadeIn: number; fadeOut: number; distortion: number; reverse: boolean };

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

export const defaultEffects = (): Effects => ({ speed: 1, volume: 0.9, gain: 1, reverb: 0, fadeIn: 0, fadeOut: 0, distortion: 0, reverse: false });
export const cloneEffects = (effects: Effects): Effects => ({ ...effects });
export const defaultVisual = (): Visual => ({
  fit: "contain", zoom: 1, rotate: 0, flipH: false,
  brightness: 1, contrast: 1, saturate: 1, blur: 0,
  caption: "", trimIn: 0, trimOut: 0, muted: false, rate: 1, loop: false, transition: "fade",
});
export const kindOf = (track: Pick<Track, "kind">) => track.kind ?? "audio";
export const isVisual = (track: Pick<Track, "kind">) => kindOf(track) !== "audio";
