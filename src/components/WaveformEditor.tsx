import { type KeyboardEvent, type PointerEvent, type WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Slider, Spinner, Switch, Tooltip } from "../ui";
import {
  ClipboardPaste, Copy, Crop, Layers, Maximize2, Pause, Play, Repeat, RotateCcw, Save, Scissors,
  SignalHigh, TrendingDown, TrendingUp, Undo2, Redo2, Volume1, Volume2, VolumeX, Wand2, ZoomIn, ZoomOut,
} from "lucide-react";
import {
  bufferToWavFile, decodeAudioUrl, fadeRange, gainRange, insertBuffer, mixBuffer, normalizeRange,
  peaks, pickChannels, processBuffer, removeRange, reverseRange, silenceRange, sliceBuffer,
} from "../lib/audio";

type Chan = { gain: number; mute: boolean };
type Sel = { start: number; end: number; channel: number | null }; // channel null = every channel
type View = { start: number; end: number };                        // the visible slice of the clip
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const fmt = (s: number) => `${s.toFixed(2)}s`;
/** Ruler labels: sub-second zoom wants decimals, a whole song wants m:ss. */
const stamp = (s: number, step: number) =>
  step < 1 ? `${s.toFixed(2)}s` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const RULER = 18;                       // px reserved at the top of the canvas for the time ruler
const TICKS = [.01, .02, .05, .1, .25, .5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const DB3 = Math.SQRT2;                 // +3 dB, the step every mixer uses

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
  const [future, setFuture] = useState<AudioBuffer[]>([]);        // undone edits, waiting for redo
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<Sel | null>(null);
  const [chan, setChan] = useState<Chan[]>([]);
  const [mono, setMono] = useState(false);
  const [saving, setSaving] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [hasClip, setHasClip] = useState(!!clipboard);
  const [view, setView] = useState<View>({ start: 0, end: 1 });
  const [cursor, setCursor] = useState(0);   // where playback starts, moved by a click
  const [head, setHead] = useState<number | null>(null); // live playhead while a preview runs
  const [width, setWidth] = useState(0);
  const preview = useRef<{ ctx: AudioContext; src: AudioBufferSourceNode } | null>(null);
  const previewUrl = useRef(""); // blob URL currently handed to the main player
  const original = useRef<AudioBuffer | null>(null); // untouched decode, for A/B against the edit
  const drag = useRef<{ from: number; channel: number | null; moved: boolean } | null>(null);

  useEffect(() => {
    let alive = true; setLoading(true); setErr(""); setSel(null); setBuffer(null); setHistory([]); setFuture([]); setCursor(0);
    decodeAudioUrl(track.url)
      .then(b => {
        if (!alive) return;
        original.current = b; setBuffer(b); setView({ start: 0, end: b.duration });
        setChan(Array.from({ length: b.numberOfChannels }, () => ({ gain: 1, mute: false })));
      })
      .catch(e => alive && setErr((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; stop(); };
  }, [track.id, track.url]);

  const labels = useMemo(
    () => buffer?.numberOfChannels === 2 ? ["Left", "Right"] : buffer?.numberOfChannels === 1 ? ["Mono"] : chan.map((_, i) => `Ch ${i + 1}`),
    [buffer, chan],
  );
  const short = (i: number) => (labels[i] ?? "").slice(0, 1).toUpperCase() || String(i + 1);

  // The canvas is fluid, so every time→pixel conversion needs its real width.
  useEffect(() => {
    const cv = canvas.current; if (!cv) return;
    const ro = new ResizeObserver(() => setWidth(cv.clientWidth));
    ro.observe(cv); setWidth(cv.clientWidth);
    return () => ro.disconnect();
  }, [loading]);

  /**
   * Column min/max per channel for the visible window, scanned once per (edit, zoom, resize) and
   * reused across redraws. Gain and mute are applied when drawing rather than baked in here, so
   * dragging a level rescales cached peaks instead of rescanning millions of samples per frame.
   */
  const wave = useMemo(() => {
    if (!buffer || width < 2) return [];
    return Array.from({ length: buffer.numberOfChannels }, (_, c) => peaks(buffer, c, view.start, view.end, Math.floor(width)));
  }, [buffer, view.start, view.end, width]);

  const span = view.end - view.start;
  const xOf = useCallback((t: number) => ((t - view.start) / span) * width, [view.start, span, width]);
  const tOf = useCallback((x: number) => view.start + (x / Math.max(1, width)) * span, [view.start, span, width]);

  // Draw: a time ruler, one stacked lane per channel, the selection, the cursor and the playhead.
  useEffect(() => {
    const cv = canvas.current, b = buffer; if (!cv || !b || width < 2) return;
    const dpr = Math.min(devicePixelRatio || 1, 2), W = width, H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext("2d")!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);

    // Ruler
    const step = TICKS.find(s => (s / span) * W >= 64) ?? span / 4;
    g.fillStyle = "rgba(255,255,255,.04)"; g.fillRect(0, 0, W, RULER);
    g.font = "500 10px Inter, system-ui, sans-serif"; g.textBaseline = "middle";
    for (let t = Math.ceil(view.start / step) * step; t <= view.end + 1e-6; t += step) {
      const x = Math.round(xOf(t)) + .5;
      g.strokeStyle = "rgba(255,255,255,.16)"; g.beginPath(); g.moveTo(x, RULER - 6); g.lineTo(x, RULER); g.stroke();
      g.fillStyle = "rgba(148,163,184,.85)"; g.fillText(stamp(t, step), x + 4, RULER / 2);
    }
    g.strokeStyle = "rgba(255,255,255,.1)"; g.beginPath(); g.moveTo(0, RULER + .5); g.lineTo(W, RULER + .5); g.stroke();

    // Lanes. Mono collapses to one lane whose peaks are the average of the levelled channels, which
    // is what "mix to mono" actually renders.
    const lanes = mono ? 1 : b.numberOfChannels, laneH = (H - RULER) / lanes;
    const level = (c: number) => (chan[c]?.mute ? 0 : chan[c]?.gain ?? 1);
    for (let lane = 0; lane < lanes; lane++) {
      const top = RULER + laneH * lane, mid = top + laneH / 2, amp = laneH / 2 - 3;
      const idx = mono ? wave.map((_, i) => i) : [lane]; // which channels feed this lane
      const silent = idx.every(c => level(c) === 0);
      // Ghost of the untouched signal, so a cut level reads as a change and not as a quiet file.
      const ghosted = idx.some(c => level(c) !== 1);
      for (const pass of ghosted ? ["ghost", "live"] as const : ["live"] as const) {
        g.strokeStyle = pass === "ghost" ? "rgba(148,163,184,.22)" : silent ? "rgba(148,163,184,.45)" : "rgba(34,211,238,.9)";
        g.beginPath();
        for (let x = 0; x < W; x++) {
          let min = 0, max = 0;
          for (const c of idx) {
            const p = wave[c]; if (!p) continue;
            const gain = pass === "ghost" ? 1 : level(c);
            min += p[x * 2] * gain / idx.length; max += p[x * 2 + 1] * gain / idx.length;
          }
          g.moveTo(x + .5, mid - clamp(max, -1, 1) * amp); g.lineTo(x + .5, mid - clamp(min, -1, 1) * amp);
        }
        g.stroke();
      }
      // Anything a boost pushes past full scale is flagged, the way a meter would.
      g.fillStyle = "rgba(251,146,60,.75)";
      for (let x = 0; x < W; x++) {
        const hot = idx.some(c => { const p = wave[c]; return p && (Math.abs(p[x * 2]) * level(c) > 1 || Math.abs(p[x * 2 + 1]) * level(c) > 1); });
        if (hot) g.fillRect(x, top + 1, 1, 3);
      }
      g.font = "600 11px Inter, system-ui, sans-serif";
      const name = mono ? "Mono mix" : labels[lane] ?? `Ch ${lane + 1}`, w = g.measureText(name).width;
      g.fillStyle = "rgba(2,6,23,.72)"; g.fillRect(8, top + 8, w + 14, 18);
      g.fillStyle = "rgba(226,232,240,.92)"; g.fillText(name, 15, top + 17);
      g.strokeStyle = "rgba(255,255,255,.08)"; g.beginPath(); g.moveTo(0, top + laneH); g.lineTo(W, top + laneH); g.stroke();
    }

    if (sel) {
      const x0 = xOf(sel.start), x1 = xOf(sel.end);
      const laneTop = sel.channel == null || mono ? RULER : RULER + laneH * sel.channel;
      const laneBot = sel.channel == null || mono ? H : RULER + laneH * (sel.channel + 1);
      g.fillStyle = "rgba(167,139,250,.22)"; g.fillRect(x0, laneTop, x1 - x0, laneBot - laneTop);
      g.strokeStyle = "rgba(167,139,250,.8)"; g.strokeRect(x0 + .5, laneTop + .5, x1 - x0 - 1, laneBot - laneTop - 1);
    }
    for (const [t, colour] of [[cursor, "rgba(226,232,240,.55)"], [head, "rgba(52,211,153,.95)"]] as const) {
      if (t == null || t < view.start || t > view.end) continue;
      const x = Math.round(xOf(t)) + .5;
      g.strokeStyle = colour; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, RULER); g.lineTo(x, H); g.stroke(); g.lineWidth = 1;
    }
  }, [wave, sel, chan, mono, view, width, head, cursor, labels, buffer, xOf, span]);

  // --- pointer ------------------------------------------------------------
  const geom = (e: PointerEvent) => {
    const cv = canvas.current!, r = cv.getBoundingClientRect(), b = buffer!;
    const time = clamp(tOf(e.clientX - r.left), 0, b.duration);
    const y = e.clientY - r.top - RULER, laneH = (r.height - RULER) / (mono ? 1 : b.numberOfChannels);
    return { time, lane: clamp(Math.floor(y / laneH), 0, b.numberOfChannels - 1) };
  };
  const down = (e: PointerEvent) => {
    if (!buffer) return;
    const { time, lane } = geom(e);
    // Shift (or Alt) narrows the selection to the lane you started in; a plain drag spans both.
    const channel = (e.shiftKey || e.altKey) && buffer.numberOfChannels > 1 && !mono ? lane : null;
    drag.current = { from: time, channel, moved: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    const d = drag.current; if (!d || !buffer) return;
    const { time } = geom(e);
    if (!d.moved && Math.abs(time - d.from) * (width / span) < 3) return; // a click is not a 1px drag
    d.moved = true;
    setSel({ start: Math.min(d.from, time), end: Math.max(d.from, time), channel: d.channel });
  };
  const up = () => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (!d.moved) { setCursor(d.from); setSel(null); return; } // plain click parks the playhead
    setSel(s => (s && s.end - s.start < 0.005 ? null : s));
  };
  /** Wheel zooms around the pointer, the way every waveform editor does; shift-wheel scrolls. */
  const wheel = (e: WheelEvent) => {
    if (!buffer) return;
    const r = canvas.current!.getBoundingClientRect();
    if (e.shiftKey) return pan((e.deltaY || e.deltaX) * span * 0.002);
    zoomAt(clamp(tOf(e.clientX - r.left), 0, buffer.duration), e.deltaY > 0 ? 1.25 : 0.8);
  };

  // --- zoom ---------------------------------------------------------------
  const minSpan = (b: AudioBuffer) => Math.min(b.duration, 0.01);
  const window_ = (start: number, end: number) => {
    const b = buffer!; const wide = clamp(end - start, minSpan(b), b.duration);
    const s = clamp(start, 0, b.duration - wide);
    setView({ start: s, end: s + wide });
  };
  /** Keeps the time under the pointer pinned while the window grows or shrinks around it. */
  const zoomAt = (t: number, factor: number) => {
    const b = buffer!, wide = clamp(span * factor, minSpan(b), b.duration);
    const start = t - (t - view.start) * (wide / span);
    window_(start, start + wide);
  };
  const pan = (by: number) => window_(view.start + by, view.end + by);
  const fit = () => setView({ start: 0, end: buffer!.duration });
  const zoomSel = () => sel && window_(sel.start, sel.end);
  const zoomed = buffer ? span < buffer.duration - 1e-6 : false;

  // --- edits --------------------------------------------------------------
  const apply = (next: AudioBuffer) => {
    stop(); setHistory(h => [...h.slice(-19), buffer!]); setFuture([]); setBuffer(next);
    if (next.duration < view.end) setView(v => ({ start: Math.min(v.start, next.duration), end: next.duration }));
  };
  const undo = () => setHistory(h => {
    if (!h.length) return h;
    stop(); setFuture(f => [buffer!, ...f].slice(0, 20)); setBuffer(h[h.length - 1]); setSel(null);
    return h.slice(0, -1);
  });
  const redo = () => setFuture(f => {
    if (!f.length) return f;
    stop(); setHistory(h => [...h.slice(-19), buffer!]); setBuffer(f[0]); setSel(null);
    return f.slice(1);
  });

  /** Edits with no selection act on the whole clip, which is what every editor does. */
  const scope = () => ({ start: sel?.start ?? 0, end: sel?.end ?? buffer!.duration, channels: sel?.channel == null ? undefined : [sel.channel] });
  const region = () => (sel ? sliceBuffer(buffer!, sel.start, sel.end) : buffer!);
  const copy = () => {
    const cut = region();
    clipboard = sel?.channel == null ? cut : pickChannels(cut, [sel.channel]);
    setHasClip(true);
  };
  const cut = () => { if (!sel) return; copy(); apply(removeRange(buffer!, sel.start, sel.end)); setCursor(sel.start); setSel(null); };
  const paste = () => { if (!clipboard) return; apply(insertBuffer(buffer!, sel ? sel.start : cursor, clipboard)); setSel(null); };
  const merge = () => { if (!clipboard) return; apply(mixBuffer(buffer!, sel ? sel.start : cursor, clipboard)); setSel(null); };
  const silence = () => { const s = scope(); apply(silenceRange(buffer!, s.start, s.end, s.channels)); };
  const fade = (dir: "in" | "out") => { const s = scope(); apply(fadeRange(buffer!, s.start, s.end, dir, s.channels)); };
  const normalize = () => { const s = scope(); apply(normalizeRange(buffer!, s.start, s.end, .99, s.channels)); };
  const louder = (up: boolean) => { const s = scope(); apply(gainRange(buffer!, s.start, s.end, up ? DB3 : 1 / DB3, s.channels)); };
  const reverse = () => { const s = scope(); apply(reverseRange(buffer!, s.start, s.end, s.channels)); };
  const trim = () => { if (!sel) return; apply(sliceBuffer(buffer!, sel.start, sel.end)); setSel(null); setCursor(0); setView({ start: 0, end: sel.end - sel.start }); };

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

  // --- playback -----------------------------------------------------------
  const stop = () => {
    try { preview.current?.src.stop(); } catch { /* already ended */ }
    void preview.current?.ctx.close(); preview.current = null; setPlaying(false); setHead(null);
  };
  /** Runs a buffer and walks the playhead across it, so you can see where you are in the clip. */
  const run = (out: AudioBuffer, from: number) => {
    const ctx = new AudioContext(), src = ctx.createBufferSource();
    src.buffer = out; src.connect(ctx.destination);
    src.onended = () => { if (preview.current?.src === src) stop(); };
    preview.current = { ctx, src }; src.start(); setPlaying(true);
    const at = ctx.currentTime;
    const tick = () => {
      if (preview.current?.src !== src) return;
      setHead(from + (ctx.currentTime - at));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  // "selection" auditions just the marked region, "original" the untouched file, "edit" everything
  // you have done so far, from the cursor.
  const previewOut = (what: "edit" | "selection" | "original") => {
    if (playing) return stop();
    if (what === "original") { if (original.current) run(original.current, 0); return; }
    const marked = what === "selection" && sel;
    const from = marked ? sel.start : clamp(cursor, 0, Math.max(0, buffer!.duration - .01));
    const to = marked ? sel.end : buffer!.duration;
    let out = sliceBuffer(buffer!, from, to);
    if (marked && sel.channel != null) out = pickChannels(out, [sel.channel]);
    run(processBuffer(out, { gains: marked && sel.channel != null ? [gains()[sel.channel]] : gains(), mono }), from);
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
  const scopeTo = (channel: number | null) => setSel(s => (s ? { ...s, channel } : s));

  /**
   * Shortcuts live on the editor, not on window: the Studio fires cues off bare keys, and a space
   * bar meant for this waveform must not also trigger the deck. stopPropagation keeps them apart.
   */
  const keys = (e: KeyboardEvent) => {
    if (!buffer) return;
    const el = e.target as HTMLElement;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable) return;
    const mod = e.ctrlKey || e.metaKey;
    const hit = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === " ") { hit(); previewOut(sel ? "selection" : "edit"); }
    else if (mod && e.key.toLowerCase() === "z") { hit(); e.shiftKey ? redo() : undo(); }
    else if (mod && e.key.toLowerCase() === "y") { hit(); redo(); }
    else if (mod && e.key.toLowerCase() === "c") { hit(); copy(); }
    else if (mod && e.key.toLowerCase() === "v") { hit(); paste(); }
    else if (mod && e.key.toLowerCase() === "x") { hit(); cut(); }
    else if (mod && e.key.toLowerCase() === "a") { hit(); setSel({ start: 0, end: buffer.duration, channel: null }); }
    else if (e.key === "Delete" || e.key === "Backspace") { hit(); cut(); }
    else if (e.key === "Escape") { hit(); setSel(null); }
    else if (e.key === "+" || e.key === "=") { hit(); zoomAt(cursor, .6); }
    else if (e.key === "-") { hit(); zoomAt(cursor, 1.6); }
    else if (e.key === "0") { hit(); fit(); }
  };

  if (loading) return <div className="glass-soft flex items-center gap-3 p-6 text-muted"><Spinner size="sm" /> Loading waveform…</div>;
  if (err) return <div className="glass-soft p-6 text-sm text-warning">Couldn’t load audio for editing: {err}</div>;
  if (!buffer) return null;

  const stereo = buffer.numberOfChannels > 1;
  const act = sel ? "selection" : "whole clip";
  return (
    <div className="glass-soft space-y-4 p-4 outline-none" tabIndex={0} onKeyDown={keys}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          Waveform, drag to select{stereo && !mono ? ", shift-drag for one channel" : ""}, click to park the playhead
        </p>
        <p className="text-xs text-muted">
          {stereo ? (buffer.numberOfChannels === 2 ? "Stereo" : `${buffer.numberOfChannels}ch`) : "Mono"} • {fmt(buffer.duration)}
          {zoomed && <> • viewing {fmt(view.start)}–{fmt(view.end)}</>}
          {sel && <> • {sel.channel == null ? "both channels" : labels[sel.channel]} {fmt(sel.start)}–{fmt(sel.end)} ({fmt(sel.end - sel.start)})</>}
        </p>
      </div>

      <canvas
        ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} onWheel={wheel}
        className="h-48 w-full cursor-crosshair touch-none rounded-xl border border-white/10 bg-black/30"
      />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted">Zoom</span>
        <Button isIconOnly size="sm" variant="bordered" aria-label="Zoom in" onPress={() => zoomAt(cursor, .6)}><ZoomIn size={14} /></Button>
        <Button isIconOnly size="sm" variant="bordered" aria-label="Zoom out" isDisabled={!zoomed} onPress={() => zoomAt(cursor, 1.6)}><ZoomOut size={14} /></Button>
        <Button size="sm" variant="bordered" isDisabled={!sel} startContent={<Maximize2 size={13} />} onPress={zoomSel}>To selection</Button>
        <Button size="sm" variant="light" isDisabled={!zoomed} onPress={fit}>Fit whole clip</Button>
        <span className="text-muted">Wheel zooms, shift-wheel scrolls</span>
      </div>

      {sel && stereo && !mono && (
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
        <Tooltip content={sel ? "Plays the marked region" : dirty ? "Plays from the playhead with every edit applied" : "Plays from the playhead"}>
          <Button size="sm" color="primary" variant="flat" startContent={playing ? <Pause size={15} /> : <Play size={15} />} onPress={() => previewOut(sel ? "selection" : "edit")}>
            {playing ? "Stop" : sel ? "Play selection" : dirty ? "Play edit" : "Play"}
          </Button>
        </Tooltip>
        {sel && !playing && (
          <Tooltip content="Plays the whole clip from the playhead">
            <Button size="sm" variant="bordered" startContent={<Play size={14} />} onPress={() => previewOut("edit")}>Play all</Button>
          </Tooltip>
        )}
        {dirty && !playing && (
          <Tooltip content="Plays the file as it was before you touched it">
            <Button size="sm" variant="light" startContent={<RotateCcw size={14} />} onPress={() => previewOut("original")}>Play original</Button>
          </Tooltip>
        )}
        <Button size="sm" variant="light" isDisabled={!history.length} startContent={<Undo2 size={14} />} onPress={undo}>Undo</Button>
        <Button size="sm" variant="light" isDisabled={!future.length} startContent={<Redo2 size={14} />} onPress={redo}>Redo</Button>
        {sel && <Button size="sm" variant="light" onPress={() => setSel(null)}>Clear selection</Button>}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
        <span className="text-xs font-semibold text-muted">Edit {act}</span>
        <Tooltip content="Copy the selection to the clipboard, it survives switching sounds">
          <Button size="sm" variant="bordered" isDisabled={!sel} startContent={<Copy size={14} />} onPress={copy}>Copy</Button>
        </Tooltip>
        <Tooltip content="Remove the selection and put it on the clipboard">
          <Button size="sm" variant="bordered" isDisabled={!sel} startContent={<Scissors size={14} />} onPress={cut}>Cut</Button>
        </Tooltip>
        <Tooltip content={hasClip ? "Splice the clipboard in at the playhead" : "Copy something first"}>
          <Button size="sm" variant="bordered" isDisabled={!hasClip} startContent={<ClipboardPaste size={14} />} onPress={paste}>Paste</Button>
        </Tooltip>
        <Tooltip content={hasClip ? "Play the clipboard on top of this sound instead of after it" : "Copy something first"}>
          <Button size="sm" variant="bordered" isDisabled={!hasClip} startContent={<Layers size={14} />} onPress={merge}>Merge</Button>
        </Tooltip>
        <Tooltip content={`Keep only the selection and throw the rest away`}>
          <Button size="sm" variant="bordered" isDisabled={!sel} startContent={<Crop size={14} />} onPress={trim}>Trim to selection</Button>
        </Tooltip>
        <Tooltip content={`Silence the ${act}`}>
          <Button size="sm" variant="bordered" startContent={<Wand2 size={14} />} onPress={silence}>Silence</Button>
        </Tooltip>
        <Tooltip content={`Ramp the ${act} up from silence`}>
          <Button size="sm" variant="bordered" startContent={<TrendingUp size={14} />} onPress={() => fade("in")}>Fade in</Button>
        </Tooltip>
        <Tooltip content={`Ramp the ${act} down to silence`}>
          <Button size="sm" variant="bordered" startContent={<TrendingDown size={14} />} onPress={() => fade("out")}>Fade out</Button>
        </Tooltip>
        <Tooltip content={`Lift the ${act} so its loudest peak just touches full scale`}>
          <Button size="sm" variant="bordered" startContent={<SignalHigh size={14} />} onPress={normalize}>Normalise</Button>
        </Tooltip>
        <Tooltip content={`+3 dB on the ${act}`}>
          <Button size="sm" variant="bordered" startContent={<Volume2 size={14} />} onPress={() => louder(true)}>Louder</Button>
        </Tooltip>
        <Tooltip content={`−3 dB on the ${act}`}>
          <Button size="sm" variant="bordered" startContent={<Volume1 size={14} />} onPress={() => louder(false)}>Quieter</Button>
        </Tooltip>
        <Tooltip content={`Play the ${act} backwards`}>
          <Button size="sm" variant="bordered" startContent={<Repeat size={14} />} onPress={reverse}>Reverse</Button>
        </Tooltip>
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
        <Switch size="sm" isSelected={mono} onValueChange={setMono}>Mix to mono</Switch>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
        <Button color="primary" isLoading={saving} startContent={history.length ? <Crop size={16} /> : <Save size={16} />} onPress={save}>Save as new sound</Button>
        <span className="text-xs text-muted">
          {dirty ? "Play already plays what you have. Saving renders a new cloud-backed WAV; the original is untouched." : "Renders a new cloud-backed WAV; the original is untouched."}
        </span>
      </div>
    </div>
  );
}
