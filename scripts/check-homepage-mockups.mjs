import { chromium, devices } from "playwright";

const base = process.env.CUEFLOW_URL || "http://127.0.0.1:5177";
const browser = await chromium.launch({ headless: true, executablePath: "/usr/bin/chromium", args: ["--no-sandbox", "--disable-gpu"] });
const context = await browser.newContext({ ...devices["iPhone 13"], reducedMotion: "no-preference" });
const page = await context.newPage();
await page.goto(`${base}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);

const images = page.locator("picture img");
const count = await images.count();
for (let i = 0; i < count; i += 1) {
  await images.nth(i).scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
}
const report = await page.locator("picture img").evaluateAll(nodes => nodes.map((node, index) => {
  const image = node;
  const rect = image.getBoundingClientRect();
  const style = getComputedStyle(image);
  return {
    index,
    src: image.currentSrc,
    natural: [image.naturalWidth, image.naturalHeight],
    rendered: [Math.round(rect.width), Math.round(rect.height)],
    aspect: Number((rect.width / rect.height).toFixed(3)),
    objectFit: style.objectFit,
    classes: image.className,
  };
}));
console.log(JSON.stringify({ base, viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })), report }, null, 2));
await browser.close();
