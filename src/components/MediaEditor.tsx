import { useEffect, useState } from "react";
import { Button, Slider, Switch, Tooltip } from "../ui";
import { Download, FlipHorizontal, Play, RotateCw, Save, Type } from "lucide-react";
import Stage, { visualStyle } from "./Stage";
import { downloadAsset } from "../lib/media";
import { defaultVisual, kindOf, type Track, type Transition, type Visual } from "../types";

const TRANSITIONS: Transition[] = ["cut", "fade", "slide", "zoom"];
const SLIDE_W = 1920, SLIDE_H = 1080;

/** A blank 16:9 slide to type on. The text itself stays live in `visual.caption`, so it is still editable. */
export function blankSlide(colour = "#0b1220"): Promise<File> {
  const canvas = Object.assign(document.createElement("canvas"), { width: SLIDE_W, height: SLIDE_H });
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = colour; ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);
  return new Promise(resolve => canvas.toBlob(b => resolve(new File([b!], "slide.png", { type: "image/png" })), "image/png"));
}

/** Bakes the live look (filters, rotation, flip, caption) into a new PNG. The original is untouched. */
async function flatten(url: string, v: Visual, title: string) {
  const img = new Image(); img.crossOrigin = "anonymous"; img.src = url;
  await img.decode();
  const turned = v.rotate % 180 !== 0;
  const w = turned ? img.naturalHeight : img.naturalWidth, h = turned ? img.naturalWidth : img.naturalHeight;
  const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = canvas.getContext("2d")!;
  ctx.filter = `brightness(${v.brightness}) contrast(${v.contrast}) saturate(${v.saturate}) blur(${v.blur}px)`;
  ctx.translate(w / 2, h / 2);
  ctx.rotate(v.rotate * Math.PI / 180);
  ctx.scale(v.flipH ? -v.zoom : v.zoom, v.zoom);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (v.caption) {
    ctx.filter = "none";
    const size = Math.round(h * .07);
    ctx.font = `700 ${size}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    const grad = ctx.createLinearGradient(0, h - size * 3, 0, h);
    grad.addColorStop(0, "rgba(0,0,0,0)"); grad.addColorStop(1, "rgba(0,0,0,.8)");
    ctx.fillStyle = grad; ctx.fillRect(0, h - size * 3, w, size * 3);
    ctx.fillStyle = "#fff"; ctx.fillText(v.caption, w / 2, h - size);
  }
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/png"));
  return new File([blob!], `${title}.png`, { type: "image/png" });
}

type Ctl = { key: keyof Visual; label: string; min: number; max: number; step: number; suffix?: string };
const LOOK: Ctl[] = [
  { key: "zoom", label: "Zoom", min: .5, max: 3, step: .05, suffix: "x" },
  { key: "brightness", label: "Brightness", min: 0, max: 2, step: .05 },
  { key: "contrast", label: "Contrast", min: 0, max: 2, step: .05 },
  { key: "saturate", label: "Saturation", min: 0, max: 3, step: .05 },
  { key: "blur", label: "Blur", min: 0, max: 20, step: .5, suffix: "px" },
];

/**
 * Basic editing panel for a slide, image or video. Everything is non-destructive: the settings ride
 * with the asset and the presenter applies them. Images can additionally be flattened into a new
 * file (ponytail: video export would need ffmpeg.wasm or WebCodecs, and a trimmed cue plays the
 * same either way, so it stays a setting rather than a render).
 */
export default function MediaEditor({ track, onChange, onSave }: {
  track: Track;
  onChange: (v: Visual) => void;
  onSave: (file: File, title: string) => Promise<void>;
}) {
  const v = track.visual ?? defaultVisual();
  const kind = kindOf(track);
  const [replay, setReplay] = useState(0);
  const [duration, setDuration] = useState(0);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Visual>) => onChange({ ...v, ...patch });

  // Trim needs a length, and the stage's own <video> is mid-transition, so read it off a spare one.
  useEffect(() => {
    if (kind !== "video") return;
    const probe = document.createElement("video");
    probe.preload = "metadata"; probe.src = track.url;
    probe.onloadedmetadata = () => setDuration(probe.duration || 0);
  }, [track.url, kind]);

  const bake = async () => {
    setBusy(true);
    try { await onSave(await flatten(track.url, v, `${track.title} (edit)`), `${track.title} (edit)`); }
    catch (e) { alert(`Could not flatten this image: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip content="Play the transition again"><Button size="sm" variant="flat" startContent={<Play size={14} />} onPress={() => setReplay(n => n + 1)}>Replay transition</Button></Tooltip>
        <Tooltip content="Rotate 90 degrees"><Button size="sm" variant="flat" isIconOnly onPress={() => set({ rotate: (v.rotate + 90) % 360 })}><RotateCw size={15} /></Button></Tooltip>
        <Tooltip content="Mirror horizontally"><Button size="sm" variant={v.flipH ? "solid" : "flat"} color={v.flipH ? "primary" : "default"} isIconOnly onPress={() => set({ flipH: !v.flipH })}><FlipHorizontal size={15} /></Button></Tooltip>
        <Tooltip content="Save the current look as a new image"><span><Button size="sm" variant="bordered" isDisabled={kind !== "image" || busy} isLoading={busy} startContent={<Save size={14} />} onPress={bake}>Flatten to new image</Button></span></Tooltip>
        <Tooltip content="Download the original file"><Button size="sm" variant="light" startContent={<Download size={14} />} onPress={() => void downloadAsset(track.url, track.title)}>Download</Button></Tooltip>
        <Button size="sm" variant="light" onPress={() => onChange(defaultVisual())}>Reset</Button>
      </div>

      <Stage stage={{ url: track.url, kind, visual: v, label: track.title, n: replay }} className="aspect-video w-full rounded-2xl border border-border" />

      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs text-muted">Transition in</span>
          <select value={v.transition} onChange={e => set({ transition: e.target.value as Transition })}
            className="w-full rounded-xl border border-border bg-surface/60 px-3 py-2 text-sm capitalize outline-none focus:border-accent">
            {TRANSITIONS.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">Fill the screen</span>
          <select value={v.fit} onChange={e => set({ fit: e.target.value as Visual["fit"] })}
            className="w-full rounded-xl border border-border bg-surface/60 px-3 py-2 text-sm outline-none focus:border-accent">
            <option value="contain">Fit inside (letterbox)</option>
            <option value="cover">Fill and crop</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 flex items-center gap-1 text-xs text-muted"><Type size={12} />Caption on the slide</span>
          <input value={v.caption} onChange={e => set({ caption: e.target.value })} placeholder="Optional text over the media"
            className="w-full rounded-xl border border-border bg-surface/60 px-3 py-2 text-sm outline-none focus:border-accent" />
        </label>
        {LOOK.map(c => (
          <Slider key={c.key} size="sm" color="primary" label={c.label} minValue={c.min} maxValue={c.max} step={c.step}
            value={Number(v[c.key])} onChange={n => set({ [c.key]: Array.isArray(n) ? n[0] : n } as Partial<Visual>)}
            getValue={n => `${Number(n).toFixed(2)}${c.suffix ?? ""}`} />
        ))}
        <Slider size="sm" color="primary" label="Rotate" minValue={0} maxValue={359} step={1} value={v.rotate}
          onChange={n => set({ rotate: Array.isArray(n) ? n[0] : n })} getValue={n => `${n}°`} />
      </div>

      {kind === "video" && (
        <div className="glass-soft space-y-4 p-4">
          <p className="text-sm font-semibold">Video trim</p>
          <Slider size="sm" color="primary" label="Start at" minValue={0} maxValue={Math.max(duration, .1)} step={.1} value={v.trimIn}
            onChange={n => set({ trimIn: Array.isArray(n) ? n[0] : n })} getValue={n => `${Number(n).toFixed(1)}s`} />
          <Slider size="sm" color="primary" label="End at" minValue={0} maxValue={Math.max(duration, .1)} step={.1} value={v.trimOut || duration}
            onChange={n => set({ trimOut: Array.isArray(n) ? n[0] : n })} getValue={n => `${Number(n).toFixed(1)}s`} />
          <Slider size="sm" color="primary" label="Speed" minValue={.25} maxValue={2} step={.05} value={v.rate}
            onChange={n => set({ rate: Array.isArray(n) ? n[0] : n })} getValue={n => `${Number(n).toFixed(2)}x`} />
          <div className="flex flex-wrap gap-6">
            <Switch size="sm" isSelected={v.muted} onValueChange={m => set({ muted: m })}>Mute</Switch>
            <Switch size="sm" isSelected={v.loop} onValueChange={l => set({ loop: l })}>Loop the trimmed section</Switch>
          </div>
        </div>
      )}
    </div>
  );
}
