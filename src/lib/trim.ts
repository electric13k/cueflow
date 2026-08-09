import type { Sequence } from "../types";

/**
 * Where a video trim handle lands. Behaviour is OpenCut's (opencut.app): drag the edge on the
 * filmstrip, it sticks to points that already matter; step it a frame at a time with "," and ".".
 * No code from OpenCut is here -- this is the arithmetic only, kept out of the component so it can
 * be tested without a DOM.
 */

/**
 * Frames per second assumed by the "," / "." nudge.
 * ponytail: a fixed 30 -- HTMLVideoElement does not expose the real rate. Sampling
 * requestVideoFrameCallback would give it; add that if a 24 or 25 fps clip nudges visibly wrong.
 */
export const FPS = 30;

/** Shortest clip worth firing: under this the cue shows nothing. */
export const MIN_CLIP = .25;

/** Nearest point within `tolerance` of `t`, else `t` unchanged. */
export function snap(t: number, points: number[], tolerance: number) {
  let best = t, dist = tolerance;
  for (const p of points) {
    const d = Math.abs(p - t);
    if (d < dist) { dist = d; best = p; }
  }
  return best;
}

/**
 * Place one handle. `t` is where the pointer (or the nudge) asked for; the answer is snapped, held
 * inside the file and kept MIN_CLIP clear of the other handle. `trimOut` of 0 means "to the end",
 * which is how it is stored, so the far edge is `trimOut || duration`.
 */
export function placeEdge(
  edge: "trimIn" | "trimOut",
  t: number,
  { duration, trimIn, trimOut, points = [], tolerance = 0 }:
    { duration: number; trimIn: number; trimOut: number; points?: number[]; tolerance?: number },
) {
  const end = trimOut || duration;
  const want = tolerance > 0 ? snap(t, points, tolerance) : t;
  return edge === "trimIn"
    ? { trimIn: clamp(want, 0, end - MIN_CLIP) }
    : { trimOut: clamp(want, trimIn + MIN_CLIP, duration) };
}

/** One frame back (-1) or forward (+1) from where the handle is now. Exact: a nudge never snaps. */
export function nudgeEdge(
  edge: "trimIn" | "trimOut",
  dir: -1 | 1,
  state: { duration: number; trimIn: number; trimOut: number },
) {
  const at = edge === "trimIn" ? state.trimIn : state.trimOut || state.duration;
  return placeEdge(edge, at + dir / FPS, state);
}

/**
 * The trim edges cues built from this track already use -- the points a handle sticks to. Zero and
 * an unset (0) trimOut are dropped: both mean an end of the file, which is where the handle clamps
 * anyway, so offering them as snap targets would be noise.
 */
export function cuePoints(sequences: Sequence[], trackId: string) {
  const out = new Set<number>();
  for (const seq of sequences)
    for (const item of seq.items)
      if (item.trackId === trackId && item.visual) {
        out.add(item.visual.trimIn);
        out.add(item.visual.trimOut);
      }
  return [...out].filter(t => t > 0).sort((a, b) => a - b);
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
