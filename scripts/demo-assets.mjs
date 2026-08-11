// Builds the demo media the tutorial loads, into public/demo/.
//   node scripts/demo-assets.mjs      (needs ffmpeg on PATH and playwright installed)
//
// Generated rather than sourced. A tutorial needs half a dozen files that look like show material,
// and generating them means there is no licence to track, no attribution to keep correct, and the
// set is reproducible: delete public/demo and run this to get byte-identical files back.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const OUT = "public/demo";
const tmp = mkdtempSync(join(tmpdir(), "cueflow-demo-"));
const ff = (...args) => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args]);

await mkdir(OUT, { recursive: true });

/** A mono 22.05kHz WAV. Real decodable audio, so the waveform editor has something to draw. */
function wav(path, seconds, sample) {
  const sr = 22050, n = Math.floor(sr * seconds);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32000, Math.min(32000, sample(i / sr, i / n) * 32000)) | 0, 44 + i * 2);
  writeFileSync(path, buf);
}

// A deterministic noise source. Math.random would make every run produce different bytes.
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;

const sounds = {
  // A door slam: a hard transient with a low body that dies fast.
  "door-slam": [1.0, (t, p) => (rand() * 0.5 + Math.sin(t * 90 * 6.283) * 0.8) * Math.exp(-p * 9)],
  // Thunder: filtered noise swelling and rolling away.
  "thunder-roll": [3.0, (t, p) => {
    const body = rand() * 0.35 + Math.sin(t * 46 * 6.283) * 0.4 + Math.sin(t * 27 * 6.283) * 0.5;
    return body * Math.min(1, p * 6) * Math.exp(-p * 2.2);
  }],
  // Applause: dense clatter with a slow swell in and out.
  applause: [4.0, (_t, p) => rand() * 0.55 * Math.sin(Math.PI * Math.min(1, p * 1.1))],
};

for (const [name, [secs, fn]] of Object.entries(sounds)) {
  seed = 12345;
  const raw = join(tmp, `${name}.wav`);
  wav(raw, secs, fn);
  ff("-i", raw, "-codec:a", "libmp3lame", "-b:a", "96k", `${OUT}/${name}.mp3`);
  console.log("wrote", `${OUT}/${name}.mp3`);
}

/** The two stills, drawn as HTML and photographed, so they match the house palette exactly. */
const card = (title, sub, bg) => `<body style="margin:0;width:1280px;height:720px;background:${bg};
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;
  font-family:Georgia,'Times New Roman',serif;color:#F3E9D8;text-align:center">
  <div style="position:absolute;inset:0;background:
    radial-gradient(60rem 30rem at 50% -10%, rgba(231,201,176,.30), transparent 70%),
    radial-gradient(40rem 30rem at 50% 120%, rgba(110,32,41,.55), transparent 70%)"></div>
  <p style="position:relative;margin:0;font-size:22px;letter-spacing:.5em;text-transform:uppercase;color:#E7C9B0">${sub}</p>
  <h1 style="position:relative;margin:0;font-size:96px;font-weight:700;letter-spacing:-.01em">${title}</h1>
</body>`;

const browser = await chromium.launch();
const stills = {
  "act-one": card("Act One", "Scene i", "#241F1C"),
  "curtain": card("Curtain", "House to half", "#2B1418"),
};
for (const [name, html] of Object.entries(stills)) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.setContent(html);
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 82 });
  await page.close();
  console.log("wrote", `${OUT}/${name}.jpg`);
}
await browser.close();

/**
 * The clip: a slow push into the Act One still. Six seconds of H.264, a couple of hundred kilobytes,
 * and it plays everywhere unlike a webm.
 *
 * libopenh264 rather than libx264: this ffmpeg has no x264 built in, and openh264 is the software
 * encoder that is actually present. It takes a bitrate instead of a CRF and has no `-preset`.
 * `format=yuv420p` is what makes Safari and QuickTime accept the file at all.
 */
ff("-loop", "1", "-i", `${OUT}/act-one.jpg`, "-t", "6",
  "-vf", "zoompan=z='min(zoom+0.0012,1.18)':d=150:s=1280x720:fps=25,format=yuv420p",
  "-c:v", "libopenh264", "-b:v", "500k", "-movflags", "+faststart",
  `${OUT}/house-lights.mp4`);
console.log("wrote", `${OUT}/house-lights.mp4`);

/**
 * The slide deck, as a page we host rather than a Google Slides link.
 *
 * An embed cue is an iframe, and the tutorial has to work on a laptop in a rehearsal room with bad
 * wifi and on a machine signed into no Google account at all. A hardcoded public deck URL is one
 * revoked share setting away from teaching people that embeds are broken. This behaves identically
 * and cannot rot; the tutorial says in words that a real Slides or PowerPoint link drops in here.
 */
writeFileSync(`${OUT}/deck.html`, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Demo deck</title><style>
  html,body{margin:0;height:100%;background:#241F1C;color:#F3E9D8;font-family:Georgia,'Times New Roman',serif}
  .slides{height:100%;display:grid;place-items:center;text-align:center}
  .slide{grid-area:1/1;opacity:0;transition:opacity .8s;padding:0 8%}
  .slide.on{opacity:1}
  h2{font-size:clamp(28px,7vw,64px);margin:0 0 .3em}
  p{font-size:clamp(14px,2.6vw,22px);color:#E7C9B0;margin:0;letter-spacing:.36em;text-transform:uppercase}
</style></head><body>
  <div class="slides">
    <section class="slide on"><p>Programme</p><h2>A Winter's Tale</h2></section>
    <section class="slide"><p>Act One</p><h2>The Court of Sicilia</h2></section>
    <section class="slide"><p>Interval</p><h2>Fifteen minutes</h2></section>
  </div>
  <script>
    const slides = document.querySelectorAll(".slide");
    let i = 0;
    setInterval(() => { slides[i].classList.remove("on"); i = (i + 1) % slides.length; slides[i].classList.add("on"); }, 4000);
  </script>
</body></html>
`);
console.log("wrote", `${OUT}/deck.html`);

rmSync(tmp, { recursive: true, force: true });
