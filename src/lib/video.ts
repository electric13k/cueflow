/**
 * Video rendering, on ffmpeg.wasm (@ffmpeg/ffmpeg, MIT wrapper around FFmpeg).
 *
 * The trim, the speed and the mute already ride with the cue as settings, which is right for a
 * rehearsal. This is the other half: turning those settings into a real file, so a trimmed clip can
 * be handed to someone else, dropped into a deck, or played by a device that never saw the cue.
 *
 * The wasm build is tens of megabytes, so it is imported inside the call that needs it and never at
 * module level -- a first paint must not pay for a button nobody pressed. The argument building is
 * kept out here as plain data so it can be tested without loading any of it.
 */

/** Matches the core the installed @ffmpeg/ffmpeg expects. Single threaded, so no COOP/COEP headers. */
const CORE = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * FFmpeg's atempo filter only stretches between 0.5x and 2x, so anything outside that is a chain of
 * steps whose product is the rate asked for. Video gets one setpts and needs no such trick.
 */
export function atempoChain(rate: number): number[] {
  let r = clamp(rate, .25, 4);
  const out: number[] = [];
  while (r < .5) { out.push(.5); r /= .5; }
  while (r > 2) { out.push(2); r /= 2; }
  out.push(Number(r.toFixed(4)));
  return out;
}

export type TrimOptions = {
  duration: number; trimIn: number; trimOut: number; rate: number; muted: boolean;
  visual?: { brightness: number; contrast: number; saturate: number; blur: number; rotate: number };
};

/**
 * The command line for one render. `-ss` and `-to` sit after `-i` on purpose: seeking on the input
 * is faster but lands on the nearest keyframe, and a cue that starts a third of a second early is
 * the exact thing trimming was meant to fix.
 *
 * `trimOut` of 0 means "to the end", which is how the cue stores it.
 */
export function trimArgs(input: string, output: string, o: TrimOptions): string[] {
  const end = o.trimOut > 0 ? Math.min(o.trimOut, o.duration || o.trimOut) : o.duration;
  const start = clamp(o.trimIn, 0, Math.max(0, end - .05));
  const rate = clamp(o.rate || 1, .25, 4);
  const args = ["-i", input, "-ss", start.toFixed(3), "-to", end.toFixed(3)];
  const vf: string[] = [];
  if (rate !== 1) vf.push(`setpts=${(1 / rate).toFixed(4)}*PTS`);
  if (o.visual) {
    const visual = o.visual;
    const brightness = clamp(Number(visual.brightness) || 1, 0, 2) - 1;
    const contrast = clamp(Number(visual.contrast) || 1, 0, 2);
    const saturation = clamp(Number(visual.saturate) || 1, 0, 3);
    if (brightness !== 0 || contrast !== 1 || saturation !== 1) vf.push(`eq=brightness=${brightness.toFixed(3)}:contrast=${contrast.toFixed(3)}:saturation=${saturation.toFixed(3)}`);
    if (visual.blur > 0) vf.push(`boxblur=luma_radius=${Math.max(1, Math.round(visual.blur))}:luma_power=1`);
    const degrees = ((Number(visual.rotate) || 0) % 360 + 360) % 360;
    if (degrees) vf.push(`rotate=${(degrees * Math.PI / 180).toFixed(6)}:fillcolor=black`);
  }
  if (vf.length) args.push("-filter:v", vf.join(","));
  if (o.muted) args.push("-an");
  else if (rate !== 1) args.push("-filter:a", atempoChain(rate).map(r => `atempo=${r}`).join(","));
  args.push("-preset", "ultrafast", output);
  return args;
}

const ext = (url: string) => (url.split(/[?#]/)[0].split(".").pop() || "mp4").toLowerCase().slice(0, 4);

/**
 * Renders the trim to a real MP4. `onProgress` runs 0..1 while FFmpeg works, because a wasm render
 * of a long clip is measured in tens of seconds and a frozen button reads as a broken one.
 */
export async function renderTrim(url: string, title: string, o: TrimOptions, onProgress?: (p: number) => void) {
  const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([
    import("@ffmpeg/ffmpeg"),
    import("@ffmpeg/util"),
  ]);
  const ffmpeg = new FFmpeg();
  if (onProgress) ffmpeg.on("progress", ({ progress }) => onProgress(clamp(progress, 0, 1)));
  try {
    await ffmpeg.load({
      coreURL: await toBlobURL(`${CORE}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${CORE}/ffmpeg-core.wasm`, "application/wasm"),
    });
    const input = `in.${ext(url)}`, output = "out.mp4";
    await ffmpeg.writeFile(input, await fetchFile(url));
    await ffmpeg.exec(trimArgs(input, output, o));
    const data = await ffmpeg.readFile(output);
    // readFile hands back a view onto the wasm heap; copy it before the instance is torn down.
    const bytes = new Uint8Array(data as Uint8Array);
    return new File([bytes], `${title}.mp4`, { type: "video/mp4" });
  } finally {
    ffmpeg.terminate();
  }
}
