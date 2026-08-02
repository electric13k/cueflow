import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { Button, Slider, Spinner, Switch, Tooltip } from "../ui";
import { ClipboardPaste, Copy, Crop, Layers, Pause, Play, RotateCcw, Save, Scissors, Undo2, Volume2, VolumeX, Wand2 } from "lucide-react";
import {
  bufferToWavFile, decodeAudioUrl, insertBuffer, mixBuffer, pickChannels, processBuffer,
  removeRange, silenceRange, sliceBuffer,
} from "../lib/audio";

type Chan = { gain: number; mute: boolean };
type Sel = { start: number; end: number; channel: number | null }; // channel null = every channel
const fmt = (s: number) => `${s.toFixed(2)}s`;

// Module-level so a copied region survives switching to another sound, that is the whole point of
// having a clipboard rather than an in-place trim.
let clipboard: AudioBuffer | null = null;

export default function WaveformEditor({ track, onSave, onPreview }: {
  track: { id: string; title: string; url: string };
  onSave: (file: File, title: string) => Promise<void>;
  /** Hands the unsaved working buffer to the main player as a blob URL ("" once it matches the original). */
  onPreview?: (url: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null); // the working copy, edits land here
  const [history, setHistory] = useState<AudioBuffer[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<Sel | null>(null);
  const [chan, setChan] = useState<Chan[]>([]);
  const [mono, setMono] = useState(false);
  const [saving, setSaving] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [hasClip, setHasClip] = useState(!!clipboard);
  const preview = useRef<{ ctx: AudioContext; src: AudioBufferSourceNode } | null>(null);
  const previewUrl = useRef(""); // blob URL currently handed to the main player
  const original = useRef<AudioBuffer | null>(null); // untouched decode, for A/B against the edit
  const drag = useRef<{ from: number; channel: number | null } | null>(null);

  useEffect(() => {
    let alive = true; setLoading(true); setErr(""); setSel(null); setBuffer(null); setHistory([]);
    decodeAudioUrl(track.url)
      .then(b => { if (!alive) return; original.current = b; setBuffer(b); setChan(Array.from({ length: b.numberOfChannels }, () => ({ gain: 1, mute: false }))); })
      .catch(e => alive && setErr((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; stop(); };
  }, [track.id, track.url]);

  const labels = useMemo(
    () => buffer?.numberOfChannels === 2 ? ["Left", "Right"] : buffer?.numberOfChannels === 1 ? ["Mono"] : chan.map((_, i) => `Ch ${i + 1}`),
    [buffer, chan],
  );
  const short = (i: number) => (labels[i] ?? "").slice(0, 1).toUpperCase() || String(i + 1);

  // Draw: one stacked lane per channel, each tagged with its name, plus the selection overlay.
  useEffect(() => {
    const cv = canvas.current, b = buffer; if (!cv || !b) return;
    const dpr = Math.min(devicePixelRatio || 1, 2), W = cv.clientWidth, H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext("2d")!; g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
    const lanes = b.numberOfChannels, laneH = H / lanes;
    for (let c = 0; c < lanes; c++) {
      const data = b.getChannelData(c), top = laneH * c, mid = top + laneH / 2, step = Math.ceil(data.length / W);
      g.strokeStyle = chan[c]?.mute ? "rgba(148,163,184,.4)" : "rgba(34,211,238,.9)"; g.beginPath();
      for (let x = 0; x < W; x++) {
        let min = 1, max = -1; for (let i = 0; i < step; i++) { const v = data[x * step + i] || 0; if (v < min) min = v; if (v > max) max = v; }
        const amp = (chan[c]?.mute ? 0.15 : 1) * (laneH / 2 - 2);
        g.moveTo(x + .5, mid - max * amp); g.lineTo(x + .5, mid - min * amp);
      }
      g.stroke();
      // Lane name, so it is never a guess which half is the left channel.
      g.font = "600 11px Inter, system-ui, sans-serif";
      const name = labels[c] ?? `Ch ${c + 1}`, w = g.measureText(name).width;
      g.fillStyle = "rgba(2,6,23,.72)"; g.fillRect(8, top + 8, w + 14, 18);
      g.fillStyle = "rgba(226,232,240,.92)"; g.fillText(name, 15, top + 21);
      g.strokeStyle = "rgba(255,255,255,.08)"; g.beginPath(); g.moveTo(0, top + laneH); g.lineTo(W, top + laneH); g.stroke();
    }
    if (sel) {
      const x0 = (sel.start / b.duration) * W, x1 = (sel.end / b.duration) * W;
      const y0 = sel.channel == null ? 0 : laneH * sel.channel, y1 = sel.channel == null ? H : laneH * (sel.channel + 1);
      g.fillStyle = "rgba(167,139,250,.22)"; g.fillRect(x0, y0, x1 - x0, y1 - y0);
      g.strokeStyle = "rgba(167,139,250,.8)"; g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    }
  }, [buffer, sel, chan, labels]);

  const geom = (e: PointerEvent) => {
    const cv = canvas.current!, r = cv.getBoundingClientRect(), b = buffer!;
    const time = Math.max(0, Math.min(b.duration, ((e.clientX - r.left) / r.width) * b.duration));
    const lane = Math.min(b.numberOfChannels - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * b.numberOfChannels)));
    return { time, lane };
  };
  const down = (e: PointerEvent) => {
    if (!buffer) return;
    const { time, lane } = geom(e);
    // Shift (or Alt) narrows the selection to the lane you started in; a plain drag spans both.
    const channel = (e.shiftKey || e.altKey) && buffer.numberOfChannels > 1 ? lane : null;
    drag.current = { from: time, channel };
    setSel({ start: time, end: time, channel });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    const d = drag.current; if (!d || !buffer) return;
    const { time } = geom(e);
    setSel({ start: Math.min(d.from, time), end: Math.max(d.from, time), channel: d.channel });
  };
  const up = () => { drag.current = null; setSel(s => (s && s.end - s.start < 0.02 ? null : s)); };

  const scopeTo = (channel: number | null) => setSel(s => (s ? { ...s, channel } : s));

  // --- edits -------------------------------------------------------------
  const apply = (next: AudioBuffer) => { stop(); setHistory(h => [...h.slice(-19), buffer!]); setBuffer(next); };
  const undo = () => setHistory(h => { if (!h.length) return h; stop(); setBuffer(h[h.length - 1]); setSel(null); return h.slice(0, -1); });

  const region = () => (sel ? sliceBuffer(buffer!, sel.start, sel.end) : buffer!);
  const copy = () => {
    const cut = region();
    clipboard = sel?.channel == null ? cut : pickChannels(cut, [sel.channel]);
    setHasClip(true);
  };
  const cut = () => { if (!sel) return; copy(); apply(removeRange(buffer!, sel.start, sel.end)); setSel(null); };
  const paste = () => { if (!clipboard) return; apply(insertBuffer(buffer!, sel ? sel.start : buffer!.duration, clipboard)); setSel(null); };
  const merge = () => { if (!clipboard) return; apply(mixBuffer(buffer!, sel ? sel.start : 0, clipboard)); setSel(null); };
  const silence = () => { if (!sel) return; apply(silenceRange(buffer!, sel.start, sel.end, sel.channel == null ? undefined : [sel.channel])); };

  const gains = () => chan.map(c => (c.mute ? 0 : c.gain));
  const buildOutput = () => processBuffer(buffer!, { gains: gains(), mono });
  const dirty = history.length > 0 || mono || chan.some(c => c.mute || c.gain !== 1);

  // Hand the working buffer to the main transport as a WAV blob, so the player at the bottom plays
  // the edit instead of the original file, no save needed. Debounced: a gain drag re-encodes.
  useEffect(() => {
    if (!onPreview || !buffer) return;
    if (!dirty) { onPreview(""); return; }
    const t = setTimeout(() => {
      const url = URL.createObjectURL(bufferToWavFile(buildOutput(), track.title));
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = url; onPreview(url);
    }, 250);
    return () => clearTimeout(t);
  }, [buffer, chan, mono, dirty]);
  // Drop the blob and put the original back the moment the editor goes away.
  useEffect(() => () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = ""; onPreview?.("");
  }, []);

  const stop = () => { try { preview.current?.src.stop(); } catch { /* already ended */ } void preview.current?.ctx.close(); preview.current = null; setPlaying(false); };
  // "selection" auditions just the marked region, "original" the untouched file, "edit" everything
  // you have done so far.
  const previewOut = async (what: "edit" | "selection" | "original") => {
    if (playing) return stop();
    if (what === "original") {
      const src0 = original.current; if (!src0) return;
      const ctx0 = new AudioContext(), node = ctx0.createBufferSource();
      node.buffer = src0; node.connect(ctx0.destination); node.onended = () => { if (preview.current?.src === node) stop(); };
      preview.current = { ctx: ctx0, src: node }; node.start(); setPlaying(true);
      return;
    }
    const region = what === "selection" && sel;
    let out = region ? sliceBuffer(buffer!, sel.start, sel.end) : buffer!;
    if (region && sel.channel != null) out = pickChannels(out, [sel.channel]);
    out = processBuffer(out, { gains: region && sel.channel != null ? [gains()[sel.channel]] : gains(), mono });
    const ctx = new AudioContext(), src = ctx.createBufferSource();
    src.buffer = out; src.connect(ctx.destination); src.onended = () => { if (preview.current?.src === src) stop(); };
    preview.current = { ctx, src }; src.start(); setPlaying(true);
  };
  const save = async () => {
    setSaving(true);
    try {
      const edited = history.length > 0;
      const suffix = edited ? " (edit)" : mono ? " (mono)" : " (copy)";
      const title = `${track.title}${suffix}`;
      await onSave(bufferToWavFile(buildOutput(), title), title);
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  const setC = (i: number, p: Partial<Chan>) => setChan(cs => cs.map((c, j) => (j === i ? { ...c, ...p } : c)));

  if (loading) return <div className="glass-soft flex items-center gap-3 p-6 text-muted"><Spinner size="sm" /> Loading waveform…</div>;
  if (err) return <div className="glass-soft p-6 text-sm text-warning">Couldn’t load audio for editing: {err}</div>;
  if (!buffer) return null;

  const stereo = buffer.numberOfChannels > 1;
  return (
    <div className="glass-soft space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Waveform, drag to select{stereo ? ", shift-drag for one channel" : ""}</p>
        <p className="text-xs text-muted">
          {stereo ? (buffer.numberOfChannels === 2 ? "Stereo" : `${buffer.numberOfChannels}ch`) : "Mono"} • {fmt(buffer.duration)}
          {sel && <> • {sel.channel == null ? "both channels" : labels[sel.channel]} {fmt(sel.start)}–{fmt(sel.end)} ({fmt(sel.end - sel.start)})</>}
        </p>
      </div>

      <canvas ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} className="h-40 w-full cursor-crosshair touch-none rounded-xl border border-white/10 bg-black/30" />

      {sel && stereo && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">Selection covers:</span>
          {[null, ...chan.map((_, i) => i)].map(c => (
            <button key={String(c)} onClick={() => scopeTo(c as number | null)}
              className={`rounded-full border px-3 py-1 font-semibold transition-colors ${sel.channel === c ? "border-accent bg-accent/15 text-accent" : "border-white/10 text-muted hover:border-white/25"}`}>
              {c == null ? "Both" : labels[c as number]}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Tooltip content={dirty ? "Plays the whole clip with every edit applied" : "Plays the whole clip"}>
          <Button size="sm" color="primary" variant="flat" startContent={playing ? <Pause size={15} /> : <Play size={15} />} onPress={() => previewOut("edit")}>
            {playing ? "Stop" : dirty ? "Play edit" : "Play"}
          </Button>
        </Tooltip>
        {sel && !playing && (
          <Tooltip content="Plays only the marked region">
            <Button size="sm" variant="bordered" startContent={<Play size={14} />} onPress={() => previewOut("selection")}>
              Play {sel.channel == null ? "selection" : labels[sel.channel]}
            </Button>
          </Tooltip>
        )}
        {dirty && !playing && (
          <Tooltip content="Plays the file as it was before you touched it">
            <Button size="sm" variant="light" startContent={<RotateCcw size={14} />} onPress={() => previewOut("original")}>Play original</Button>
          </Tooltip>
        )}
        <Tooltip content="Copy the selection to the clipboard, it survives switching sounds">
          <Button size="sm" variant="bordered" isDisabled={!sel} startContent={<Copy size={14} />} onPress={copy}>Copy</Button>
        </Tooltip>
        <Tooltip content="Remove the selection and put it on the clipboard">
          <Button size="sm" variant="bordered" isDisabled={!sel} startContent={<Scissors size={14} />} onPress={cut}>Cut</Button>
        </Tooltip>
        <Tooltip content={hasClip ? "Splice the clipboard in at the selection start" : "Copy something first"}>
          <Button size="sm" variant="bordered" isDisabled={!hasClip} startContent={<ClipboardPaste size={14} />} onPress={paste}>Paste</Button>
        </Tooltip>
        <Tooltip content={hasClip ? "Play the clipboard on top of this sound instead of after it" : "Copy something first"}>
          <Button size="sm" variant="bordered" isDisabled={!hasClip} startContent={<Layers size={14} />} onPress={merge}>Merge</Button>
        </Tooltip>
        <Tooltip content={sel?.channel == null ? "Silence the selection" : `Silence the ${labels[sel!.channel!]} channel across the selection`}>
          <Button size="sm" variant="bordered" isDisabled={!sel} startContent={<Wand2 size={14} />} onPress={silence}>Silence</Button>
        </Tooltip>
        <Button size="sm" variant="light" isDisabled={!history.length} startContent={<Undo2 size={14} />} onPress={undo}>Undo</Button>
        {sel && <Button size="sm" variant="light" onPress={() => setSel(null)}>Clear selection</Button>}
        <Switch size="sm" isSelected={mono} onValueChange={setMono}>Mix to mono</Switch>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {chan.map((c, i) => (
          <div key={i} className="rounded-xl border border-white/10 bg-white/[.03] p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium">
                <span className="grid h-5 w-5 place-items-center rounded-md bg-accent/15 text-[10px] font-bold text-accent">{short(i)}</span>
                {labels[i]}
              </span>
              <Button isIconOnly size="sm" variant={c.mute ? "solid" : "light"} color={c.mute ? "danger" : "default"} aria-label={`${c.mute ? "Unmute" : "Mute"} ${labels[i]}`} onPress={() => setC(i, { mute: !c.mute })}>{c.mute ? <VolumeX size={14} /> : <Volume2 size={14} />}</Button>
            </div>
            <Slider size="sm" color="primary" aria-label={`${labels[i]} gain`} minValue={0} maxValue={2} step={0.05} isDisabled={c.mute} value={c.gain} onChange={v => setC(i, { gain: Array.isArray(v) ? v[0] : v })} getValue={v => `${Number(v).toFixed(2)}x`} />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
        <Button color="primary" isLoading={saving} startContent={history.length ? <Crop size={16} /> : <Save size={16} />} onPress={save}>Save as new sound</Button>
        <span className="text-xs text-muted">
          {dirty ? "Play edit already plays what you have. Saving renders a new cloud-backed WAV; the original is untouched." : "Renders a new cloud-backed WAV; the original is untouched."}
        </span>
      </div>
    </div>
  );
}
