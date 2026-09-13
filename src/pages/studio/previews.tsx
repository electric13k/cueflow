import { memo, useEffect, useRef, useState } from "react";
import { Button } from "../../ui";
import { decodeAudioUrl, peaks } from "../../lib/audio";
import { teach } from "../../lib/coach";
import type { Kind, Track } from "../../types";

/**
 * The three previews a library card can show, lifted out of Studio.tsx unchanged.
 *
 * They are here for two reasons. Studio.tsx was 2270 lines with twelve components in it, and these
 * three are the ones that exist in quantity: one per library card, re-rendering with the whole board
 * every time anything on it changed. Each is wrapped in `memo` below, so a card only re-renders when
 * its own track changes rather than when a sibling is selected.
 *
 * `DeckPreview` in particular is worth not re-rendering: every slide it expands is a live Office
 * Online iframe.
 */
function TrackPreview({ track, kind, playOnHover, onLinkSlide }: { track: Track; kind: Kind; playOnHover: boolean; onLinkSlide?: (deckId: string, slideIndex: number) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const enter = () => {
    if (kind !== "video" || !playOnHover) return;
    void video.current?.play().catch(() => {});
  };
  const leave = () => {
    if (!video.current) return;
    video.current.pause();
    video.current.currentTime = 0;
  };
  const cls = "media-preview w-full overflow-hidden bg-surface-secondary";
  if (kind === "image") return <div className={cls}><img src={track.url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /></div>;
  if (kind === "video") return <div className={cls} onPointerEnter={enter} onPointerLeave={leave}><video ref={video} src={track.url} muted playsInline preload="metadata" className="h-full w-full object-cover" /></div>;
  if (kind === "embed") return <DeckPreview track={track} className={cls} playOnHover={playOnHover} onLinkSlide={onLinkSlide} />;
  return <div className={`${cls} media-preview-audio`}><AudioPreview url={track.url} title={track.title} /></div>;
}

function DeckPreview({ track, className, playOnHover, onLinkSlide }: { track: Track; className: string; playOnHover: boolean; onLinkSlide?: (deckId: string, slideIndex: number) => void }) {
  const slides = track.slides?.length ? track.slides : [{ index: 0, label: "First slide" }];
  /**
   * Collapsed until asked. Every slide is a live Office Online iframe, and this defaulted to open on
   * any device without hover -- so a forty-slide deck opened forty iframes the moment a tablet
   * scrolled past the card. Hover still expands it on a desktop; touch gets a button instead.
   */
  const [expanded, setExpanded] = useState(false);
  const [contextSlide, setContextSlide] = useState<number | null>(null);
  const officeSource = /\.pptx?($|[?#])/i.test(track.url) && !track.url.startsWith("blob:")
    ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(track.url)}`
    : track.url;
  const slideUrl = (index: number) => `${officeSource}${officeSource.includes("?") ? "&" : "?"}slide=${index + 1}#slide=${index + 1}`;
  const shown = expanded ? slides : slides.slice(0, 1);
  return (
    <div data-coach="ppt-slides" className={`${className} media-preview-deck overflow-y-auto p-2`} onPointerEnter={() => { if (playOnHover) { setExpanded(true); teach("ppt-slides"); } }} onPointerLeave={() => { if (playOnHover) setExpanded(false); }}>
      <div className="grid gap-2 sm:grid-cols-2">
        {shown.map(slide => (
          <div key={slide.index} className="group/slide relative overflow-hidden rounded-lg border border-border bg-background/70" onPointerDown={event => event.stopPropagation()} onContextMenu={event => { event.preventDefault(); setContextSlide(slide.index); }}>
            <div className="aspect-video bg-black/30">
              <iframe src={slideUrl(slide.index)} title={`${track.title}, ${slide.label}`} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full border-0" />
            </div>
            <div className="flex items-center gap-2 px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate font-control text-label">{slide.label}</span>
              {onLinkSlide && <Button data-coach="cue-links" size="sm" variant="light" className="shrink-0 text-micro" onPress={() => onLinkSlide(track.id, slide.index)}>Link audio</Button>}
            </div>
            {contextSlide === slide.index && onLinkSlide && <div role="menu" className="absolute right-2 top-2 z-20 flex w-36 flex-col gap-1 rounded-xl border border-border bg-surface p-1.5 shadow-glass" onClick={event => event.stopPropagation()}><Button size="sm" variant="light" className="justify-start" onPress={() => { setContextSlide(null); onLinkSlide(track.id, slide.index); }}>Link audio</Button><Button size="sm" variant="light" className="justify-start" onPress={() => setContextSlide(null)}>Close</Button></div>}

          </div>
        ))}
      </div>
      {!playOnHover && slides.length > 1 && (
        <Button size="sm" variant="light" className="mt-2 w-full text-label" onPress={() => { setExpanded(open => !open); if (!expanded) teach("ppt-slides"); }}>
          {expanded ? "Show first slide only" : `Show all ${slides.length} slides`}
        </Button>
      )}
    </div>
  );
}

function AudioPreview({ url, title }: { url: string; title: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  /**
   * Only draw what someone can see. Every audio card used to fetch and fully PCM-decode its file the
   * moment the library mounted, so opening a library of thirty sounds decoded thirty sounds. The
   * observer disconnects on the first intersection: a waveform, once drawn, does not need redrawing.
   */
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "200px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const el = canvas.current;
    if (!el || !visible) return;
    let cancelled = false;
    void decodeAudioUrl(url).then(buffer => {
      if (cancelled || !el.isConnected) return;
      const rect = el.getBoundingClientRect();
      const width = Math.max(40, Math.round(rect.width));
      const height = Math.max(24, Math.round(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      el.width = Math.round(width * dpr); el.height = Math.round(height * dpr);
      const ctx = el.getContext("2d"); if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const style = getComputedStyle(el);
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, style.getPropertyValue("--cue-armed").trim() || "#D4A957");
      gradient.addColorStop(1, style.getPropertyValue("--cue-forest").trim() || "#285B43");
      ctx.fillStyle = gradient;
      const values = peaks(buffer, 0, 0, buffer.duration, Math.max(16, Math.floor(width / 2)));
      const mid = height / 2;
      for (let i = 0; i < values.length / 2; i++) {
        const top = mid - Math.abs(values[i * 2 + 1]) * mid * .88;
        const bottom = mid + Math.abs(values[i * 2]) * mid * .88;
        ctx.fillRect(i * 2, top, 1, Math.max(1, bottom - top));
      }
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [url, visible]);
  return failed ? <span className="flex h-full items-center px-4 text-label text-muted">Audio preview unavailable</span> : <div data-coach="waveforms" className="h-full w-full"><canvas ref={canvas} className="h-full w-full" aria-hidden /><span className="sr-only">Audio waveform preview for {title}</span></div>;
}

/**
 * Exported memoised. The props are a track object, two strings and an optional callback, so the
 * default shallow compare is the right one: a card whose track has not been replaced does no work
 * when the board around it changes.
 */
export const TrackPreviewMemo = memo(TrackPreview);
export const DeckPreviewMemo = memo(DeckPreview);
export const AudioPreviewMemo = memo(AudioPreview);
export { TrackPreview, DeckPreview, AudioPreview };
