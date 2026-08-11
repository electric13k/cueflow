// Cuts every raster icon from public/brand/cf-dark.png, so the mark is supplied once and never drifts.
//   node scripts/icons.mjs
// Writes apple-touch-icon.png, icon-192.png, icon-512.png, favicon.ico and og.png.
import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";

const OUT = "public";
const MARK = `data:image/png;base64,${(await readFile(`${OUT}/brand/cf-dark.png`)).toString("base64")}`;

const browser = await chromium.launch();

/** The mark on a transparent page at exactly n by n, screenshotted. */
async function cut(n, radius = Math.round(n * 0.22)) {
  const page = await browser.newPage({ viewport: { width: n, height: n } });
  await page.setContent(
    `<body style="margin:0"><img id="m" src="${MARK}" style="display:block;width:${n}px;height:${n}px;border-radius:${radius}px"></body>`);
  await page.waitForFunction(() => { const i = document.getElementById("m"); return i && i.complete && i.naturalWidth > 0; });
  const png = await page.screenshot({ omitBackground: true });
  await page.close();
  return png;
}

for (const [name, n] of [["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512]]) {
  await writeFile(`${OUT}/${name}`, await cut(n));
  console.log("wrote", name);
}

/**
 * An .ico wrapping one 64x64 PNG. ICO has carried PNG payloads since Vista and every browser in
 * scope reads them, so this is a 22-byte header rather than a bitmap encoder and a dependency.
 * Width and height bytes are 0 when the image is 256px; at 64 they are literal.
 */
const png = await cut(64, 10);
const ico = Buffer.alloc(22 + png.length);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); // reserved, type=icon, count
ico.writeUInt8(64, 6); ico.writeUInt8(64, 7);                             // width, height
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);                      // planes, bits per pixel
ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);             // size, offset
png.copy(ico, 22);
await writeFile(`${OUT}/favicon.ico`, ico);
console.log("wrote favicon.ico");

// The social card. Cream ground, so it takes the maroon-ground mark for contrast.
const og = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await og.setContent(`<body style="margin:0;height:630px;display:flex;flex-direction:column;justify-content:center;
  gap:28px;padding:0 88px;background:#F3E9D8;font-family:Georgia,'Times New Roman',serif;color:#2B2420">
  <div style="display:flex;align-items:center;gap:24px">
    <img id="m" src="${MARK}" style="width:108px;height:108px;border-radius:24px">
    <span style="font-size:76px;font-weight:700;letter-spacing:-.02em">CueFlow</span>
  </div>
  <p style="margin:0;font-size:46px;line-height:1.15;max-width:15ch;font-weight:700">Run the whole show off one key.</p>
  <p style="margin:0;font-size:28px;color:#5B5048">A cue board in a browser tab.</p>
</body>`);
await og.waitForFunction(() => { const i = document.getElementById("m"); return i && i.complete && i.naturalWidth > 0; });
await writeFile(`${OUT}/og.png`, await og.screenshot());
console.log("wrote og.png");

await browser.close();
