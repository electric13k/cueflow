import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { Button, Slider, Spinner, Switch } from "../ui";
import { Crop, Pause, Play, Save, Scissors, Volume2, VolumeX } from "lucide-react";
import { bufferToWavFile, decodeAudioUrl, processBuffer, sliceBuffer } from "../lib/audio";

type Chan = { gain: number; mute: boolean };
const fmt = (s: number) => `${s.toFixed(2)}s`;

export default function WaveformEditor({ track, onSave }: { track: { id: string; title: string; url: string }; onSave: (file: File, title: string) => Promise<void> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null);
  const [chan, setChan] = useState<Chan[]>([]);
  const [mono, setMono] = useState(false);
  const [saving, setSaving] = useState(false);
  const [playing, setPlaying] = useState(false);
  const preview = useRef<{ ctx: AudioContext; src: AudioBufferSourceNode } | null>(null);
  const drag = useRef<number | null>(null);

  useEffect(() => {
    let alive = true; setLoading(true); setErr(""); setSel(null); setBuffer(null);
    decodeAudioUrl(track.url)
      .then(b => { if (!alive) return; setBuffer(b); setChan(Array.from({ length: b.numberOfChannels }, () => ({ gain: 1, mute: false }))); })
      .catch(e => alive && setErr((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; stop(); };
  }, [track.id, track.url]);

  const labels = useMemo(() => buffer?.numberOfChannels === 2 ? ["Left", "Right"] : buffer?.numberOfChannels === 1 ? ["Mono"] : chan.map((_, i) => `Ch ${i + 1}`), [buffer, chan]);

  // Draw waveform: one stacked lane per channel, plus the selection overlay.
  useEffect(() => {
    const cv = canvas.current, b = buffer; if (!cv || !b) return;
    const dpr = Math.min(devicePixelRatio || 1, 2), W = cv.clientWidth, H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext("2d")!; g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
    const lanes = b.numberOfChannels, laneH = H / lanes;
    for (let c = 0; c < lanes; c++) {
      const data = b.getChannelData(c), mid = laneH * c + laneH / 2, step = Math.ceil(data.length / W);
      g.strokeStyle = chan[c]?.mute ? "rgba(148,163,184,.4)" : "rgba(34,211,238,.9)"; g.beginPath();
      for (let x = 0; x < W; x++) {
        let min = 1, max = -1; for (let i = 0; i < step; i++) { const v = data[x * step + i] || 0; if (v < min) min = v; if (v > max) max = v; }
        const amp = (chan[c]?.mute ? 0.15 : 1) * (laneH / 2 - 2);
        g.moveTo(x + .5, mid - max * amp); g.lineTo(x + .5, mid - min * amp);
      }
      g.stroke();
      g.strokeStyle = "rgba(255,255,255,.08)"; g.beginPath(); g.moveTo(0, laneH * c + laneH); g.lineTo(W, laneH * c + laneH); g.stroke();
    }
    if (sel) { const x0 = (sel.start / b.duration) * W, x1 = (sel.end / b.duration) * W; g.fillStyle = "rgba(167,139,250,.22)"; g.fillRect(x0, 0, x1 - x0, H); g.strokeStyle = "rgba(167,139,250,.8)"; g.strokeRect(x0, 0, x1 - x0, H); }
  }, [buffer, sel, chan]);

  const xToTime = (clientX: number) => { const cv = canvas.current!, r = cv.getBoundingClientRect(); return Math.max(0, Math.min(buffer!.duration, ((clientX - r.left) / r.width) * buffer!.duration)); };
  const down = (e: PointerEvent) => { if (!buffer) return; drag.current = xToTime(e.clientX); setSel({ start: drag.current, end: drag.current }); (e.target as HTMLElement).setPointerCapture(e.pointerId); };
  const move = (e: PointerEvent) => { if (drag.current == null || !buffer) return; const t = xToTime(e.clientX); setSel({ start: Math.min(drag.current, t), end: Math.max(drag.current, t) }); };
  const up = () => { drag.current = null; setSel(s => (s && s.end - s.start < 0.02 ? null : s)); };

  const gains = () => chan.map(c => (c.mute ? 0 : c.gain));
  const buildOutput = () => { const base = sel ? sliceBuffer(buffer!, sel.start, sel.end) : buffer!; return processBuffer(base, { gains: gains(), mono }); };

  const stop = () => { try { preview.current?.src.stop(); } catch { /* already ended */ } void preview.current?.ctx.close(); preview.current = null; setPlaying(false); };
  const previewOut = async () => {
    if (playing) return stop();
    const out = buildOutput(), ctx = new AudioContext(), src = ctx.createBufferSource();
    src.buffer = out; src.connect(ctx.destination); src.onended = () => { if (preview.current?.src === src) stop(); };
    preview.current = { ctx, src }; src.start(); setPlaying(true);
  };
  const save = async () => {
    setSaving(true);
    try { const out = buildOutput(); const suffix = sel ? " (clip)" : mono ? " (mono)" : " (edit)"; await onSave(bufferToWavFile(out, `${track.title}${suffix}`), `${track.title}${suffix}`); }
    catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  const setC = (i: number, p: Partial<Chan>) => setChan(cs => cs.map((c, j) => (j === i ? { ...c, ...p } : c)));

  if (loading) return <div className="glass-soft flex items-center gap-3 p-6 text-muted"><Spinner size="sm" /> Loading waveform…</div>;
  if (err) return <div className="glass-soft p-6 text-sm text-warning">Couldn’t load audio for editing: {err}</div>;
  if (!buffer) return null;

  return (
    <div className="glass-soft space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Waveform — drag to select a region</p>
        <p className="text-xs text-muted">{buffer.numberOfChannels === 2 ? "Stereo" : buffer.numberOfChannels === 1 ? "Mono" : `${buffer.numberOfChannels}ch`} • {fmt(buffer.duration)}{sel && <> • selection {fmt(sel.start)}–{fmt(sel.end)} ({fmt(sel.end - sel.start)})</>}</p>
      </div>
      <canvas ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} className="h-40 w-full cursor-crosshair touch-none rounded-xl border border-white/10 bg-black/30" />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" color="primary" variant="flat" startContent={playing ? <Pause size={15} /> : <Play size={15} />} onPress={previewOut}>{playing ? "Stop" : sel ? "Play selection" : "Play"}</Button>
        {sel && <Button size="sm" variant="light" startContent={<Scissors size={14} />} onPress={() => setSel(null)}>Clear selection</Button>}
        <Switch size="sm" isSelected={mono} onValueChange={setMono}>Mix to mono</Switch>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {chan.map((c, i) => (
          <div key={i} className="rounded-xl border border-white/10 bg-white/[.03] p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium">{labels[i]}</span>
              <Button isIconOnly size="sm" variant={c.mute ? "solid" : "light"} color={c.mute ? "danger" : "default"} onPress={() => setC(i, { mute: !c.mute })}>{c.mute ? <VolumeX size={14} /> : <Volume2 size={14} />}</Button>
            </div>
            <Slider size="sm" color="primary" aria-label={`${labels[i]} gain`} minValue={0} maxValue={2} step={0.05} isDisabled={c.mute} value={c.gain} onChange={v => setC(i, { gain: Array.isArray(v) ? v[0] : v })} getValue={v => `${Number(v).toFixed(2)}x`} />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
        <Button color="primary" isLoading={saving} startContent={sel ? <Crop size={16} /> : <Save size={16} />} onPress={save}>
          {sel ? "Save selection as new sound" : "Save edited copy"}
        </Button>
        <span className="text-xs text-muted">Renders a new cloud-backed WAV; the original is untouched.</span>
      </div>
    </div>
  );
}
