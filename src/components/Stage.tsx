import { useEffect, useRef, type CSSProperties } from "react";
import type { Stage as StageState, Visual } from "../types";

/** Framing and colour are applied at display time, so nothing is ever re-encoded. */
export const visualStyle = (v: Visual): CSSProperties => ({
  objectFit: v.fit,
  filter: `brightness(${v.brightness}) contrast(${v.contrast}) saturate(${v.saturate}) blur(${v.blur}px)`,
  transform: `rotate(${v.rotate}deg) scale(${v.zoom})${v.flipH ? " scaleX(-1)" : ""}`,
});

/**
 * One visual, full-bleed, with its transition. Shared by the audience window and the Studio's stage
 * preview so what the operator sees is what the room gets.
 *
 * The transition is a CSS keyframe rather than a JS-driven tween, and deliberately so: a keyframe
 * animates *from* the entry state, so the resting state is the visible one. If the animation never
 * runs (a throttled window, reduced motion, a stalled frame loop) the slide is simply on screen,
 * where a JS tween starting at opacity 0 would leave the room staring at black.
 */
export default function Stage({ stage, className = "" }: { stage: StageState; className?: string }) {
  const video = useRef<HTMLVideoElement>(null);

  // Trim is non-destructive: start at trimIn, and stop (or loop) at trimOut.
  useEffect(() => {
    const el = video.current;
    if (!el || !stage || stage.kind !== "video") return;
    const { visual } = stage;
    el.playbackRate = visual.rate || 1;
    el.muted = visual.muted;
    el.currentTime = visual.trimIn || 0;
    const watch = () => {
      const end = visual.trimOut || el.duration;
      if (Number.isFinite(end) && el.currentTime >= end) {
        if (visual.loop) el.currentTime = visual.trimIn || 0;
        else el.pause();
      }
    };
    el.addEventListener("timeupdate", watch);
    // Autoplay can be refused if this document never saw a gesture; the operator's next key fixes it.
    void el.play().catch(() => {});
    return () => el.removeEventListener("timeupdate", watch);
  }, [stage?.url, stage?.n]);

  if (!stage) return <div className={`bg-black ${className}`} />;
  return (
    <div className={`relative overflow-hidden bg-black ${className}`}>
      {/* Keyed on the cue so firing the same slide twice replays its transition. */}
      <div key={`${stage.url}:${stage.n}`} className={`absolute inset-0 cue-${stage.visual.transition}`}>
        {stage.kind === "image" && <img src={stage.url} alt={stage.label} className="h-full w-full" style={visualStyle(stage.visual)} />}
        {stage.kind === "video" && <video ref={video} src={stage.url} playsInline className="h-full w-full" style={visualStyle(stage.visual)} />}
        {stage.kind === "embed" && <iframe src={stage.url} title={stage.label} allowFullScreen className="h-full w-full border-0" />}
        {stage.visual.caption && (
          <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-8 text-center text-2xl font-bold text-white sm:text-4xl">
            {stage.visual.caption}
          </p>
        )}
      </div>
    </div>
  );
}
