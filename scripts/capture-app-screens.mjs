import { chromium, devices } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CUEFLOW_URL || "http://127.0.0.1:5177";
const out = path.resolve(process.cwd(), "artifacts/app-screens");
await fs.mkdir(out, { recursive: true });

const effects = { speed: 1, volume: 0.9, gain: 1, reverb: 0, fadeIn: 0, fadeOut: 0, distortion: 0, reverse: false, bass: 0, mid: 0, treble: 0 };
const visual = { fit: "contain", zoom: 1, rotate: 0, flipH: false, brightness: 1, contrast: 1, saturate: 1, blur: 0, temp: 0, vignette: 0, caption: "", trimIn: 0, trimOut: 0, muted: false, rate: 1, loop: false, transition: "fade" };
const tracks = [
  { id: "demo:capture-door", title: "Door slam", url: `${base}/demo/door-slam.mp3`, kind: "audio", effects, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "demo:capture-thunder", title: "Thunder roll", url: `${base}/demo/thunder-roll.mp3`, kind: "audio", effects, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "demo:capture-act", title: "Act One title", url: `${base}/demo/act-one.jpg`, kind: "image", effects, visual: { ...visual, caption: "Act One, Scene i" }, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "demo:capture-curtain", title: "Curtain", url: `${base}/demo/curtain.jpg`, kind: "image", effects, visual: { ...visual, caption: "House to half" }, createdAt: "2026-01-01T00:00:00.000Z" },
];
const sequence = {
  id: "demo:capture-sequence",
  name: "Opening night",
  createdAt: "2026-01-01T00:00:00.000Z",
  items: tracks.map((track, index) => ({ id: `demo:capture-item-${index}`, trackId: track.id, label: track.title, effects: { ...effects }, visual: track.visual })),
};

async function prepare(context, theme) {
  await context.addInitScript(({ tracks: seededTracks, sequence: seededSequence, theme: seededTheme }) => {
    localStorage.setItem("tracks", JSON.stringify(seededTracks));
    localStorage.setItem("sequences", JSON.stringify([seededSequence]));
    localStorage.setItem("cueflow:theme", seededTheme);
    localStorage.setItem("cueflow:theme:studio", seededTheme);
    localStorage.setItem("cueflow:onboarded", "1");
    localStorage.setItem("cueflow:signin-prompt", "dismissed");
    document.cookie = "cueflow:consent=accepted; path=/; SameSite=Lax";
  }, { tracks, sequence, theme });
  const page = await context.newPage();
  page.on("pageerror", error => console.error(`[pageerror:${theme}] ${error.message}`));
  await page.goto(`${base}/studio`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.addStyleTag({ content: '[role="dialog"] { display: none !important; }' });
  return page;
}

for (const theme of ["light", "dark"]) {
  const desktop = await chromium.launch({ headless: true, executablePath: "/usr/bin/chromium", args: ["--no-sandbox", "--disable-gpu"] });
  const desktopContext = await desktop.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const desktopPage = await prepare(desktopContext, theme);
  await desktopPage.screenshot({ path: path.join(out, `studio-library-desktop-${theme}.png`), fullPage: false });
  await desktopPage.locator('button[data-tour="pane-deck"]').count();
  await desktop.close();

  const phone = await chromium.launch({ headless: true, executablePath: "/usr/bin/chromium", args: ["--no-sandbox", "--disable-gpu"] });
  const phoneContext = await phone.newContext({ ...devices["iPhone 13"], reducedMotion: "reduce" });
  const phonePage = await prepare(phoneContext, theme);
  await phonePage.screenshot({ path: path.join(out, `studio-library-phone-${theme}.png`), fullPage: false });
  await phonePage.locator('button[data-tour="pane-deck"]').click({ force: true });
  await phonePage.waitForTimeout(180);
  await phonePage.screenshot({ path: path.join(out, `studio-deck-phone-${theme}.png`), fullPage: false });
  await phone.close();
}

console.log(JSON.stringify({ base, output: out, files: await fs.readdir(out) }, null, 2));
