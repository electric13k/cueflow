import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { FileText, Film, Image as ImageIcon, ListMusic, Pencil, Presentation, Radio, Volume2 } from "lucide-react";
import { decodeAudioUrl, peaks } from "../lib/audio";
import { cellStyle, type RecentEntry, type RecentKind } from "./recents";
import { useDeviceCapabilities } from "../lib/layout";

const ICON: Record<RecentKind, typeof Volume2> = {
  session: Pencil, sequence: ListMusic, audio: Volume2, image: ImageIcon,
  video: Film, deck: Presentation, show: Radio, script: FileText,
};
const TINT: Record<RecentKind, string> = {
  session: "text-brass", sequence: "text-accent", audio: "text-audio", image: "text-visual",
  video: "text-visual", deck: "text-brass", show: "text-live", script: "text-brass",
};
const LABEL: Record<RecentKind, string> = {
  session: "Unfinished", sequence: "Sequence", audio: "Sound", image: "Picture",
  video: "Clip", deck: "Deck", show: "Show", script: "Script",
};

/** Touch devices keep previews closed: tapping a tile should navigate, not fetch an overlay. */

/** Long enough that dragging the cursor across the grid does not decode eight sounds on the way. */
const INTENT_MS = 200;

/**
 * One tile of the Recents grid, sized by its kind and previewing itself under the cursor.
 *
 * The preview is an overlay on the tile rather than a floating popover: a popover has to be placed,
 * and placing it is the thing that goes wrong at the breakpoint nobody tested. Inside the tile it
 * cannot overflow, cannot cover a neighbour and needs no measuring. It is `pointer-events-none` so
 * that the pointer keeps talking to the tile underneath and leaving still closes it.
 */
export default function RecentTile({ entry, delay = 0 }: { entry: RecentEntry; delay?: number }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const device = useDeviceCapabilities();
  const Icon = ICON[entry.kind];

  const enter = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || !device.canHover || !device.hasFinePointer || device.isTouch) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), INTENT_MS);
  };
  const leave = () => { clearTimeout(timer.current); setOpen(false); };
  useEffect(() => () => clearTimeout(timer.current), []);

  const cues = entry.cues ?? [];
  const roomy = entry.kind === "sequence" || entry.kind === "deck";

  return (
    <motion.li
      style={cellStyle(entry.kind)}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: .38, delay, ease: [.16, 1, .3, 1] }}
    >
      <Link
        to={entry.href}
        onPointerEnter={enter}
        onPointerLeave={leave}
        onPointerCancel={leave}
        className="relative flex h-full w-full flex-col overflow-hidden rounded-lg bg-surface/35 p-3 ring-1 ring-inset ring-border/50 transition-colors hover:bg-surface/70 hover:ring-border"
      >
        <span className="flex items-center gap-2">
          <Icon size={14} className={TINT[entry.kind]} aria-hidden />
          <span className="font-mono text-[9px] uppercase tracking-[.2em] text-muted">{LABEL[entry.kind]}</span>
        </span>
        <span className={`mt-1.5 block truncate ${roomy ? "text-base font-bold" : "text-sm font-semibold"}`}>{entry.title}</span>

        {/* A tall tile has room to say something useful before you ever hover it. */}
        {entry.kind === "sequence" && cues.length > 0 && (
          <span className="mt-2 block space-y-0.5 overflow-hidden">
            {cues.slice(0, 3).map(c => (
              <span key={c.n} className="flex items-baseline gap-2 text-xs">
                <span className={`w-4 shrink-0 font-mono ${c.kind === "audio" ? "text-audio" : "text-visual"}`}>{c.n}</span>
                <span className="truncate text-muted">{c.label}</span>
              </span>
            ))}
          </span>
        )}

        <span className="mt-auto pt-2 font-mono text-[10px] uppercase tracking-[.14em] text-muted">
          {entry.kind === "session" ? "Resume" : entry.note}
        </span>

        {open && <TilePreview entry={entry} />}
      </Link>
    </motion.li>
  );
}

/**
 * What each kind shows under the cursor. Everything mounts only once `open` is true and unmounts on
 * the way out, which is the whole cancellation story for the picture, the clip and the deck: an
 * `<img>`, a `<video>` and an `<iframe>` that leave the document stop loading by themselves. Only
 * the waveform has work of its own to call off.
 */
function TilePreview({ entry }: { entry: RecentEntry }) {
  const body = (() => {
    if (entry.kind === "audio" && entry.src) return <Waveform url={entry.src} />;
    if (entry.kind === "image" && entry.src) {
      return <img src={entry.src} alt="" loading="lazy" decoding="async" className="h-full w-full object-contain" />;
    }
    if (entry.kind === "video" && entry.src) {
      return <video src={entry.src} preload="metadata" muted playsInline className="h-full w-full object-contain" />;
    }
    // The embed opens on its first slide by itself: the URL the importer builds carries start=false.
    if (entry.kind === "deck" && entry.src) {
      return (
        <iframe
          src={entry.src} title={`${entry.title}, first slide`} loading="lazy"
          referrerPolicy="no-referrer" className="h-full w-full border-0"
        />
      );
    }
    if (entry.kind === "sequence" && entry.cues?.length) return <CueList cues={entry.cues} />;
    return null;
  })();
  if (!body) return null;
  return (
    <motion.span
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .18 }}
      className="pointer-events-none absolute inset-0 z-10 block overflow-hidden rounded-lg bg-background/92"
    >
      {body}
    </motion.span>
  );
}

/** The cue list as the operator would call it: sound counts 1, 2, 3 and the screen counts a, b, c. */
function CueList({ cues }: { cues: NonNullable<RecentEntry["cues"]> }) {
  const shown = cues.slice(0, 9);
  return (
    <span className="flex h-full flex-col gap-0.5 p-3">
      <span className="mb-1 font-mono text-[9px] uppercase tracking-[.2em] text-brass">Cue list</span>
      {shown.map(c => (
        <span key={c.n} className="flex items-baseline gap-2 text-xs">
          <span className={`w-4 shrink-0 font-mono ${c.kind === "audio" ? "text-audio" : "text-visual"}`}>{c.n}</span>
          <span className="truncate">{c.label}</span>
        </span>
      ))}
      {cues.length > shown.length && (
        <span className="mt-auto font-mono text-[10px] text-muted">and {cues.length - shown.length} more</span>
      )}
    </span>
  );
}

/**
 * A canvas gets no CSS, so the colour is read off the element with `getComputedStyle` rather than
 * assumed: the canvas carries `text-audio`, and whatever that token resolves to in the theme in
 * force is what the bars are painted in. The preview is redrawn from scratch every time it opens,
 * so a theme switched while nothing is hovered is already handled.
 */
function Waveform({ url }: { url: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let cancelled = false;
    void decodeAudioUrl(url)
      .then(buffer => { if (!cancelled && canvas.isConnected) draw(canvas, buffer); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [url]);

  if (failed) return <span className="flex h-full items-center justify-center text-xs text-muted">No preview</span>;
  return <canvas ref={ref} className="h-full w-full text-audio" aria-hidden />;
}

function draw(canvas: HTMLCanvasElement, buffer: AudioBuffer) {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = getComputedStyle(canvas).color;
  const columns = Math.max(8, Math.floor(w / 2));
  const p = peaks(buffer, 0, 0, buffer.duration, columns);
  const mid = h / 2, step = w / columns;
  for (let x = 0; x < columns; x++) {
    const top = mid - Math.abs(p[x * 2 + 1]) * mid * .92;
    const bottom = mid + Math.abs(p[x * 2]) * mid * .92;
    ctx.fillRect(x * step, top, Math.max(1, step - 1), Math.max(1, bottom - top));
  }
}
