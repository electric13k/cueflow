import { defaultVisual, type Visual } from "../types";

/**
 * Raster work for the picture and slide editors. Everything happens on a canvas in the browser; no
 * upload, no server, no round trip.
 *
 * The tone controls follow darktable's and Krita's ordering -- exposure, contrast, colour balance,
 * then the local stuff -- because that order is what makes an adjustment predictable: change the
 * white balance after you have set exposure and the exposure still reads right. Neither project's
 * code is used here (both are GPL, and a web app ships its source to every visitor), only the
 * behaviour they made standard. Credit to darktable and Krita.
 */

/** Warm/cool tint, -100..100, matching what a soft-light layer does in an image editor. */
export const tempColour = (temp: number) => (temp >= 0 ? "255,138,61" : "61,168,255");
export const tempAlpha = (temp: number) => Math.min(Math.abs(temp), 100) / 260;

// --- The adjustment stack ------------------------------------------------------------------------

export type Ctl = { key: keyof Visual; label: string; min: number; max: number; step: number; suffix?: string; decimals?: number };
/** One panel of the stack. `also` is a value the module owns that has no slider, e.g. the mirror flag. */
export type ImageModule = {
  id: string; label: string; hint: string;
  pane: "geometry" | "tone";
  ctl: Ctl[]; also?: (keyof Visual)[];
};

/**
 * The order is fixed and it is the point. darktable's pixelpipe runs geometry, then exposure, then
 * the curve, then colour, then the local effects, and it does not let you shuffle them, because an
 * adjustment only reads true when the ones it depends on have already happened: set the white
 * balance before the exposure and the exposure stops meaning anything. Krita's split is the other
 * half -- what changes the frame is not what changes the pixels, so they are two panes, not one
 * list. Behaviour only; no code from either project is here. Credit to darktable and Krita.
 */
export const MODULES: ImageModule[] = [
  { id: "orientation", label: "Orientation", hint: "turn and mirror", pane: "geometry", also: ["flipH"],
    ctl: [{ key: "rotate", label: "Rotate", min: 0, max: 359, step: 1, suffix: "°", decimals: 0 }] },
  { id: "framing", label: "Framing", hint: "scale inside the frame", pane: "geometry",
    ctl: [{ key: "zoom", label: "Zoom", min: .5, max: 3, step: .05, suffix: "x" }] },
  { id: "exposure", label: "Exposure", hint: "overall light", pane: "tone",
    ctl: [{ key: "brightness", label: "Exposure", min: 0, max: 2, step: .05 }] },
  { id: "curves", label: "Curves", hint: "shadow-to-highlight spread", pane: "tone",
    ctl: [{ key: "contrast", label: "Contrast", min: 0, max: 2, step: .05 }] },
  { id: "colour", label: "Colour", hint: "white balance and strength", pane: "tone",
    ctl: [
      { key: "temp", label: "Warmth", min: -100, max: 100, step: 1, decimals: 0 },
      { key: "saturate", label: "Saturation", min: 0, max: 3, step: .05 },
    ] },
  { id: "effects", label: "Local effects", hint: "applied last, over everything", pane: "tone",
    ctl: [
      { key: "vignette", label: "Vignette", min: 0, max: 1, step: .02 },
      { key: "blur", label: "Blur", min: 0, max: 20, step: .5, suffix: "px", decimals: 0 },
    ] },
];

const NEUTRAL = defaultVisual();
export const moduleKeys = (m: ImageModule): (keyof Visual)[] => [...m.ctl.map(c => c.key), ...(m.also ?? [])];
const pick = (v: Visual, keys: (keyof Visual)[]) =>
  Object.fromEntries(keys.map(k => [k, v[k]])) as Partial<Visual>;

/** Is this module doing anything? Anything away from the default counts, and drives the reset button. */
export const moduleTouched = (v: Visual, m: ImageModule) =>
  moduleKeys(m).some(k => (v[k] ?? NEUTRAL[k]) !== NEUTRAL[k]);

/** Per-module reset: this panel back to default, every other panel untouched. */
export const resetModule = (v: Visual, m: ImageModule): Visual => ({ ...v, ...pick(NEUTRAL, moduleKeys(m)) });

/**
 * Switching a module off has to mean "bypass", not "forget": the values come back when you switch it
 * on again. Keeping them in a stash rather than in the look means what is saved is always what is on
 * screen, so nothing downstream -- stage, flatten, the presenter window -- needs to know the stack
 * exists.
 */
export type Bypassed = Record<string, Partial<Visual>>;
export function toggleModule(v: Visual, m: ImageModule, off: Bypassed): [Visual, Bypassed] {
  const stashed = off[m.id];
  if (stashed) {
    const rest = { ...off };
    delete rest[m.id];
    return [{ ...v, ...stashed }, rest];
  }
  return [resetModule(v, m), { ...off, [m.id]: pick(v, moduleKeys(m)) }];
}

const load = async (url: string) => {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  await img.decode();
  return img;
};

const toFile = async (canvas: HTMLCanvasElement, title: string) => {
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("The browser could not encode that image.");
  return new File([blob], `${title}.png`, { type: "image/png" });
};

/** Warm/cool wash and vignette, painted over whatever is already on the canvas. */
export function grade(ctx: CanvasRenderingContext2D, v: Visual, w: number, h: number) {
  ctx.filter = "none";
  if (v.temp) {
    ctx.save();
    // soft-light keeps highlights and shadows intact, which a plain tinted overlay flattens.
    ctx.globalCompositeOperation = "soft-light";
    ctx.fillStyle = `rgba(${tempColour(v.temp)},${tempAlpha(v.temp) * 2.2})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  if (v.vignette) {
    const r = Math.hypot(w, h) / 2;
    const g = ctx.createRadialGradient(w / 2, h / 2, r * .45, w / 2, h / 2, r);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${Math.min(v.vignette, 1)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

/** Bakes the live look (tone, framing, caption) into a new PNG. The original file is untouched. */
export async function flatten(url: string, v: Visual, title: string) {
  const img = await load(url);
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
  grade(ctx, v, w, h);
  if (v.caption) {
    const size = Math.round(h * .07);
    ctx.font = `700 ${size}px "Source Serif 4", Georgia, serif`;
    ctx.textAlign = "center";
    const band = ctx.createLinearGradient(0, h - size * 3, 0, h);
    band.addColorStop(0, "rgba(0,0,0,0)"); band.addColorStop(1, "rgba(0,0,0,.8)");
    ctx.fillStyle = band; ctx.fillRect(0, h - size * 3, w, size * 3);
    ctx.fillStyle = "#fff"; ctx.fillText(v.caption, w / 2, h - size);
  }
  return toFile(canvas, title);
}

// --- Slides -----------------------------------------------------------------------------------
const SLIDE_W = 1920, SLIDE_H = 1080;

export type Slide = {
  title: string; body: string;
  bg: string; fg: string; accent: string;
  align: "left" | "center";
  bullets: boolean;
};
export const defaultSlide = (): Slide => ({
  title: "", body: "", bg: "#1A1614", fg: "#EFE7D8", accent: "#C9737C", align: "left", bullets: true,
});

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

/**
 * Draws a 16:9 slide. Deliberately one layout with a few knobs rather than a free canvas: a slide
 * that has to be legible from the back of a room is a title, some lines, and enough contrast, and
 * every deck tool that lets you drag text anywhere produces decks where nothing lines up.
 * The layout follows the pptWeb editor's default slide (github.com/theBigGavin/pptWeb). Credit there.
 */
export function drawSlide(canvas: HTMLCanvasElement, s: Slide) {
  canvas.width = SLIDE_W; canvas.height = SLIDE_H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = s.bg; ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);

  const pad = 140;
  const centred = s.align === "center";
  ctx.textAlign = centred ? "center" : "left";
  const x = centred ? SLIDE_W / 2 : pad;
  let y = pad + 90;

  if (s.title) {
    ctx.fillStyle = s.fg;
    ctx.font = `700 104px "Bodoni Moda", Georgia, serif`;
    for (const line of wrap(ctx, s.title, SLIDE_W - pad * 2)) { ctx.fillText(line, x, y); y += 124; }
    ctx.fillStyle = s.accent;
    if (centred) ctx.fillRect(SLIDE_W / 2 - 60, y - 40, 120, 8);
    else ctx.fillRect(pad, y - 40, 160, 8);
    y += 70;
  }

  if (s.body) {
    ctx.fillStyle = s.fg;
    ctx.font = `400 58px "Source Serif 4", Georgia, serif`;
    for (const para of s.body.split("\n")) {
      if (!para.trim()) { y += 40; continue; }
      const dot = s.bullets && !centred;
      const indent = dot ? 54 : 0;
      const lines = wrap(ctx, para, SLIDE_W - pad * 2 - indent);
      lines.forEach((line, i) => {
        if (dot && i === 0) {
          ctx.fillStyle = s.accent;
          ctx.beginPath(); ctx.arc(pad + 14, y - 18, 12, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = s.fg;
        }
        ctx.fillText(line, x + (centred ? 0 : indent), y);
        y += 78;
      });
      y += 16;
    }
  }
  return ctx;
}

export async function slideFile(s: Slide, title: string) {
  const canvas = document.createElement("canvas");
  drawSlide(canvas, s);
  return toFile(canvas, title);
}
