import type { Effects } from "../types";

export class AudioEngine {
  private context?: AudioContext; private source?: MediaElementAudioSourceNode; private output?: GainNode; private wet?: GainNode; private distortion?: WaveShaperNode; private reverb?: ConvolverNode; private element?: HTMLAudioElement;
  private connect(element: HTMLAudioElement) { if (this.element === element) return; this.element = element; this.context = new AudioContext(); this.source = this.context.createMediaElementSource(element); this.output = this.context.createGain(); this.wet = this.context.createGain(); this.distortion = this.context.createWaveShaper(); this.reverb = this.context.createConvolver(); this.source.connect(this.distortion); this.distortion.connect(this.output); this.distortion.connect(this.reverb); this.reverb.connect(this.wet); this.wet.connect(this.output); this.output.connect(this.context.destination); }
  apply(element: HTMLAudioElement, fx: Effects) { this.connect(element); if (!this.context || !this.output || !this.wet || !this.distortion || !this.reverb) return; const now = this.context.currentTime; element.playbackRate = fx.speed; element.volume = fx.volume; this.output.gain.setTargetAtTime(fx.gain, now, .02); this.wet.gain.setTargetAtTime(fx.reverb, now, .02); this.distortion.curve = curve(fx.distortion); if (fx.reverb) this.reverb.buffer = impulse(this.context); }
  async play(element: HTMLAudioElement, fx: Effects) { this.apply(element, fx); if (this.context?.state === "suspended") await this.context.resume(); if (fx.fadeIn) { element.volume = 0; const started = performance.now(); const fade = () => { element.volume = Math.min(fx.volume, fx.volume * (performance.now() - started) / (fx.fadeIn * 1000)); if (element.volume < fx.volume) requestAnimationFrame(fade); }; fade(); } await element.play(); }
}
export async function makeReversedFile(url: string, name: string) { const response = await fetch(url); if (!response.ok) throw new Error("Could not read this audio for reversal"); const encoded = await response.arrayBuffer(); const context = new AudioContext(); const decoded = await context.decodeAudioData(encoded); const reversed = context.createBuffer(decoded.numberOfChannels, decoded.length, decoded.sampleRate); for (let channel = 0; channel < decoded.numberOfChannels; channel++) reversed.getChannelData(channel).set(decoded.getChannelData(channel).slice().reverse()); await context.close(); return new File([encodeWav(reversed)], `${name}-reversed.wav`, { type: "audio/wav" }); }
// --- Buffer editing (waveform region trim, stereo/mono, per-channel gain) ---
export async function decodeAudioUrl(url: string) { const res = await fetch(url); if (!res.ok) throw new Error("Could not load this audio"); const bytes = await res.arrayBuffer(); const ctx = new AudioContext(); const decoded = await ctx.decodeAudioData(bytes); await ctx.close(); return decoded; }
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

function impulse(context: AudioContext) { const b = context.createBuffer(2, context.sampleRate * 2, context.sampleRate); for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2); } return b; }
function curve(amount: number) { if (!amount) return null; const d = new Float32Array(44100), k = amount * 120; for (let i = 0; i < d.length; i++) { const x = i * 2 / d.length - 1; d[i] = (3 + k) * x * 20 * Math.PI / 180 / (Math.PI + k * Math.abs(x)); } return d; }
function encodeWav(buffer: AudioBuffer) { const channels = buffer.numberOfChannels, frameCount = buffer.length, view = new DataView(new ArrayBuffer(44 + frameCount * channels * 2)); let offset = 0; const write = (value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset++, value.charCodeAt(i)); }; write("RIFF"); view.setUint32(offset, 36 + frameCount * channels * 2, true); offset += 4; write("WAVEfmt "); view.setUint32(offset, 16, true); offset += 4; view.setUint16(offset, 1, true); offset += 2; view.setUint16(offset, channels, true); offset += 2; view.setUint32(offset, buffer.sampleRate, true); offset += 4; view.setUint32(offset, buffer.sampleRate * channels * 2, true); offset += 4; view.setUint16(offset, channels * 2, true); offset += 2; view.setUint16(offset, 16, true); offset += 2; write("data"); view.setUint32(offset, frameCount * channels * 2, true); offset += 4; for (let frame = 0; frame < frameCount; frame++) for (let channel = 0; channel < channels; channel++) { const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[frame])); view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true); offset += 2; } return view.buffer; }
