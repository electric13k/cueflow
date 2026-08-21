import { useEffect, useState } from "react";
import { Button, Select, Slider, Switch, Tab, Tabs, Tooltip } from "../ui";
import { Crop, Download, FlipHorizontal, Play, RotateCcw, RotateCw, Save, Type } from "lucide-react";
import Stage from "./Stage";
import CropBox from "./CropBox";
import Filmstrip from "./Filmstrip";
import { downloadAsset } from "../lib/media";
import {
  MODULES, flatten, moduleTouched, resetModule, toggleModule,
  type Bypassed, type ImageModule,
} from "../lib/image";
import { defaultVisual, kindOf, type Track, type Transition, type Visual } from "../types";

const TRANSITIONS: Transition[] = ["cut", "fade", "slide", "zoom"];

/**
 * One panel of the adjustment stack: a switch that bypasses it, a reset that touches nothing else,
 * and its sliders. The number is the position in the pipeline, and it is not draggable on purpose --
 * see the note on MODULES in lib/image.ts.
 */
function ModulePanel({ m, v, off, onVisual, onToggle, children }: {
  m: ImageModule; v: Visual; off: Bypassed;
  onVisual: (v: Visual) => void; onToggle: () => void; children?: React.ReactNode;
}) {
  const on = !off[m.id];
  return (
    <div className="glass-soft space-y-3 rounded-2xl p-3">
      <div className="flex items-center gap-2">
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-border text-[10px] tabular-nums text-muted">
          {MODULES.indexOf(m) + 1}
        </span>
        <Switch size="sm" isSelected={on} onValueChange={onToggle}>{m.label}</Switch>
        <span className="hidden text-xs text-muted sm:inline">{m.hint}</span>
        <Tooltip content={`Reset ${m.label.toLowerCase()}`}>
          <span className="ml-auto">
            <Button size="sm" variant="light" isIconOnly isDisabled={!on || !moduleTouched(v, m)}
              onPress={() => onVisual(resetModule(v, m))}><RotateCcw size={14} /></Button>
          </span>
        </Tooltip>
      </div>
      {on && (
        <div className="space-y-3">
          {children}
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {m.ctl.map(c => (
              <Slider key={c.key} size="sm" color="primary" label={c.label} minValue={c.min} maxValue={c.max} step={c.step}
                value={Number(v[c.key]) || 0} onChange={n => onVisual({ ...v, ...({ [c.key]: Array.isArray(n) ? n[0] : n } as Partial<Visual>) })}
                getValue={n => `${Number(n).toFixed(c.decimals ?? 2)}${c.suffix ?? ""}`} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Basic editing panel for a slide, image or video. Everything is non-destructive: the settings ride
 * with the asset and the presenter applies them. Images can additionally be flattened into a new
 * file (ponytail: video export would need ffmpeg.wasm or WebCodecs, and a trimmed cue plays the
 * same either way, so it stays a setting rather than a render).
 *
 * The look is a stack of ordered modules, not a wall of sliders, and the pane split is Krita's:
 * what changes the frame is separate from what changes the pixels.
 */
export default function MediaEditor({ track, cues = [], onChange, onSave }: {
  track: Track;
  /** Trim edges cues already made from this track, for the filmstrip handles to snap to. */
  cues?: number[];
  onChange: (v: Visual) => void;
  onSave: (file: File, title: string) => Promise<void>;
}) {
  const v = track.visual ?? defaultVisual();
  const kind = kindOf(track);
  const [replay, setReplay] = useState(0);
  const [duration, setDuration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [pane, setPane] = useState("geometry");
  const [off, setOff] = useState<Bypassed>({});
  const set = (patch: Partial<Visual>) => onChange({ ...v, ...patch });
  const toggle = (m: ImageModule) => {
    const [next, bypassed] = toggleModule(v, m, off);
    setOff(bypassed);
    onChange(next);
  };

  // A bypassed module's stashed values belong to the asset they came off, so a new asset starts clean.
  useEffect(() => setOff({}), [track.id]);

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

  // Cropper.js owns the crop itself and hands back a finished file, so there is nothing to redraw here.
  const crop = async (file: File) => {
    setCropping(false);
    setBusy(true);
    try { await onSave(file, `${track.title} (crop)`); }
    catch (e) { alert(`Could not crop this image: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  const stack = (which: ImageModule["pane"]) => MODULES.filter(m => m.pane === which).map(m => (
    <ModulePanel key={m.id} m={m} v={v} off={off} onVisual={onChange} onToggle={() => toggle(m)}>
      {m.id === "orientation" && (
        <div className="flex flex-wrap gap-2">
          <Tooltip content="Rotate 90 degrees"><Button size="sm" variant="flat" startContent={<RotateCw size={15} />} onPress={() => set({ rotate: (v.rotate + 90) % 360 })}>Quarter turn</Button></Tooltip>
          <Tooltip content="Mirror horizontally"><Button size="sm" variant={v.flipH ? "solid" : "flat"} color={v.flipH ? "primary" : "default"} startContent={<FlipHorizontal size={15} />} onPress={() => set({ flipH: !v.flipH })}>Mirror</Button></Tooltip>
        </div>
      )}
    </ModulePanel>
  ));

  if (cropping) return <CropBox url={track.url} title={`${track.title} (crop)`} onCancel={() => setCropping(false)} onApply={f => void crop(f)} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip content="Play the transition again"><Button size="sm" variant="flat" startContent={<Play size={14} />} onPress={() => setReplay(n => n + 1)}>Replay transition</Button></Tooltip>
        <Tooltip content="Save the current look as a new image"><span><Button size="sm" variant="bordered" isDisabled={kind !== "image" || busy} isLoading={busy} startContent={<Save size={14} />} onPress={bake}>Flatten to new image</Button></span></Tooltip>
        <Tooltip content="Download the original file"><Button size="sm" variant="light" startContent={<Download size={14} />} onPress={() => void downloadAsset(track.url, track.title)}>Download</Button></Tooltip>
        <Button size="sm" variant="light" onPress={() => { setOff({}); onChange(defaultVisual()); }}>Reset all</Button>
      </div>

      <Stage stage={{ url: track.url, kind, visual: v, label: track.title, n: replay }} className="aspect-video w-full rounded-2xl border border-border" />

      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
        <Select label="Transition in" value={v.transition} onChange={value => set({ transition: value as Transition })}
          options={TRANSITIONS.map(t => ({ value: t, label: t }))} />
        <Select label="Fill the screen" value={v.fit} onChange={value => set({ fit: value as Visual["fit"] })}
          options={[{ value: "contain", label: "Fit inside (letterbox)" }, { value: "cover", label: "Fill and crop" }]} />
        <label className="block">
          <span className="mb-1 flex items-center gap-1 text-xs text-muted"><Type size={12} />Caption on the slide</span>
          <input value={v.caption} onChange={e => set({ caption: e.target.value })} placeholder="Optional text over the media"
            className="w-full rounded-xl border border-border bg-surface/60 px-3 py-2 text-sm outline-none focus:border-accent" />
        </label>
      </div>

      <Tabs selectedKey={pane} onSelectionChange={setPane} classNames={{ tabList: "glass-soft" }}>
        <Tab id="geometry" title="Geometry">
          <div className="space-y-3 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip content="Keep part of the picture as a new image"><span><Button size="sm" variant="flat" isDisabled={kind !== "image"} startContent={<Crop size={14} />} onPress={() => setCropping(true)}>Crop</Button></span></Tooltip>
              <span className="text-xs text-muted">Crop writes a new image; everything below rides with the cue.</span>
            </div>
            {stack("geometry")}
          </div>
        </Tab>
        <Tab id="tone" title="Tone">
          <div className="space-y-3 pt-3">
            <p className="text-xs text-muted">Applied top to bottom. Switch a module off to bypass it without losing its settings.</p>
            {stack("tone")}
          </div>
        </Tab>
      </Tabs>

      {kind === "video" && (
        <div className="glass-soft space-y-4 p-4">
          <p className="text-sm font-semibold">Trim</p>
          <Filmstrip url={track.url} duration={duration} trimIn={v.trimIn} trimOut={v.trimOut} cues={cues} onChange={set} />
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
