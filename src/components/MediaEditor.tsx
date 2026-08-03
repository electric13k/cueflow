import { useEffect, useState } from "react";
import { Button, Slider, Switch, Tooltip } from "../ui";
import { Crop, Download, FlipHorizontal, Play, RotateCw, Save, Type } from "lucide-react";
import Stage from "./Stage";
import CropBox from "./CropBox";
import Filmstrip from "./Filmstrip";
import { downloadAsset } from "../lib/media";
import { cropImage, flatten, type Rect } from "../lib/image";
import { defaultVisual, kindOf, type Track, type Transition, type Visual } from "../types";

const TRANSITIONS: Transition[] = ["cut", "fade", "slide", "zoom"];

type Ctl = { key: keyof Visual; label: string; min: number; max: number; step: number; suffix?: string; decimals?: number };
/**
 * Ordered the way darktable and Krita order their basic panels: get the exposure right, then the
 * contrast, then the colour, then the local effects. Adjusting in that order means each control
 * still reads true after the one before it.
 */
const LOOK: Ctl[] = [
  { key: "brightness", label: "Exposure", min: 0, max: 2, step: .05 },
  { key: "contrast", label: "Contrast", min: 0, max: 2, step: .05 },
  { key: "saturate", label: "Saturation", min: 0, max: 3, step: .05 },
  { key: "temp", label: "Warmth", min: -100, max: 100, step: 1, decimals: 0 },
  { key: "vignette", label: "Vignette", min: 0, max: 1, step: .02 },
  { key: "zoom", label: "Zoom", min: .5, max: 3, step: .05, suffix: "x" },
  { key: "blur", label: "Blur", min: 0, max: 20, step: .5, suffix: "px", decimals: 0 },
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
  const [cropping, setCropping] = useState(false);
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

  const crop = async (rect: Rect) => {
    setCropping(false);
    setBusy(true);
    const title = `${track.title} (crop)`;
    try { await onSave(await cropImage(track.url, rect, title), title); }
    catch (e) { alert(`Could not crop this image: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  if (cropping) return <CropBox url={track.url} onCancel={() => setCropping(false)} onApply={r => void crop(r)} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip content="Play the transition again"><Button size="sm" variant="flat" startContent={<Play size={14} />} onPress={() => setReplay(n => n + 1)}>Replay transition</Button></Tooltip>
        <Tooltip content="Rotate 90 degrees"><Button size="sm" variant="flat" isIconOnly onPress={() => set({ rotate: (v.rotate + 90) % 360 })}><RotateCw size={15} /></Button></Tooltip>
        <Tooltip content="Mirror horizontally"><Button size="sm" variant={v.flipH ? "solid" : "flat"} color={v.flipH ? "primary" : "default"} isIconOnly onPress={() => set({ flipH: !v.flipH })}><FlipHorizontal size={15} /></Button></Tooltip>
        <Tooltip content="Keep part of the picture as a new image"><span><Button size="sm" variant="flat" isDisabled={kind !== "image"} startContent={<Crop size={14} />} onPress={() => setCropping(true)}>Crop</Button></span></Tooltip>
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
            value={Number(v[c.key]) || 0} onChange={n => set({ [c.key]: Array.isArray(n) ? n[0] : n } as Partial<Visual>)}
            getValue={n => `${Number(n).toFixed(c.decimals ?? 2)}${c.suffix ?? ""}`} />
        ))}
        <Slider size="sm" color="primary" label="Rotate" minValue={0} maxValue={359} step={1} value={v.rotate}
          onChange={n => set({ rotate: Array.isArray(n) ? n[0] : n })} getValue={n => `${n}°`} />
      </div>

      {kind === "video" && (
        <div className="glass-soft space-y-4 p-4">
          <p className="text-sm font-semibold">Trim</p>
          <Filmstrip url={track.url} duration={duration} trimIn={v.trimIn} trimOut={v.trimOut} onChange={set} />
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
