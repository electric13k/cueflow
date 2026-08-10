import { useEffect, useRef, useState } from "react";
import { nudgeEdge, placeEdge } from "../lib/trim";

const SHOTS = 10;
/** How close a dragged handle has to come to a cue point before it sticks, in pixels of bar. */
const SNAP_PX = 8;

/**
 * A thumbnail strip with draggable in/out handles, the way OpenCut (opencut.app) and every other
 * timeline editor does it: you trim by looking at the picture, not by typing seconds into a box.
 * The shots are pulled by seeking a detached <video> and painting each frame, so nothing is
 * uploaded and nothing is transcoded.
 *
 * A cross-origin file without CORS taints the canvas, and reading it back throws. That is not worth
 * failing over -- the handles still work against a plain bar, so the strip just stays empty.
 */
export default function Filmstrip({ url, duration, trimIn, trimOut, cues = [], onChange }: {
  url: string; duration: number; trimIn: number; trimOut: number;
  /** Trim edges other cues already use on this file; a dragged handle sticks to them. */
  cues?: number[];
  onChange: (patch: { trimIn?: number; trimOut?: number }) => void;
}) {
  const [shots, setShots] = useState<string[]>([]);
  const bar = useRef<HTMLDivElement>(null);
  const end = trimOut || duration;

  useEffect(() => {
    if (!duration) return;
    let dead = false;
    const video = document.createElement("video");
    video.crossOrigin = "anonymous"; video.muted = true; video.preload = "auto"; video.src = url;
    const canvas = document.createElement("canvas");
    const out: string[] = [];

    const shoot = async () => {
      canvas.width = 160;
      canvas.height = Math.round(160 * (video.videoHeight || 9) / (video.videoWidth || 16));
      const ctx = canvas.getContext("2d")!;
      for (let i = 0; i < SHOTS && !dead; i++) {
        video.currentTime = (i + .5) / SHOTS * duration;
        await new Promise<void>(r => { video.onseeked = () => r(); setTimeout(r, 1500); });
        if (dead) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        out.push(canvas.toDataURL("image/jpeg", .6));
        setShots([...out]);
      }
    };
    video.onloadeddata = () => { void shoot().catch(() => {}); };
    return () => { dead = true; video.removeAttribute("src"); video.load(); };
  }, [url, duration]);

  const seek = (clientX: number, edge: "trimIn" | "trimOut") => {
    const box = bar.current?.getBoundingClientRect();
    if (!box) return;
    const t = Math.max(0, Math.min(1, (clientX - box.left) / box.width)) * duration;
    onChange(placeEdge(edge, t, { duration, trimIn, trimOut, points: cues, tolerance: SNAP_PX / box.width * duration }));
  };

  // A focused handle steps a frame at a time, the way every timeline editor spells it. Stopped
  // before it reaches the window, or a rebound "," would also fire a cue.
  const nudge = (edge: "trimIn" | "trimOut") => (e: React.KeyboardEvent) => {
    const dir = e.key === "," ? -1 : e.key === "." ? 1 : 0;
    if (!dir) return;
    e.preventDefault(); e.stopPropagation();
    onChange(nudgeEdge(edge, dir as -1 | 1, { duration, trimIn, trimOut }));
  };

  const grab = (edge: "trimIn" | "trimOut") => (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => seek(ev.clientX, edge);
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const pct = (t: number) => `${(duration ? t / duration : 0) * 100}%`;

  return (
    <div className="space-y-1">
      <div ref={bar} className="relative h-16 touch-none select-none overflow-hidden rounded-xl border border-border bg-black/40">
        <div className="absolute inset-0 flex">
          {shots.map((src, i) => <img key={i} src={src} alt="" className="h-full flex-1 object-cover opacity-90" draggable={false} />)}
        </div>
        {/* Everything outside the trim is dimmed, so what plays is what looks lit. */}
        <div className="absolute inset-y-0 left-0 bg-black/70" style={{ width: pct(trimIn) }} />
        <div className="absolute inset-y-0 right-0 bg-black/70" style={{ left: pct(end) }} />
        <div className="pointer-events-none absolute inset-y-0 border-x-2 border-accent" style={{ left: pct(trimIn), right: `calc(100% - ${pct(end)})` }} />
        {/* Where other cues already cut this file. Shown, or a handle sticking looks like a fault. */}
        {cues.map(t => <span key={t} className="pointer-events-none absolute inset-y-0 w-px bg-armed/80" style={{ left: pct(t) }} />)}
        {(["trimIn", "trimOut"] as const).map(edge => (
          <button key={edge} type="button" aria-label={edge === "trimIn" ? "Start of clip" : "End of clip"}
            title="Drag to trim. With the handle focused, , and . move it one frame."
            onPointerDown={grab(edge)} onKeyDown={nudge(edge)}
            className="absolute inset-y-0 -ml-[22px] w-11 cursor-ew-resize touch-none"
            style={{ left: pct(edge === "trimIn" ? trimIn : end) }}>
            <span className="mx-auto block h-full w-1.5 rounded-full bg-accent shadow" />
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[11px] tabular-nums text-muted">
        <span>{trimIn.toFixed(2)}s</span>
        <span>{(end - trimIn).toFixed(2)}s on screen</span>
        <span>{end.toFixed(2)}s</span>
      </div>
      <p className="text-[11px] text-muted">Pick up a handle and nudge it a frame with <kbd>,</kbd> and <kbd>.</kbd>{cues.length > 0 && ", it sticks to where other cues cut this file."}</p>
    </div>
  );
}
