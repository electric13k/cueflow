import { useRef, useState } from "react";
import { Button } from "../ui";
import { Check, Crop, X } from "lucide-react";
import { fullRect, type Rect } from "../lib/image";

const RATIOS: { label: string; value: number | null }[] = [
  { label: "Free", value: null },
  { label: "16:9", value: 16 / 9 },
  { label: "4:3", value: 4 / 3 },
  { label: "1:1", value: 1 },
  { label: "9:16", value: 9 / 16 },
];

/**
 * Drag a box over the picture and keep what is inside. Ratio presets constrain the drag rather than
 * squashing the result, which is the behaviour darktable and Krita both settled on -- a 16:9 crop
 * should hand you a 16:9 file, not a stretched one.
 */
export default function CropBox({ url, onCancel, onApply }: {
  url: string; onCancel: () => void; onApply: (r: Rect) => void;
}) {
  const [rect, setRect] = useState<Rect>(fullRect());
  const [ratio, setRatio] = useState<number | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const from = useRef<{ x: number; y: number } | null>(null);

  const at = (e: { clientX: number; clientY: number }) => {
    const box = frame.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)),
      aspect: box.width / box.height,
    };
  };

  const draw = (e: { clientX: number; clientY: number }) => {
    const a = from.current;
    if (!a) return;
    const p = at(e);
    // x and y are fractions of a box that is not square, so a pixel ratio of r means w/h = r/aspect.
    let w = Math.abs(p.x - a.x);
    let h = ratio ? (w * p.aspect) / ratio : Math.abs(p.y - a.y);
    let x = p.x < a.x ? a.x - w : a.x;
    let y = p.y < a.y ? a.y - h : a.y;
    // Running off an edge shrinks the box; the anchor corner stays where it was put.
    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    w = Math.min(w, 1 - x);
    h = Math.min(h, 1 - y);
    if (ratio) {
      // Whichever edge ran out first decides the size, so the ratio survives the clamp.
      if ((w * p.aspect) / ratio > h) w = (h * ratio) / p.aspect; else h = (w * p.aspect) / ratio;
      if (p.y < a.y) y = Math.max(0, a.y - h);
      if (p.x < a.x) x = Math.max(0, a.x - w);
    }
    setRect({ x, y, w: Math.max(.02, w), h: Math.max(.02, h) });
  };

  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    from.current = at(e);
    const move = (ev: PointerEvent) => draw(ev);
    const stop = () => { from.current = null; window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const box = { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` };

  return (
    <div className="space-y-3">
      <div ref={frame} onPointerDown={start}
        className="relative aspect-video w-full touch-none select-none overflow-hidden rounded-2xl border border-border bg-black">
        <img src={url} alt="" className="h-full w-full object-contain" draggable={false} />
        <div className="pointer-events-none absolute inset-0 bg-black/55" />
        <div className="pointer-events-none absolute overflow-hidden ring-2 ring-accent" style={box}>
          <img src={url} alt="" className="absolute h-full w-full object-contain"
            style={{ left: `${-rect.x * 100 / rect.w}%`, top: `${-rect.y * 100 / rect.h}%`, width: `${100 / rect.w}%`, height: `${100 / rect.h}%` }} draggable={false} />
          {/* Thirds, the one guide worth having on by default. */}
          <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
            {Array.from({ length: 9 }, (_, i) => <div key={i} className="border border-white/20" />)}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Crop size={15} className="text-muted" />
        {RATIOS.map(r => (
          <Button key={r.label} size="sm" variant={ratio === r.value ? "solid" : "flat"} color={ratio === r.value ? "primary" : "default"}
            onPress={() => setRatio(r.value)}>{r.label}</Button>
        ))}
        <span className="text-xs text-muted">Drag across the picture to set the frame.</span>
        <span className="ml-auto flex gap-2">
          <Button size="sm" variant="light" startContent={<X size={14} />} onPress={onCancel}>Cancel</Button>
          <Button size="sm" color="primary" startContent={<Check size={14} />} onPress={() => onApply(rect)}>Crop to new image</Button>
        </span>
      </div>
    </div>
  );
}
