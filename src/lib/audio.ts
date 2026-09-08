import type { Effects } from "../types";

/**
 * Three-band tone control, the shelf/peak split every mixer and Audacity's own equaliser use: a low
 * shelf under 250 Hz, a peak at 1 kHz for the range voices sit in, a high shelf over 4 kHz.
 */
const BANDS = [
  { key: "bass" as const, type: "lowshelf" as BiquadFilterType, freq: 250 },
  { key: "mid" as const, type: "peaking" as BiquadFilterType, freq: 1000 },
  { key: "treble" as const, type: "highshelf" as BiquadFilterType, freq: 4000 },
];

type AudioContextCtor = typeof AudioContext;
const audioContextCtor = () => {
  const scope = globalThis as typeof globalThis & { webkitAudioContext?: AudioContextCtor };
  return scope.AudioContext ?? scope.webkitAudioContext;
};

/**
 * One realtime context for the whole desk.
 *
 * A context per engine meant eight voices plus the editor's, and browsers cap concurrent contexts
 * around six (the decode cache below hit the same wall), so the last voices of a busy stack got no
 * graph at all and silently lost gain, reverb, EQ and distortion. One context carries a source node
 * per element quite happily, which is what a mixer is.
 */
let realtime: AudioContext | undefined;
const realtimeContext = () => {
  const Ctor = audioContextCtor();
  if (!Ctor) return undefined;
  try { return (realtime ??= new Ctor()); } catch { return undefined; }
};

export class AudioEngine {
  private context?: AudioContext; private source?: MediaElementAudioSourceNode; private output?: GainNode; private wet?: GainNode; private distortion?: WaveShaperNode; private reverb?: ConvolverNode; private element?: HTMLAudioElement; private eq: BiquadFilterNode[] = [];
  /** The loudest this element may get: the cue's own volume, already scaled by the master fader. */
  private ceiling = 1;
  /** Which fade owns the ramp, so a re-fire supersedes the one before it rather than racing it. */
  private fadeRun = 0;
  /** Build the graph lazily: constructing/resuming AudioContext during preload loses mobile activation. */
  private connect(element: HTMLAudioElement) {
    if (this.element === element) return;
    const context = realtimeContext();
    if (!context) return;
    try {
      this.source = context.createMediaElementSource(element);
      this.output = context.createGain(); this.wet = context.createGain();
      this.distortion = context.createWaveShaper(); this.reverb = context.createConvolver();
      // source -> distortion -> bass -> mid -> treble -> output, with a reverb send off the tone stack.
      this.eq = BANDS.map(band => { const node = context.createBiquadFilter(); node.type = band.type; node.frequency.value = band.freq; node.Q.value = 1; return node; });
      const toned = this.eq.reduce<AudioNode>((prev, node) => { prev.connect(node); return node; }, this.distortion);
      this.source.connect(this.distortion);
      toned.connect(this.output);
      toned.connect(this.reverb); this.reverb.connect(this.wet); this.wet.connect(this.output);
      this.output.connect(context.destination);
      // Claimed only once the graph is really up. Claiming it first latched a failure for the whole
      // session: the catch nulled the graph and this method then returned early forever.
      this.context = context; this.element = element;
    } catch {
      // A CORS-tainted source or an older browser may reject the graph. Native media still works.
      this.context = undefined; this.source = undefined; this.output = undefined; this.wet = undefined; this.distortion = undefined; this.reverb = undefined; this.eq = []; this.element = undefined;
    }
  }
  /** `ceiling` is what this element may actually reach; `fx.volume` is only what the cue asked for. */
  apply(element: HTMLAudioElement, fx: Effects, ceiling = fx.volume) {
    this.ceiling = ceiling; element.playbackRate = fx.speed; element.volume = ceiling;
    if (!this.context || !this.output || !this.wet || !this.distortion || !this.reverb || this.element !== element) return;
    const now = this.context.currentTime;
    this.output.gain.setTargetAtTime(fx.gain, now, .02); this.wet.gain.setTargetAtTime(fx.reverb, now, .02); this.distortion.curve = curve(fx.distortion); this.eq.forEach((node, i) => node.gain.setTargetAtTime(fx[BANDS[i].key] ?? 0, now, .02)); if (fx.reverb) this.reverb.buffer = impulse(this.context);
  }
  /** The master fader moving: a new ceiling, and none of the cue's stored effects touched. */
  level(element: HTMLAudioElement, ceiling: number) { this.ceiling = ceiling; element.volume = ceiling; }
  async play(element: HTMLAudioElement, fx: Effects, ceiling = fx.volume) {
    this.connect(element); this.apply(element, fx, ceiling);
    const run = ++this.fadeRun;
    if (fx.fadeIn) { element.volume = 0; const started = performance.now(); const fade = () => { if (run !== this.fadeRun || (this.element && this.element !== element)) return; element.volume = Math.min(this.ceiling, this.ceiling * (performance.now() - started) / (fx.fadeIn * 1000)); if (element.volume < this.ceiling) requestAnimationFrame(fade); }; fade(); }
    // Call both operations synchronously while the click/tap activation is still live.
    const resume = this.context?.state === "suspended" ? this.context.resume().catch(() => undefined) : Promise.resolve();
    const playback = element.play();
    await Promise.all([resume, playback]);
  }
}

/**
 * The stored master fader, read as text. `Number(null)` is 0 and 0 passes every range check, so an
 * absent key came back as a shut master and a fresh install played every cue silent.
 */
export function masterLevel(raw: string | null) {
  if (!raw?.trim()) return 1;
  const held = Number(raw);
  return Number.isFinite(held) && held >= 0 && held <= 1 ? held : 1;
}
/**
 * Several sounds at once.
 *
 * There was one `HTMLAudioElement` in the whole Studio, so firing a cue swapped its `src` and the
 * sound already playing stopped dead. For a cue board that is the wrong default in every direction:
 * a linked pair -- slide up, sting under it -- lost the sting, an ambience bed died the moment
 * anything else went out, and there was no way to run a loop under a sequence at all.
 *
 * A pool rather than an element per track, because each element carries a decoded stream and a
 * browser will not give you an unbounded number of them. When every voice is busy the oldest one is
 * taken, which is the same rule a hardware sampler uses and the same one an operator expects: the
 * thing that has been going longest is the thing you were least likely to still want.
 */
export type Voice = {
  readonly id: number;
  readonly element: HTMLAudioElement;
  readonly engine: AudioEngine;
  /** What this voice is currently holding, or null when it is free. */
  trackId: string | null;
  /** `performance.now()` at the moment it was last claimed. Oldest is stolen first. */
  startedAt: number;
};

export const DEFAULT_VOICES = 8;

export class VoicePool {
  private voices: Voice[] = [];
  /** Told whenever a voice frees itself, so the desk can redraw what is still sounding. */
  onIdle?: (voice: Voice) => void;
  constructor(
    private readonly size = DEFAULT_VOICES,
    private readonly makeElement: () => HTMLAudioElement = () => Object.assign(new Audio(), { crossOrigin: "anonymous", preload: "auto" }),
    private readonly now: () => number = () => performance.now(),
  ) {}

  all(): readonly Voice[] { return this.voices; }
  find(trackId: string) { return this.voices.find(v => v.trackId === trackId); }

  /**
   * A voice for this track: the one already holding it if there is one, so re-firing a cue restarts
   * it rather than stacking a second copy of the same sound on top of itself.
   */
  claim(trackId: string): Voice {
    const held = this.find(trackId);
    if (held) { held.startedAt = this.now(); return held; }
    const free = this.voices.find(v => v.trackId === null);
    if (free) { free.trackId = trackId; free.startedAt = this.now(); return free; }
    if (this.voices.length < this.size) {
      const made: Voice = { id: this.voices.length, element: this.makeElement(), engine: new AudioEngine(), trackId, startedAt: this.now() };
      // Nothing else lets a voice go. Without this a finished sound keeps its trackId, so the
      // transport re-binds to a cue that is already over and its pad stays lit.
      made.element.addEventListener("ended", () => { if (made.trackId === null) return; made.trackId = null; this.onIdle?.(made); });
      this.voices.push(made);
      return made;
    }
    const oldest = this.voices.reduce((a, b) => (a.startedAt <= b.startedAt ? a : b));
    oldest.element.pause();
    oldest.trackId = trackId;
    oldest.startedAt = this.now();
    return oldest;
  }

  release(voice: Voice) { voice.element.pause(); voice.trackId = null; }

  /** The panic button. Everything stops; nothing is torn down, so the next cue is still instant. */
  stopAll() { for (const voice of this.voices) this.release(voice); }

  /** Voices actually making sound right now, newest first -- the transport acts on the first. */
  playing(): Voice[] {
    return this.voices.filter(v => v.trackId && !v.element.paused).sort((a, b) => b.startedAt - a.startedAt);
  }
}

/** A voice a transport press paused, pinned to the sound it was holding at the time. */
export type HeldVoice = { voice: Voice; trackId: string };

/**
 * The voice a transport control acts on.
 *
 * Re-deriving it on every press stranded sounds: pause a bed, pause a sting over it, and the next
 * press resumed whichever was newest while the other was left mid-file with nothing pointing at it.
 * A press that paused something is remembered, so the press after it reaches that same sound.
 */
export function liveVoiceOf(pool: VoicePool, held: HeldVoice | null): Voice | null {
  if (held && held.voice.trackId === held.trackId && held.voice.element.paused) return held.voice;
  return pool.playing()[0] ?? pool.all().find(v => v.trackId) ?? null;
}

export async function makeReversedFile(url: string, name: string) { const response = await fetch(url); if (!response.ok) throw new Error("Could not read this audio for reversal"); const encoded = await response.arrayBuffer(); const context = new AudioContext(); const decoded = await context.decodeAudioData(encoded); const reversed = context.createBuffer(decoded.numberOfChannels, decoded.length, decoded.sampleRate); for (let channel = 0; channel < decoded.numberOfChannels; channel++) reversed.getChannelData(channel).set(decoded.getChannelData(channel).slice().reverse()); await context.close(); return new File([encodeWav(reversed)], `${name}-reversed.wav`, { type: "audio/wav" }); }
// --- Buffer editing (waveform region trim, stereo/mono, per-channel gain) ---
/**
 * Decoded audio, kept but not hoarded.
 *
 * This used to build a fresh `AudioContext` per call and cache every buffer forever. Both hurt on a
 * library rather than "a session's handful of tracks": browsers cap concurrent contexts around six,
 * so opening a full library serialised the decodes and then started rejecting them, and a five
 * minute stereo clip is roughly 50 MB of Float32 that was never released. One shared context does
 * the decoding, and the cache evicts oldest-first once it is holding too much.
 *
 * Insertion order is the eviction order, which is what a `Map` already gives us; re-reading a buffer
 * moves it back to the end so a file in active use is not the one dropped.
 */
const DECODE_BUDGET = 128 * 1024 * 1024;
const decodeCache = new Map<string, AudioBuffer>();
const decoding = new Map<string, Promise<AudioBuffer>>();
let decodeContext: AudioContext | null = null;
const sharedDecodeContext = () => (decodeContext ??= new AudioContext());
const bufferBytes = (buffer: AudioBuffer) => buffer.length * buffer.numberOfChannels * 4;

function remember(url: string, decoded: AudioBuffer) {
  decodeCache.set(url, decoded);
  let held = 0;
  for (const buffer of decodeCache.values()) held += bufferBytes(buffer);
  for (const [key, buffer] of decodeCache) {
    if (held <= DECODE_BUDGET || key === url) break;
    decodeCache.delete(key);
    held -= bufferBytes(buffer);
  }
}

export async function decodeAudioUrl(url: string) {
  const hit = decodeCache.get(url);
  if (hit) { decodeCache.delete(url); decodeCache.set(url, hit); return hit; }
  // Every card showing the same sound asks at once; one fetch and one decode answers all of them.
  const running = decoding.get(url);
  if (running) return running;
  const work = (async () => {
    const res = await fetch(url); if (!res.ok) throw new Error("Could not load this audio");
    const bytes = await res.arrayBuffer();
    const decoded = await sharedDecodeContext().decodeAudioData(bytes);
    remember(url, decoded);
    return decoded;
  })().finally(() => decoding.delete(url));
  decoding.set(url, work);
  return work;
}
export function sliceBuffer(src: AudioBuffer, from: number, to: number) {
  const start = Math.max(0, Math.floor(from * src.sampleRate)), end = Math.min(src.length, Math.floor(to * src.sampleRate));
  const length = Math.max(1, end - start);
  const out = new AudioBuffer({ length, numberOfChannels: src.numberOfChannels, sampleRate: src.sampleRate });
  for (let c = 0; c < src.numberOfChannels; c++) out.getChannelData(c).set(src.getChannelData(c).subarray(start, end));
  return out;
}
// gains[c] scales channel c; mono downmixes all channels to one.
export function processBuffer(src: AudioBuffer, opts: { gains?: number[]; mono?: boolean }) {
  const gains = opts.gains ?? [];
  if (opts.mono) {
    const out = new AudioBuffer({ length: src.length, numberOfChannels: 1, sampleRate: src.sampleRate }); const o = out.getChannelData(0);
    for (let c = 0; c < src.numberOfChannels; c++) { const g = gains[c] ?? 1, d = src.getChannelData(c); for (let i = 0; i < src.length; i++) o[i] += d[i] * g / src.numberOfChannels; }
    return out;
  }
  const out = new AudioBuffer({ length: src.length, numberOfChannels: src.numberOfChannels, sampleRate: src.sampleRate });
  for (let c = 0; c < src.numberOfChannels; c++) { const g = gains[c] ?? 1, d = src.getChannelData(c), o = out.getChannelData(c); for (let i = 0; i < src.length; i++) o[i] = d[i] * g; }
  return out;
}
export const bufferToWavFile = (buffer: AudioBuffer, name: string) => new File([encodeWav(buffer)], `${name}.wav`, { type: "audio/wav" });

// --- Clip surgery (cut / paste / merge / silence) ---
const frames = (buf: AudioBuffer, seconds: number) => Math.max(0, Math.min(buf.length, Math.round(seconds * buf.sampleRate)));
const make = (channels: number, length: number, sampleRate: number) => new AudioBuffer({ length: Math.max(1, length), numberOfChannels: channels, sampleRate });

/** Reads channel c of src, wrapping around when src has fewer channels (mono clip into stereo). */
const chan = (src: AudioBuffer, c: number) => src.getChannelData(c % src.numberOfChannels);

/** src with [from, to) deleted. */
export function removeRange(src: AudioBuffer, from: number, to: number) {
  const a = frames(src, from), b = frames(src, to);
  if (b <= a) return src;
  const out = make(src.numberOfChannels, src.length - (b - a), src.sampleRate);
  for (let c = 0; c < src.numberOfChannels; c++) {
    const d = src.getChannelData(c), o = out.getChannelData(c);
    o.set(d.subarray(0, a), 0);
    o.set(d.subarray(b), a);
  }
  return out;
}

/** clip spliced into src at `at` seconds, pushing the rest later. */
export function insertBuffer(src: AudioBuffer, at: number, clip: AudioBuffer) {
  const a = frames(src, at);
  const out = make(src.numberOfChannels, src.length + clip.length, src.sampleRate);
  for (let c = 0; c < src.numberOfChannels; c++) {
    const d = src.getChannelData(c), o = out.getChannelData(c);
    o.set(d.subarray(0, a), 0);
    o.set(chan(clip, c), a);
    o.set(d.subarray(a), a + clip.length);
  }
  return out;
}

/** clip summed on top of src at `at` seconds, the two play together. Extends src if needed. */
export function mixBuffer(src: AudioBuffer, at: number, clip: AudioBuffer) {
  const a = frames(src, at);
  const out = make(src.numberOfChannels, Math.max(src.length, a + clip.length), src.sampleRate);
  for (let c = 0; c < src.numberOfChannels; c++) {
    const o = out.getChannelData(c), s = chan(clip, c);
    o.set(src.getChannelData(c), 0);
    // Halve both sides so a full-scale overlap cannot clip past 0 dBFS.
    for (let i = 0; i < out.length; i++) o[i] *= .5;
    for (let i = 0; i < clip.length; i++) o[a + i] += s[i] * .5;
  }
  return out;
}

/** Zeroes [from, to) on the given channels (all channels when `channels` is omitted). */
export function silenceRange(src: AudioBuffer, from: number, to: number, channels?: number[]) {
  const a = frames(src, from), b = frames(src, to);
  const out = make(src.numberOfChannels, src.length, src.sampleRate);
  for (let c = 0; c < src.numberOfChannels; c++) {
    const o = out.getChannelData(c);
    o.set(src.getChannelData(c));
    if (!channels || channels.includes(c)) o.fill(0, a, b);
  }
  return out;
}

/** Ramps [from, to) between silence and full, linearly. `dir` "in" rises, "out" falls. */
export function fadeRange(src: AudioBuffer, from: number, to: number, dir: "in" | "out", channels?: number[]) {
  const a = frames(src, from), b = frames(src, to), span = Math.max(1, b - a);
  const out = make(src.numberOfChannels, src.length, src.sampleRate);
  for (let c = 0; c < src.numberOfChannels; c++) {
    const o = out.getChannelData(c); o.set(src.getChannelData(c));
    if (channels && !channels.includes(c)) continue;
    for (let i = a; i < b; i++) { const t = (i - a) / span; o[i] *= dir === "in" ? t : 1 - t; }
  }
  return out;
}

/** Scales [from, to) by `factor`, hard-limited so a boost cannot wrap past full scale. */
export function gainRange(src: AudioBuffer, from: number, to: number, factor: number, channels?: number[]) {
  const a = frames(src, from), b = frames(src, to);
  const out = make(src.numberOfChannels, src.length, src.sampleRate);
  for (let c = 0; c < src.numberOfChannels; c++) {
    const o = out.getChannelData(c); o.set(src.getChannelData(c));
    if (channels && !channels.includes(c)) continue;
    for (let i = a; i < b; i++) o[i] = Math.max(-1, Math.min(1, o[i] * factor));
  }
  return out;
}

/** [from, to) played backwards, the rest untouched. */
export function reverseRange(src: AudioBuffer, from: number, to: number, channels?: number[]) {
  const a = frames(src, from), b = frames(src, to);
  const out = make(src.numberOfChannels, src.length, src.sampleRate);
  for (let c = 0; c < src.numberOfChannels; c++) {
    const o = out.getChannelData(c); o.set(src.getChannelData(c));
    if (channels && !channels.includes(c)) continue;
    o.set(src.getChannelData(c).subarray(a, b).slice().reverse(), a);
  }
  return out;
}

/**
 * Lifts [from, to) so its loudest sample sits at `peak`. One shared factor across every channel,
 * otherwise normalising a stereo file would quietly re-pan it.
 */
export function normalizeRange(src: AudioBuffer, from: number, to: number, peak = 0.99, channels?: number[]) {
  const a = frames(src, from), b = frames(src, to);
  let loudest = 0;
  for (let c = 0; c < src.numberOfChannels; c++) {
    if (channels && !channels.includes(c)) continue;
    const d = src.getChannelData(c);
    for (let i = a; i < b; i++) { const v = Math.abs(d[i]); if (v > loudest) loudest = v; }
  }
  if (!loudest) return src; // silence has nothing to normalise
  return gainRange(src, from, to, peak / loudest, channels);
}

/**
 * Column min/max pairs for drawing, over the window [from, to). Returned raw (no gain applied) so a
 * gain drag can rescale the cached peaks instead of rescanning millions of samples per frame.
 */
export function peaks(src: AudioBuffer, channel: number, from: number, to: number, columns: number) {
  const a = frames(src, from), b = frames(src, to), span = Math.max(1, b - a);
  const d = src.getChannelData(channel), out = new Float32Array(columns * 2);
  for (let x = 0; x < columns; x++) {
    const s = a + Math.floor((x * span) / columns), e = Math.max(s + 1, a + Math.floor(((x + 1) * span) / columns));
    let min = 0, max = 0;
    for (let i = s; i < e && i < b; i++) { const v = d[i]; if (v < min) min = v; else if (v > max) max = v; }
    out[x * 2] = min; out[x * 2 + 1] = max;
  }
  return out;
}

/**
 * A mono clip widened to two channels. `spread` 0 is a plain duplicate; above that the right channel
 * is delayed by up to 14 ms, which the ear reads as width (the Haas effect) without inventing any
 * material that was not there. Kept short on purpose: a longer delay would sound like an echo, and a
 * phase-inverted trick would cancel itself the moment a venue sums the feed back to mono.
 */
export function toStereo(src: AudioBuffer, spread = 0.5) {
  const out = make(2, src.length, src.sampleRate);
  const d = src.getChannelData(0);
  const delay = Math.round(Math.max(0, Math.min(1, spread)) * 0.014 * src.sampleRate);
  const left = out.getChannelData(0), right = out.getChannelData(1);
  left.set(d);
  for (let i = 0; i < src.length; i++) right[i] = d[Math.max(0, i - delay)];
  return out;
}

/** A copy of just the given channels, in order, e.g. [1] lifts the right channel out as mono. */
export function pickChannels(src: AudioBuffer, channels: number[]) {
  const out = make(channels.length, src.length, src.sampleRate);
  channels.forEach((c, i) => out.getChannelData(i).set(src.getChannelData(c % src.numberOfChannels)));
  return out;
}

function impulse(context: AudioContext) { const b = context.createBuffer(2, context.sampleRate * 2, context.sampleRate); for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2); } return b; }
function curve(amount: number) { if (!amount) return null; const d = new Float32Array(44100), k = amount * 120; for (let i = 0; i < d.length; i++) { const x = i * 2 / d.length - 1; d[i] = (3 + k) * x * 20 * Math.PI / 180 / (Math.PI + k * Math.abs(x)); } return d; }
function encodeWav(buffer: AudioBuffer) { const channels = buffer.numberOfChannels, frameCount = buffer.length, view = new DataView(new ArrayBuffer(44 + frameCount * channels * 2)); let offset = 0; const write = (value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset++, value.charCodeAt(i)); }; write("RIFF"); view.setUint32(offset, 36 + frameCount * channels * 2, true); offset += 4; write("WAVEfmt "); view.setUint32(offset, 16, true); offset += 4; view.setUint16(offset, 1, true); offset += 2; view.setUint16(offset, channels, true); offset += 2; view.setUint32(offset, buffer.sampleRate, true); offset += 4; view.setUint32(offset, buffer.sampleRate * channels * 2, true); offset += 4; view.setUint16(offset, channels * 2, true); offset += 2; view.setUint16(offset, 16, true); offset += 2; write("data"); view.setUint32(offset, frameCount * channels * 2, true); offset += 4; for (let frame = 0; frame < frameCount; frame++) for (let channel = 0; channel < channels; channel++) { const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[frame])); view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true); offset += 2; } return view.buffer; }
