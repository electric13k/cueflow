import type { Effects } from "../types";

export class AudioEngine {
  private context?: AudioContext; private source?: MediaElementAudioSourceNode; private output?: GainNode; private wet?: GainNode; private distortion?: WaveShaperNode; private reverb?: ConvolverNode; private element?: HTMLAudioElement;
  private connect(element: HTMLAudioElement) { if (this.element === element) return; this.element = element; this.context = new AudioContext(); this.source = this.context.createMediaElementSource(element); this.output = this.context.createGain(); this.wet = this.context.createGain(); this.distortion = this.context.createWaveShaper(); this.reverb = this.context.createConvolver(); this.source.connect(this.distortion); this.distortion.connect(this.output); this.distortion.connect(this.reverb); this.reverb.connect(this.wet); this.wet.connect(this.output); this.output.connect(this.context.destination); }
  apply(element: HTMLAudioElement, fx: Effects) { this.connect(element); if (!this.context || !this.output || !this.wet || !this.distortion || !this.reverb) return; const now = this.context.currentTime; element.playbackRate = fx.speed; element.volume = fx.volume; this.output.gain.setTargetAtTime(fx.gain, now, .02); this.wet.gain.setTargetAtTime(fx.reverb, now, .02); this.distortion.curve = curve(fx.distortion); if (fx.reverb) this.reverb.buffer = impulse(this.context); }
  async play(element: HTMLAudioElement, fx: Effects) { this.apply(element, fx); if (this.context?.state === "suspended") await this.context.resume(); if (fx.fadeIn) { element.volume = 0; const started = performance.now(); const fade = () => { element.volume = Math.min(fx.volume, fx.volume * (performance.now() - started) / (fx.fadeIn * 1000)); if (element.volume < fx.volume) requestAnimationFrame(fade); }; fade(); } await element.play(); }
}
export async function makeReversedFile(url: string, name: string) { const response = await fetch(url); if (!response.ok) throw new Error("Could not read this audio for reversal"); const encoded = await response.arrayBuffer(); const context = new AudioContext(); const decoded = await context.decodeAudioData(encoded); const reversed = context.createBuffer(decoded.numberOfChannels, decoded.length, decoded.sampleRate); for (let channel = 0; channel < decoded.numberOfChannels; channel++) reversed.getChannelData(channel).set(decoded.getChannelData(channel).slice().reverse()); await context.close(); return new File([encodeWav(reversed)], `${name}-reversed.wav`, { type: "audio/wav" }); }
// --- Buffer editing (waveform region trim, stereo/mono, per-channel gain) ---
const decodeCache = new Map<string, AudioBuffer>(); // ponytail: unbounded, fine for a session's handful of tracks
export async function decodeAudioUrl(url: string) {
  const hit = decodeCache.get(url); if (hit) return hit;
  const res = await fetch(url); if (!res.ok) throw new Error("Could not load this audio");
  const bytes = await res.arrayBuffer(); const ctx = new AudioContext(); const decoded = await ctx.decodeAudioData(bytes); await ctx.close();
  decodeCache.set(url, decoded); return decoded;
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
