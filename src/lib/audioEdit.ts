/**
 * Undo/redo and the gain-envelope maths for the audio editor.
 *
 * Both live here rather than in the component because both are pure: a stack transition is a
 * function of the stack, and the gain at a time is a function of the points. The editor ran its
 * history as two `useState` arrays updated from inside each other's updater, which React invokes
 * twice under StrictMode -- one undo pushed two redo entries. A reducer over one value cannot do
 * that.
 */

/** Bounded on both sides: 20 steps back, and the redo branch cannot outgrow them. */
const LIMIT = 20;

export type Stack<T> = { past: T[]; present: T; future: T[] };

export const stack = <T>(present: T): Stack<T> => ({ past: [], present, future: [] });

/** A committed edit. The old present becomes history and any redo branch is discarded. */
export const commit = <T>(s: Stack<T>, present: T): Stack<T> =>
  ({ past: [...s.past, s.present].slice(-LIMIT), present, future: [] });

export const undo = <T>(s: Stack<T>): Stack<T> => s.past.length
  ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future].slice(0, LIMIT) }
  : s;

export const redo = <T>(s: Stack<T>): Stack<T> => s.future.length
  ? { past: [...s.past, s.present].slice(-LIMIT), present: s.future[0], future: s.future.slice(1) }
  : s;

// --- gain envelope ---------------------------------------------------------
/**
 * A control point: `g` is a linear multiplier, 1 = untouched, matching the channel faders.
 * Placing and dragging points is wavesurfer's envelope plugin; what the curve *means* is here.
 */
export type EnvPoint = { t: number; g: number };

/** The flat, does-nothing envelope a clip starts with. */
export const flatEnvelope = (duration: number): EnvPoint[] => [{ t: 0, g: 1 }, { t: duration, g: 1 }];

/** Linear between points, flat outside them. Points are assumed sorted by time. */
export function envelopeGain(points: EnvPoint[], t: number) {
  if (!points.length) return 1;
  if (t <= points[0].t) return points[0].g;
  const last = points[points.length - 1];
  if (t >= last.t) return last.g;
  let i = 1;
  while (i < points.length && points[i].t < t) i++;
  const a = points[i - 1], b = points[i];
  const span = b.t - a.t;
  return span <= 0 ? b.g : a.g + (b.g - a.g) * ((t - a.t) / span);
}

/** src with the envelope multiplied in, hard-limited so a boost cannot wrap past full scale. */
export function applyEnvelope(src: AudioBuffer, points: EnvPoint[]) {
  const out = new AudioBuffer({ length: src.length, numberOfChannels: src.numberOfChannels, sampleRate: src.sampleRate });
  // One gain per sample, computed once and reused across channels.
  const curve = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) curve[i] = envelopeGain(points, i / src.sampleRate);
  for (let c = 0; c < src.numberOfChannels; c++) {
    const d = src.getChannelData(c), o = out.getChannelData(c);
    for (let i = 0; i < src.length; i++) o[i] = Math.max(-1, Math.min(1, d[i] * curve[i]));
  }
  return out;
}
