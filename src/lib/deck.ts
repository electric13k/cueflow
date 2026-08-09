import { moved } from "./dragList";

/**
 * A deck is a document: a list of slides over one shared master. That is the whole idea taken from
 * the pptWeb editor (github.com/theBigGavin/pptWeb) — theme lives on the deck, content and layout
 * live on the slide, so restyling a talk is one click rather than N. None of its code is here.
 *
 * The model is plain data and pure functions so the editor can stay a thin renderer, and so this
 * file is the part that gets tested.
 *
 * Slide colours are literal hex, not CSS custom properties: a slide is exported as a PNG the
 * audience sees on a projector, so it must not follow the operator's light/dark theme.
 */

export type Layout = "title" | "text" | "image" | "imageLeft" | "imageRight";

export const LAYOUTS: { id: Layout; name: string; needsImage?: boolean }[] = [
  { id: "title", name: "Title" },
  { id: "text", name: "Title and lines" },
  { id: "image", name: "Full image", needsImage: true },
  { id: "imageLeft", name: "Image left", needsImage: true },
  { id: "imageRight", name: "Image right", needsImage: true },
];

/** The shared theme. Every slide in the deck reads from it; nothing overrides it per slide. */
export type Master = { bg: string; fg: string; accent: string; align: "left" | "center"; bullets: boolean };

export type Slide = { id: string; layout: Layout; title: string; body: string; image?: string };

export type Deck = { master: Master; slides: Slide[] };

/** Backgrounds that stay legible from the back of a room, and a matching accent for each. */
export const THEMES: { name: string; bg: string; fg: string; accent: string }[] = [
  { name: "House", bg: "#1A1614", fg: "#EFE7D8", accent: "#C9737C" },
  { name: "Foolscap", bg: "#EFE7D8", fg: "#241F1C", accent: "#6E2029" },
  { name: "Curtain", bg: "#3A0F14", fg: "#F3E2D6", accent: "#D4A957" },
  { name: "Olive", bg: "#2A2E22", fg: "#EFE7D8", accent: "#A3B37A" },
  { name: "Brass", bg: "#241F1C", fg: "#F5E9D4", accent: "#D4A957" },
  { name: "Blackout", bg: "#000000", fg: "#FFFFFF", accent: "#A32330" },
];

const uid = () => (globalThis.crypto?.randomUUID?.() ?? `s${Math.random().toString(36).slice(2)}`);

export const newSlide = (layout: Layout = "text"): Slide => ({ id: uid(), layout, title: "", body: "" });

export const newDeck = (): Deck => ({
  master: { bg: THEMES[0].bg, fg: THEMES[0].fg, accent: THEMES[0].accent, align: "left", bullets: true },
  slides: [newSlide()],
});

/** New slide after `at` (end by default), so "add" lands next to the slide you were looking at. */
export function addSlide(d: Deck, at = d.slides.length - 1, layout?: Layout): Deck {
  const i = Math.min(Math.max(at, -1) + 1, d.slides.length);
  const slides = d.slides.slice();
  slides.splice(i, 0, newSlide(layout));
  return { ...d, slides };
}

/** A deck with no slides has nothing to export, so the last one stays. */
export const removeSlide = (d: Deck, id: string): Deck =>
  d.slides.length < 2 ? d : { ...d, slides: d.slides.filter(s => s.id !== id) };

export const moveSlide = (d: Deck, from: number, to: number): Deck => ({ ...d, slides: moved(d.slides, from, to) });

export const patchSlide = (d: Deck, id: string, patch: Partial<Omit<Slide, "id">>): Deck =>
  ({ ...d, slides: d.slides.map(s => (s.id === id ? { ...s, ...patch } : s)) });

export const setMaster = (d: Deck, patch: Partial<Master>): Deck => ({ ...d, master: { ...d.master, ...patch } });

export const indexOf = (d: Deck, id: string) => d.slides.findIndex(s => s.id === id);

/** What the exported PNG is called, and what the cue is labelled in the library. */
export const slideName = (s: Slide, i: number) => s.title.trim() || `Slide ${i + 1}`;

/** A layout only shows an image if it has one; the editor uses this to nag rather than to forbid. */
export const wantsImage = (l: Layout) => !!LAYOUTS.find(x => x.id === l)?.needsImage;

// --- Painting ----------------------------------------------------------------------------------
const W = 1920, H = 1080, PAD = 140;

const titleFont = (px: number) => `700 ${px}px "Bodoni Moda", Georgia, serif`;
const bodyFont = (px: number) => `400 ${px}px "Source Serif 4", Georgia, serif`;

/** Greedy wrap, because a slide with a sentence running off the edge is worse than a small font. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number) {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > max) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

type Row = { text: string; font: string; lead: number; bullet: boolean; rule: boolean; indent: number };

/**
 * Text is laid out before it is drawn, so a layout can centre the block vertically without
 * measuring twice or guessing how tall a wrapped title got.
 */
function rows(ctx: CanvasRenderingContext2D, m: Master, s: Slide, w: number, ts: number, bs: number): Row[] {
  const out: Row[] = [];
  const push = (text: string, font: string, lead: number, bullet = false, rule = false, indent = 0) => out.push({ text, font, lead, bullet, rule, indent });
  if (s.title) {
    ctx.font = titleFont(ts);
    for (const line of wrap(ctx, s.title, w)) push(line, titleFont(ts), ts * 1.19);
    push("", "", ts * .67, false, true);
  }
  if (s.body && s.layout !== "image" && s.layout !== "title") {
    const dot = m.bullets && m.align === "left";
    const indent = dot ? bs * .93 : 0;
    ctx.font = bodyFont(bs);
    for (const para of s.body.split("\n")) {
      if (!para.trim()) { push("", "", bs * .7); continue; }
      wrap(ctx, para, w - indent).forEach((line, i) => push(line, bodyFont(bs), bs * 1.34, dot && i === 0, false, indent));
    }
  }
  // A title slide keeps its body as a standfirst: centred, no bullets, whatever the master says.
  if (s.body && s.layout === "title") {
    ctx.font = bodyFont(bs);
    for (const line of wrap(ctx, s.body.replace(/\n+/g, " "), w)) push(line, bodyFont(bs), bs * 1.34);
  }
  return out;
}

const height = (r: Row[]) => r.reduce((h, x) => h + x.lead, 0);

/** Fills a box with the image, cropping the overflow — a letterboxed slide wastes the projector. */
function cover(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number) {
  const iw = img.width || 1, ih = img.height || 1;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale, dh = ih * scale;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

type Img = (CanvasImageSource & { width: number; height: number }) | null | undefined;

/**
 * Draws one slide at 16:9. `width` exists so the strip can paint 180px thumbnails through the same
 * code as the 1920px export — everything inside is measured in the 1920×1080 design space.
 */
export function drawSlide(canvas: HTMLCanvasElement, m: Master, s: Slide, img?: Img, width = W) {
  canvas.width = Math.round(width); canvas.height = Math.round(width * H / W);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(width / W, 0, 0, width / W, 0, 0);
  ctx.fillStyle = m.bg; ctx.fillRect(0, 0, W, H);

  const half = s.layout === "imageLeft" || s.layout === "imageRight";
  if (img && s.layout === "image") cover(ctx, img, 0, 0, W, H);
  if (img && half) cover(ctx, img, s.layout === "imageLeft" ? 0 : W / 2, 0, W / 2, H);

  const x0 = half && s.layout === "imageLeft" ? W / 2 : 0;
  const boxW = half ? W / 2 : W;
  const ts = half ? 78 : s.layout === "title" ? 132 : 104;
  const bs = half ? 44 : 58;
  const w = boxW - PAD * 2;
  const list = rows(ctx, m, s, w, ts, bs);

  // A full-bleed image gets a scrim under its title, or the words land on whatever the photo did.
  if (s.layout === "image" && img && s.title) {
    const band = ctx.createLinearGradient(0, H - 420, 0, H);
    band.addColorStop(0, "rgba(0,0,0,0)"); band.addColorStop(1, "rgba(0,0,0,.78)");
    ctx.fillStyle = band; ctx.fillRect(0, H - 420, W, 420);
  }

  const centred = m.align === "center" || s.layout === "title";
  ctx.textAlign = centred ? "center" : "left";
  const x = x0 + (centred ? boxW / 2 : PAD);
  // Title slides sit in the middle of the frame; a full image hangs its title off the bottom.
  let y = s.layout === "title" ? (H - height(list)) / 2 + ts
    : s.layout === "image" ? H - height(list) - PAD * .4 + ts
    : PAD + ts * .87;

  for (const r of list) {
    if (r.rule) {
      ctx.fillStyle = m.accent;
      const rw = centred ? 120 : 160;
      ctx.fillRect(centred ? x - rw / 2 : x, y - ts * .38, rw, 8);
    } else if (r.text) {
      if (r.bullet) {
        ctx.fillStyle = m.accent;
        ctx.beginPath(); ctx.arc(x + bs * .24, y - bs * .31, bs * .21, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = m.fg;
      ctx.font = r.font;
      ctx.fillText(r.text, x + r.indent, y);
    }
    y += r.lead;
  }
  return ctx;
}

async function toFile(canvas: HTMLCanvasElement, title: string) {
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("The browser could not encode that slide.");
  return new File([blob], `${title}.png`, { type: "image/png" });
}

/** One PNG per slide, in deck order — a one-slide deck is exactly the old single-slide export. */
export async function deckFiles(d: Deck, images: Record<string, Img>) {
  const canvas = document.createElement("canvas");
  const out: { file: File; title: string }[] = [];
  for (const [i, s] of d.slides.entries()) {
    const title = slideName(s, i);
    drawSlide(canvas, d.master, s, s.image ? images[s.image] : null);
    out.push({ file: await toFile(canvas, title), title });
  }
  return out;
}
