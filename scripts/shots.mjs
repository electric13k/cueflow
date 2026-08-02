// Captures the app screenshots used on the landing page.
//   npm i --no-save playwright && npx playwright install chromium
//   npm run dev     (in another terminal)
//   node scripts/shots.mjs
// Seeds a demo library first so the screens are not empty, then writes public/shots/*.png.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.SHOTS_BASE ?? "http://localhost:5173";
const OUT = "public/shots";

// A short tone as a data: URL — real decodable audio, so the waveform editor has something to draw.
const seed = `(() => {
  const tone = (freq, secs) => {
    const sr = 22050, n = Math.floor(sr * secs), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    let o = 0; const w = s => { for (const c of s) v.setUint8(o++, c.charCodeAt(0)); };
    w("RIFF"); v.setUint32(o, 36 + n * 2, true); o += 4; w("WAVEfmt "); v.setUint32(o, 16, true); o += 4;
    v.setUint16(o, 1, true); o += 2; v.setUint16(o, 1, true); o += 2; v.setUint32(o, sr, true); o += 4;
    v.setUint32(o, sr * 2, true); o += 4; v.setUint16(o, 2, true); o += 2; v.setUint16(o, 16, true); o += 2;
    w("data"); v.setUint32(o, n * 2, true); o += 4;
    for (let i = 0; i < n; i++) {
      const env = Math.min(1, i / (sr * 0.02)) * Math.max(0, 1 - i / n);
      v.setInt16(o, Math.sin((i / sr) * freq * 6.283) * 12000 * env, true); o += 2;
    }
    let s = ""; for (const x of new Uint8Array(buf)) s += String.fromCharCode(x);
    return "data:audio/wav;base64," + btoa(s);
  };
  const fx = { speed: 1, volume: 1, gain: 1, reverb: 0, fadeIn: 0, fadeOut: 0, distortion: 0, reverse: false };
  const names = [["Door slam", 90, 1.1], ["Thunder roll", 55, 2.4], ["Applause", 320, 1.8], ["Phone ring", 480, 1.4], ["Glass smash", 700, 0.9], ["Wind howl", 140, 2.2]];
  const tracks = names.map(([title, f, d], i) => ({ id: "demo-" + i, title, url: tone(f, d), createdAt: new Date().toISOString(), effects: { ...fx, reverb: i === 1 ? 0.35 : 0 } }));
  const sequence = { id: "seq-demo", name: "Act I — storm", createdAt: new Date().toISOString(),
    items: [0, 1, 3, 2].map((t, n) => ({ id: "item-" + n, trackId: "demo-" + t, label: ["Cue 1 — knock", "Cue 2 — thunder", "Cue 3 — phone", "Cue 4 — curtain"][n], effects: { ...fx } })) };
  localStorage.setItem("cueflow:tracks", JSON.stringify(tracks));
  localStorage.setItem("cueflow:sequences", JSON.stringify([sequence]));
  localStorage.setItem("cueflow:session", JSON.stringify({ selectedId: "demo-1", sequenceId: "seq-demo", cueIndex: 1, tab: "library" }));
  localStorage.setItem("cueflow:onboarded", "1");
  document.cookie = "cueflow:consent=accepted;path=/;max-age=31536000";
})()`;

const shots = [
  { name: "soundboard", tab: 0, w: 1440, h: 900 },
  { name: "editor", tab: 1, w: 1440, h: 900 },
  { name: "sequences", tab: 2, w: 1440, h: 900 },
  { name: "phone", tab: 0, w: 390, h: 844 },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 2 });
  await page.goto(`${BASE}/studio`);
  await page.evaluate(seed);
  await page.goto(`${BASE}/studio`);
  await page.waitForSelector("[role=tab]");
  await page.locator("[role=tab]").nth(s.tab).click();
  await page.waitForTimeout(2500); // let the waveform decode and the entry animations settle
  await page.screenshot({ path: `${OUT}/${s.name}.png` });
  await page.close();
  console.log("wrote", `${OUT}/${s.name}.png`);
}
await browser.close();
