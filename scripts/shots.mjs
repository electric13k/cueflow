// Captures the app screenshots used on the landing page.
//   npm i --no-save playwright && npx playwright install chromium
//   npm run dev     (in another terminal)
//   node scripts/shots.mjs
// Seeds a demo library first so the screens are not empty, then writes public/shots/*.png.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.SHOTS_BASE ?? "http://localhost:5173";
const OUT = "public/shots";

// A short tone as a data: URL, real decodable audio, so the waveform editor has something to draw.
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
  const sequence = { id: "seq-demo", name: "Act I, storm", createdAt: new Date().toISOString(),
    items: [0, 1, 3, 2].map((t, n) => ({ id: "item-" + n, trackId: "demo-" + t, label: ["Cue 1, knock", "Cue 2, thunder", "Cue 3, phone", "Cue 4, curtain"][n], effects: { ...fx } })) };
  localStorage.setItem("cueflow:tracks", JSON.stringify(tracks));
  localStorage.setItem("cueflow:sequences", JSON.stringify([sequence]));
  localStorage.setItem("cueflow:session", JSON.stringify({ selectedId: "demo-1", sequenceId: "seq-demo", cueIndex: 1, tab: "library" }));
  localStorage.setItem("cueflow:onboarded", "1");
  // Every first-run overlay marked as already seen. The coach dims the page behind its tooltip and
  // the sign-in nudge docks over the transport, so without these the shot is of the overlay and any
  // click aimed at the page underneath lands on nothing.
  localStorage.setItem("cueflow:taught", JSON.stringify(
    ["studio", "library", "editor", "sequence", "armed", "script", "show", "sidebar", "projects", "presenter", "transport"]));
  localStorage.setItem("cueflow:signin-prompt", "dismissed");
  document.cookie = "cueflow:consent=accepted;path=/;max-age=31536000";
})()`;

const shots = [
  { name: "soundboard", tab: 0, w: 1440, h: 900 },
  { name: "sequences", tab: 1, w: 1440, h: 900 },
  // The editor is no longer a tab: it opens over the library from a card. Reached by its accessible
  // name rather than by position, so adding a control to that row does not silently reshoot the
  // wrong screen -- which is exactly how these went stale the last time the Studio was rearranged.
  { name: "editor", tab: 0, w: 1440, h: 900, open: "Open Thunder roll in the editor" },
  // A phone runs a different layout, not a narrower one, so it is shot on its own terms: there is
  // no tab strip to click, the pane bar at the bottom of the screen is what switches these.
  { name: "phone", pane: "Library", w: 390, h: 844 },
  { name: "phone-deck", pane: "Deck", w: 390, h: 844 },
  { name: "phone-editor", pane: "Library", w: 390, h: 844, open: "Open Thunder roll in the editor" },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 2 });
  await page.goto(`${BASE}/studio`);
  await page.evaluate(seed);
  await page.goto(`${BASE}/studio`);
  // Animations off for the whole capture. Two reasons, and the second one is why this is not
  // optional: a shot taken mid-transition is a different picture every run, and framer-motion's
  // `layout` on the library grid never reports the card as "stable", so Playwright's actionability
  // check waits out its timeout on a card that is sitting perfectly still to the eye.
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none !important;transition:none !important}" });
  if (s.pane) {
    const bar = page.locator('nav[aria-label="Studio panes"]');
    await bar.waitFor();
    await bar.getByRole("button", { name: s.pane }).click({ force: true });
  } else {
    await page.waitForSelector("[role=tab]");
    await page.locator("[role=tab]").nth(s.tab).click();
  }
  if (s.open) {
    // Wait for the card itself rather than for a fixed number of milliseconds. The library hydrates
    // after first paint and the dev server's module graph makes that take anywhere from a moment to
    // most of a minute under load, which is what made a sleep here flake every few runs.
    //
    // Attribute selector rather than getByLabel: the button carries a plain `aria-label` and this
    // resolves it, where the accessible-name query does not see through the tooltip wrapper.
    const open = page.locator(`button[aria-label="${s.open}"]`);
    await open.waitFor({ state: "attached", timeout: 90_000 });
    await open.click({ force: true });
  }
  await page.waitForTimeout(2500); // let the waveform decode and the library images settle
  // Clicking a card scrolls it into view, which leaves the shot halfway down a panel with no
  // heading in frame. Back to the top, and move the pointer off whatever it was over so no tooltip
  // is left hanging in the picture.
  await page.mouse.move(2, 2);
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${s.name}.png` });
  await page.close();
  console.log("wrote", `${OUT}/${s.name}.png`);
}
await browser.close();
