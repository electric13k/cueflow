import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, { type Region } from "wavesurfer.js/plugins/regions";
import TimelinePlugin from "wavesurfer.js/plugins/timeline";
import EnvelopePlugin, { type EnvelopePoint } from "wavesurfer.js/plugins/envelope";
import { Button, Slider, Spinner, Switch, Tooltip } from "../ui";
import {
  Check, ClipboardPaste, Copy, Crop, Layers, Maximize2, Pause, Play, Repeat, RotateCcw, Save, Scissors,
  Flag, SignalHigh, Spline, Split, TrendingDown, TrendingUp, Undo2, Redo2, Trash2, Volume1, Volume2, VolumeX, Wand2, X, ZoomIn, ZoomOut,
} from "lucide-react";
import {
  bufferToWavFile, decodeAudioUrl, fadeRange, gainRange, insertBuffer, mixBuffer, normalizeRange,
  pickChannels, processBuffer, removeRange, reverseRange, silenceRange, sliceBuffer, toStereo,
} from "../lib/audio";
import {
  applyEnvelope, commit, flatEnvelope, redo as redoStack, stack, undo as undoStack, type EnvPoint, type Stack,
} from "../lib/audioEdit";
import { useThemeSignal } from "../lib/theme";

type Chan = { gain: number; mute: boolean };
type Sel = { start: number; end: number; channel: number | null }; // channel null = every channel
type Marker = { id: string; time: number; label: string };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const fmt = (s: number) => `${s.toFixed(2)}s`;
const MONO_FONT = `"Courier Prime", ui-monospace, monospace`;
const DB3 = Math.SQRT2;                 // +3 dB, the step every mixer uses
const MIN_REGION = .005;

/**
 * wavesurfer.js draws into a canvas of its own, so the palette has to be handed to it as plain
 * colour strings and handed to it again whenever the theme moves what those tokens resolve to.
 * Read off the *editor's own element*, not off <html>: custom properties inherit, so a `.theme-dark`
 * wrapper re-themes the waveform exactly the way it re-themes the DOM around it.
 */
function triplet(v: string, fallback: string) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (!m) return fallback;
  const h = m[1].length === 3 ? m[1].replace(/./g, c => c + c) : m[1];
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).join(",");
}
function palette(el: Element) {
  const cs = getComputedStyle(el);
  const token = (name: string) => cs.getPropertyValue(name).trim() || "#888";
  const fg = triplet(token("--foreground"), "36,31,28");
  return { token, ink: (alpha: number) => `rgba(${fg}, ${alpha})` };
}

// Module-level so a copied region survives switching to another sound, that is the whole point of
// having a clipboard rather than an in-place trim.
let clipboard: AudioBuffer | null = null;

export default function WaveformEditor({ track, onSave, onPreview }: {
  track: { id: string; title: string; url: string };
  onSave: (file: File, title: string) => Promise<void>;
  /** Hands the unsaved working buffer to the main player as a blob URL ("" once it matches the original). */
  onPreview?: (url: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const theme = useThemeSignal(); // changes when the palette does; the instance is rebuilt on it
  const [hist, setHist] = useState<Stack<AudioBuffer> | null>(null); // the working copy and its undo history
  /** An effect lands here first: drawn, played and handed to the transport, but not yet in the history. */
  const [pending, setPending] = useState<{ steps: string[]; buffer: AudioBuffer } | null>(null);
  const [env, setEnv] = useState<EnvPoint[] | null>(null); // gain over time; null = the tool is off
  const committed = hist?.present ?? null;
  // Everything downstream -- draw, play, save -- reads this, so a staged effect previews itself.
  const buffer = pending?.buffer ?? committed;
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<Sel | null>(null);
  const [chan, setChan] = useState<Chan[]>([]);
  const [mono, setMono] = useState(false);
  const [saving, setSaving] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [hasClip, setHasClip] = useState(!!clipboard);
  const [zoom, setZoom] = useState(1);          // multiple of the fit-the-window scale
  const [at, setAt] = useState(0);              // where the wavesurfer cursor is, in seconds
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [ws, setWs] = useState<WaveSurfer | null>(null);
  const regions = useRef<RegionsPlugin | null>(null);
  const region = useRef<Region | null>(null);
  const envPlugin = useRef<EnvelopePlugin | null>(null);
  const previewUrl = useRef("");                 // blob URL currently handed to the main player
  const audition = useRef<HTMLAudioElement | null>(null); // A/B against the untouched file
  // The region has to survive the reload that every edit triggers, and only this ref is current
  // inside the load callback.
  const keepSel = useRef<Sel | null>(null);
  keepSel.current = sel;

  useEffect(() => {
    let alive = true; setLoading(true); setErr(""); setSel(null); setHist(null); setPending(null); setEnv(null); setMarkers([]);
    decodeAudioUrl(track.url)
      .then(b => {
        if (!alive) return;
        setHist(stack(b));
        setChan(Array.from({ length: b.numberOfChannels }, () => ({ gain: 1, mute: false })));
      })
      .catch(e => alive && setErr((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [track.id, track.url]);

  const labels = buffer?.numberOfChannels === 2 ? ["Left", "Right"]
    : buffer?.numberOfChannels === 1 ? ["Mono"] : chan.map((_, i) => `Ch ${i + 1}`);
  const short = (i: number) => (labels[i] ?? "").slice(0, 1).toUpperCase() || String(i + 1);

  // Converting to stereo changes the channel count, so the level strip has to follow it.
  useEffect(() => {
    if (!buffer) return;
    setChan(cs => cs.length === buffer.numberOfChannels ? cs
      : Array.from({ length: buffer.numberOfChannels }, (_, i) => cs[i] ?? { gain: 1, mute: false }));
  }, [buffer]);

  const ready = !loading && !err && !!committed;

  /**
   * One wavesurfer per theme. Rebuilding rather than patching is the cheap correct move: the
   * timeline and the region overlays hold their colours from construction, and a theme flip is a
   * once-in-a-session event, not a frame.
   */
  useEffect(() => {
    const el = host.current;
    if (!ready || !el) return;
    const { token, ink } = palette(el);
    const rp = RegionsPlugin.create();
    const w = WaveSurfer.create({
      container: el,
      height: 160,
      waveColor: token("--cue-audio"),
      progressColor: ink(.5),
      cursorColor: token("--cue-live"),
      cursorWidth: 2,
      splitChannels: [],
      fillParent: true,
      dragToSeek: true,
      plugins: [rp, TimelinePlugin.create({
        height: 16, timeInterval: .5, primaryLabelInterval: 5,
        style: { fontSize: "10px", fontFamily: MONO_FONT, color: ink(.7) },
      })],
    });
    regions.current = rp;
    rp.enableDragSelection({ color: ink(.16) });
    rp.on("region-created", r => {
      for (const other of rp.getRegions()) if (other !== r) other.remove();
      region.current = r;
      setSel(s => ({ start: r.start, end: r.end, channel: s?.channel ?? null }));
    });
    rp.on("region-updated", r => setSel(s => ({ start: r.start, end: r.end, channel: s?.channel ?? null })));
    w.on("play", () => setPlaying(true));
    w.on("pause", () => setPlaying(false));
    w.on("finish", () => setPlaying(false));
    w.on("timeupdate", t => setAt(t));
    w.on("interaction", t => setAt(t));
    setWs(w);
    return () => { setWs(null); regions.current = null; region.current = null; envPlugin.current = null; w.destroy(); };
  }, [ready, theme]);

  const gains = () => chan.map(c => (c.mute ? 0 : c.gain));
  const buildOutput = () => processBuffer(buffer!, { gains: gains(), mono });
  const dirty = !!hist?.past.length || !!pending || mono || chan.some(c => c.mute || c.gain !== 1);

  /**
   * The rendered output is what the waveform shows, what the editor plays and what the main
   * transport gets, all off one encode. Debounced, because dragging a level fader would otherwise
   * re-encode the whole file per frame.
   */
  useEffect(() => {
    if (!ws || !buffer) return;
    const t = setTimeout(() => {
      const file = bufferToWavFile(buildOutput(), track.title);
      const url = URL.createObjectURL(file);
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = url;
      onPreview?.(dirty ? url : "");
      void ws.load(url).then(() => {
        // A reload throws the overlays away, so the marked region has to be put back on it.
        const keep = keepSel.current;
        regions.current?.clearRegions();
        region.current = keep && regions.current
          ? regions.current.addRegion({ start: keep.start, end: keep.end, drag: true, resize: true })
          : null;
      }).catch(() => { /* superseded by the next load, or the editor closed */ });
    }, 200);
    return () => clearTimeout(t);
  }, [ws, buffer, chan, mono]);

  // Drop the blob and put the original back the moment the editor goes away.
  useEffect(() => () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = ""; onPreview?.("");
    audition.current?.pause();
  }, []);

  // --- zoom ---------------------------------------------------------------
  /** zoom 1 is the whole clip across the pane; above that wavesurfer scrolls it. */
  useEffect(() => {
    if (!ws || !host.current) return;
    const fit = host.current.clientWidth / Math.max(ws.getDuration() || 1, .001);
    try { ws.zoom(fit * zoom); } catch { /* not decoded yet, the next load re-applies it */ }
  }, [ws, zoom, buffer]);
  const zoomBy = (factor: number) => setZoom(z => clamp(z * factor, 1, 64));

  // --- selection ----------------------------------------------------------
  const clearSel = () => { regions.current?.clearRegions(); region.current = null; setSel(null); };
  /** The only way onto the waveform without a mouse: put a region on screen, then move its handles. */
  const markRegion = () => {
    const rp = regions.current, d = ws?.getDuration() ?? 0;
    if (!rp || !d) return;
    rp.clearRegions();
    region.current = rp.addRegion({ start: d * .25, end: d * .75, drag: true, resize: true });
  };
  const scopeTo = (channel: number | null) => setSel(s => (s ? { ...s, channel } : s));
  const addMarker = () => {
    if (!buffer) return;
    const time = clamp(at, 0, buffer.duration);
    const label = window.prompt("Marker name", `Marker ${markers.length + 1}`)?.trim();
    if (!label) return;
    setMarkers(all => [...all, { id: crypto.randomUUID(), time, label }].sort((a, b) => a.time - b.time));
  };
  const jumpToMarker = (marker: Marker) => { ws?.setTime(marker.time); setAt(marker.time); };
  const removeMarker = (id: string) => setMarkers(all => all.filter(marker => marker.id !== id));

  // --- envelope -----------------------------------------------------------
  /**
   * The envelope tool is wavesurfer's own: double-click the lane to add a point, drag one to move
   * it. Gains run 0..1, so it attenuates; "Louder" is the tool for the other direction.
   */
  const envelope = () => {
    if (!ws) return;
    if (envPlugin.current) { envPlugin.current.destroy(); envPlugin.current = null; setEnv(null); return; }
    const points = flatEnvelope(ws.getDuration());
    const { token } = palette(host.current!);
    const p = ws.registerPlugin(EnvelopePlugin.create({
      points: points.map(toEnvelopePoint), lineColor: token("--cue-curtain"), lineWidth: "2",
      dragPointSize: 18, dragPointFill: token("--cue-curtain"), dragPointStroke: token("--background"),
    }));
    p.on("points-change", pts => setEnv(pts.map(q => ({ t: q.time, g: q.volume })).sort((a, b) => a.t - b.t)));
    envPlugin.current = p;
    setEnv(points);
  };
  const flatten = () => {
    if (!ws || !envPlugin.current) return;
    const points = flatEnvelope(ws.getDuration());
    envPlugin.current.setPoints(points.map(toEnvelopePoint));
    setEnv(points);
  };
  const previewEnv = () => {
    if (!env || !buffer) return;
    stage("gain envelope", applyEnvelope(buffer, env));
    envPlugin.current?.destroy(); envPlugin.current = null; setEnv(null);
  };

  // --- edits --------------------------------------------------------------
  /** Commits a buffer: one history step, and whatever was staged is now owned. */
  const apply = (next: AudioBuffer) => { stop(); setPending(null); setHist(h => (h ? commit(h, next) : stack(next))); };
  /**
   * An effect you can hear before you own it. Staged on top of what is already on screen, so a
   * fade and a normalise preview together, and the whole run commits as one undo step.
   */
  const stage = (label: string, next: AudioBuffer) => {
    stop(); setPending(p => ({ steps: [...(p?.steps ?? []), label], buffer: next }));
  };
  const keep = () => { if (pending) apply(pending.buffer); };
  const drop = () => { stop(); setPending(null); };
  const undo = () => { stop(); clearSel(); setPending(null); setHist(h => h && undoStack(h)); };
  const redo = () => { stop(); clearSel(); setPending(null); setHist(h => h && redoStack(h)); };
  const canUndo = !!hist?.past.length, canRedo = !!hist?.future.length;

  /** Edits with no selection act on the whole clip, which is what every editor does. */
  const scope = () => ({ start: sel?.start ?? 0, end: sel?.end ?? buffer!.duration, channels: sel?.channel == null ? undefined : [sel.channel] });
  const copy = () => {
    const cut = sel ? sliceBuffer(buffer!, sel.start, sel.end) : buffer!;
    clipboard = sel?.channel == null ? cut : pickChannels(cut, [sel.channel]);
    setHasClip(true);
  };
  const cut = () => { if (!sel) return; copy(); const s = sel; clearSel(); apply(removeRange(buffer!, s.start, s.end)); };
  const paste = () => { if (!clipboard) return; const start = sel?.start ?? at; clearSel(); apply(insertBuffer(buffer!, start, clipboard)); };
  const merge = () => { if (!clipboard) return; const start = sel?.start ?? at; clearSel(); apply(mixBuffer(buffer!, start, clipboard)); };
  // Effects stage rather than commit: you hear them first, then Apply or Cancel.
  const silence = () => { const s = scope(); stage("silence", silenceRange(buffer!, s.start, s.end, s.channels)); };
  const fade = (dir: "in" | "out") => { const s = scope(); stage(`fade ${dir}`, fadeRange(buffer!, s.start, s.end, dir, s.channels)); };
  const normalize = () => { const s = scope(); stage("normalise", normalizeRange(buffer!, s.start, s.end, .99, s.channels)); };
  const louder = (up: boolean) => { const s = scope(); stage(up ? "+3 dB" : "-3 dB", gainRange(buffer!, s.start, s.end, up ? DB3 : 1 / DB3, s.channels)); };
  const reverse = () => { const s = scope(); stage("reverse", reverseRange(buffer!, s.start, s.end, s.channels)); };
  const trim = () => { if (!sel) return; const s = sel; clearSel(); setZoom(1); apply(sliceBuffer(buffer!, s.start, s.end)); };

  // --- playback -----------------------------------------------------------
  const stop = () => { ws?.pause(); audition.current?.pause(); audition.current = null; setPlaying(false); };
  /** "selection" auditions just the marked region, "original" the untouched file, "edit" the rest. */
  const previewOut = (what: "edit" | "selection" | "original") => {
    if (playing || audition.current) return stop();
    if (what === "original") {
      const a = new Audio(track.url);
      a.onended = () => { audition.current = null; setPlaying(false); };
      audition.current = a; setPlaying(true); void a.play().catch(() => stop());
      return;
    }
    if (what === "selection" && region.current) return region.current.play(true);
    void ws?.play();
  };

  const save = async () => {
    setSaving(true);
    try {
      const edited = canUndo || !!pending;
      const suffix = edited ? " (edit)" : mono ? " (mono)" : " (copy)";
      const title = `${track.title}${suffix}`;
      await onSave(bufferToWavFile(buildOutput(), title), title);
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  const setC = (i: number, p: Partial<Chan>) => setChan(cs => cs.map((c, j) => (j === i ? { ...c, ...p } : c)));

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
    else if (mod && e.key.toLowerCase() === "a") { hit(); markRegion(); }
    else if (e.key === "Delete" || e.key === "Backspace") { hit(); cut(); }
    else if (e.key === "Enter" && pending) { hit(); keep(); }
    else if (e.key === "Escape") { hit(); if (pending) drop(); else clearSel(); }
    else if (e.key === "+" || e.key === "=") { hit(); zoomBy(1.6); }
    else if (e.key === "-") { hit(); zoomBy(.6); }
    else if (e.key === "0") { hit(); setZoom(1); }
  };

  if (loading) return <div className="glass-soft flex items-center gap-3 p-6 text-muted"><Spinner size="sm" /> Loading waveform…</div>;
  if (err) return <div className="glass-soft p-6 text-sm text-warning">Couldn’t load audio for editing: {err}</div>;
  if (!buffer) return null;

  const stereo = buffer.numberOfChannels > 1;
  const act = sel ? "selection" : "whole clip";
  const tooShort = !!sel && sel.end - sel.start < MIN_REGION;
  return (
    <div className="glass-soft space-y-4 p-4 outline-none" tabIndex={0} onKeyDown={keys}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          Waveform by wavesurfer.js. Drag across it to mark a region, drag the region’s edges to trim it, click to park the playhead.
        </p>
        <p className="text-xs text-muted">
          {stereo ? (buffer.numberOfChannels === 2 ? "Stereo" : `${buffer.numberOfChannels}ch`) : "Mono"} • {fmt(buffer.duration)} • at {fmt(at)}
          {sel && <> • {sel.channel == null ? "both channels" : labels[sel.channel]} {fmt(sel.start)}–{fmt(sel.end)} ({fmt(sel.end - sel.start)})</>}
        </p>
      </div>

      <div ref={host} className="w-full overflow-hidden rounded-xl border border-white/10 bg-black/30 p-1" />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted">Zoom</span>
        <Tooltip content="Show less of the clip, in more detail">
          <Button isIconOnly size="sm" variant="bordered" aria-label="Zoom in" onPress={() => zoomBy(1.6)}><ZoomIn size={14} /></Button>
        </Tooltip>
        <Tooltip content="Show more of the clip">
          <span><Button isIconOnly size="sm" variant="bordered" aria-label="Zoom out" isDisabled={zoom <= 1} onPress={() => zoomBy(.6)}><ZoomOut size={14} /></Button></span>
        </Tooltip>
        <Tooltip content="Zoom until the marked region fills the pane">
          <span><Button size="sm" variant="bordered" isDisabled={!sel} startContent={<Maximize2 size={13} />}
            onPress={() => sel && setZoom(clamp(buffer.duration / Math.max(sel.end - sel.start, .01), 1, 64))}>To selection</Button></span>
        </Tooltip>
        <Tooltip content="Put a region on screen so it can be moved with the handles instead of drawn with a mouse">
          <Button size="sm" variant={sel ? "light" : "bordered"} startContent={<Crop size={13} />} onPress={markRegion}>Mark region</Button>
        </Tooltip>
        <Tooltip content="Fit the whole clip across the pane">
          <span><Button size="sm" variant="light" isDisabled={zoom <= 1} onPress={() => setZoom(1)}>Fit whole clip</Button></span>
        </Tooltip>
        <Tooltip content="Draw gain over time, the way a mixing desk rides a fader">
          <Button size="sm" variant={env ? "light" : "bordered"} startContent={<Spline size={13} />} onPress={envelope}>
            {env ? "Close envelope" : "Gain envelope"}
          </Button>
        </Tooltip>
        <Tooltip content="Name the current playhead position for a later cue">
          <Button size="sm" variant="bordered" startContent={<Flag size={13} />} onPress={addMarker}>Add marker</Button>
        </Tooltip>
      </div>

      {markers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-armed/30 bg-armed/10 p-2 text-xs">
          <span className="font-semibold">Markers</span>
          {markers.map(marker => (
            <span key={marker.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface/70 pl-2">
              <button type="button" className="py-1 font-mono text-[11px] hover:text-accent" onClick={() => jumpToMarker(marker)}>
                {marker.label} {fmt(marker.time)}
              </button>
              <button type="button" aria-label={`Remove ${marker.label}`} className="p-1 text-muted hover:text-foreground" onClick={() => removeMarker(marker.id)}><Trash2 size={12} /></button>
            </span>
          ))}
        </div>
      )}

      {env && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-curtain/40 bg-curtain/10 p-2 text-xs">
          <span className="font-semibold">Gain over time</span>
          <span className="text-muted">Drag a dot, double-click the lane to add one. The line rides from 0 to full.</span>
          <Tooltip content="Bake the curve into the working copy, where it can still be undone">
            <Button size="sm" variant="bordered" startContent={<Play size={13} />} onPress={previewEnv}>Preview envelope</Button>
          </Tooltip>
          <Tooltip content="Put every point back at full gain">
            <Button size="sm" variant="light" onPress={flatten}>Flatten</Button>
          </Tooltip>
        </div>
      )}

      {pending && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-visual/40 bg-visual/10 p-2 text-xs">
          <span className="font-semibold">Previewing: {pending.steps.join(" → ")}</span>
          <span className="text-muted">Play hears it, nothing is committed until you apply.</span>
          <Button size="sm" color="primary" variant="flat" startContent={<Check size={14} />} onPress={keep}>Apply</Button>
          <Button size="sm" variant="light" startContent={<X size={14} />} onPress={drop}>Cancel</Button>
        </div>
      )}

      {sel && stereo && !mono && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">Selection covers:</span>
          {[null, ...chan.map((_, i) => i)].map(c => (
            <button key={String(c)} onClick={() => scopeTo(c as number | null)}
              title={c == null ? "Edits hit every channel" : `Edits hit ${labels[c as number]} only`}
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
        <Tooltip content="Step back one edit">
          <span><Button size="sm" variant="light" isDisabled={!canUndo} startContent={<Undo2 size={14} />} onPress={undo}>Undo</Button></span>
        </Tooltip>
        <Tooltip content="Put back the edit you just undid">
          <span><Button size="sm" variant="light" isDisabled={!canRedo} startContent={<Redo2 size={14} />} onPress={redo}>Redo</Button></span>
        </Tooltip>
        {sel && <Button size="sm" variant="light" onPress={clearSel}>Clear selection</Button>}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
        <span className="text-xs font-semibold text-muted">Edit {act}</span>
        <Tooltip content="Copy the selection to the clipboard, it survives switching sounds">
          <span><Button size="sm" variant="bordered" isDisabled={!sel || tooShort} startContent={<Copy size={14} />} onPress={copy}>Copy</Button></span>
        </Tooltip>
        <Tooltip content="Remove the selection and put it on the clipboard">
          <span><Button size="sm" variant="bordered" isDisabled={!sel || tooShort} startContent={<Scissors size={14} />} onPress={cut}>Cut</Button></span>
        </Tooltip>
        <Tooltip content={hasClip ? "Splice the clipboard in at the playhead" : "Copy something first"}>
          <span><Button size="sm" variant="bordered" isDisabled={!hasClip} startContent={<ClipboardPaste size={14} />} onPress={paste}>Paste</Button></span>
        </Tooltip>
        <Tooltip content={hasClip ? "Play the clipboard on top of this sound instead of after it" : "Copy something first"}>
          <span><Button size="sm" variant="bordered" isDisabled={!hasClip} startContent={<Layers size={14} />} onPress={merge}>Merge</Button></span>
        </Tooltip>
        <Tooltip content="Keep only the selection and throw the rest away">
          <span><Button size="sm" variant="bordered" isDisabled={!sel || tooShort} startContent={<Crop size={14} />} onPress={trim}>Trim to selection</Button></span>
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
        <Tooltip content={`-3 dB on the ${act}`}>
          <Button size="sm" variant="bordered" startContent={<Volume1 size={14} />} onPress={() => louder(false)}>Quieter</Button>
        </Tooltip>
        <Tooltip content={`Play the ${act} backwards`}>
          <Button size="sm" variant="bordered" startContent={<Repeat size={14} />} onPress={reverse}>Reverse</Button>
        </Tooltip>
        {!stereo && (
          <Tooltip content="Turns this mono clip into two channels, widened slightly. Affects the whole clip.">
            <Button size="sm" variant="bordered" startContent={<Split size={14} />} onPress={() => apply(toStereo(buffer))}>To stereo</Button>
          </Tooltip>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {chan.map((c, i) => (
          <div key={i} className="rounded-xl border border-white/10 bg-white/[.03] p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium">
                <span className="grid h-5 w-5 place-items-center rounded-md bg-accent/15 text-[10px] font-bold text-accent">{short(i)}</span>
                {labels[i]}
              </span>
              <Tooltip content={`${c.mute ? "Unmute" : "Mute"} ${labels[i]}`}>
                <Button isIconOnly size="sm" variant={c.mute ? "solid" : "light"} color={c.mute ? "danger" : "default"} aria-label={`${c.mute ? "Unmute" : "Mute"} ${labels[i]}`} onPress={() => setC(i, { mute: !c.mute })}>{c.mute ? <VolumeX size={14} /> : <Volume2 size={14} />}</Button>
              </Tooltip>
            </div>
            <Slider size="sm" color="primary" aria-label={`${labels[i]} gain`} minValue={0} maxValue={2} step={0.05} isDisabled={c.mute} value={c.gain} onChange={v => setC(i, { gain: Array.isArray(v) ? v[0] : v })} getValue={v => `${Number(v).toFixed(2)}x`} />
          </div>
        ))}
        <Switch size="sm" isSelected={mono} onValueChange={setMono}>Mix to mono</Switch>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
        <Tooltip content="Renders what you are hearing to a new WAV in the library">
          <Button color="primary" isLoading={saving} startContent={canUndo ? <Crop size={16} /> : <Save size={16} />} onPress={save}>Save as new sound</Button>
        </Tooltip>
        <span className="text-xs text-muted">
          {dirty ? "Play already plays what you have. Saving renders a new cloud-backed WAV; the original is untouched." : "Renders a new cloud-backed WAV; the original is untouched."}
        </span>
      </div>
    </div>
  );
}

const toEnvelopePoint = (p: EnvPoint): EnvelopePoint => ({ time: p.t, volume: Math.max(0, Math.min(1, p.g)) });
