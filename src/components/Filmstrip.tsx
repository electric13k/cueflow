import { useEffect, useRef, useState } from "react";

const SHOTS = 10;

/**
 * A thumbnail strip with draggable in/out handles, the way OpenCut (opencut.app) and every other
 * timeline editor does it: you trim by looking at the picture, not by typing seconds into a box.
 * The shots are pulled by seeking a detached <video> and painting each frame, so nothing is
 * uploaded and nothing is transcoded.
 *
 * A cross-origin file without CORS taints the canvas, and reading it back throws. That is not worth
 * failing over -- the handles still work against a plain bar, so the strip just stays empty.
 */
export default function Filmstrip({ url, duration, trimIn, trimOut, onChange }: {
  url: string; duration: number; trimIn: number; trimOut: number;
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
    // Keep at least a quarter second of video, or the cue plays nothing at all.
    onChange(edge === "trimIn" ? { trimIn: Math.min(t, end - .25) } : { trimOut: Math.max(t, trimIn + .25) });
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
        {(["trimIn", "trimOut"] as const).map(edge => (
          <button key={edge} type="button" aria-label={edge === "trimIn" ? "Start of clip" : "End of clip"}
            onPointerDown={grab(edge)}
            className="absolute inset-y-0 -ml-3 w-6 cursor-ew-resize touch-none"
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
    </div>
  );
}
