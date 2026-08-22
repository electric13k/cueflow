import { chromium } from "playwright";

const base = process.env.CUEFLOW_URL || "http://127.0.0.1:4175";
const browser = await chromium.launch({ headless: true, executablePath: "/usr/bin/chromium", args: ["--no-sandbox", "--disable-gpu"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
await context.addInitScript(() => {
  localStorage.setItem("cueflow:layout", JSON.stringify({ pane: "panel", density: "comfy" }));
  localStorage.setItem("cueflow:tutorial:complete", "1");
  localStorage.setItem("cueflow:cookies", "necessary");
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.goto(`${base}/studio`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(900);
await page.addStyleTag({ content: '[role="dialog"] { display: none !important; }' });
const sidebar = page.locator('[data-cue-menu="desktop-sidebar"]');
await sidebar.waitFor({ state: "attached", timeout: 5000 });
const before = await sidebar.evaluate(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, position: getComputedStyle(el).position }; });
await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" }));
await page.waitForTimeout(180);
const after = await sidebar.evaluate(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, position: getComputedStyle(el).position }; });
const typography = await page.evaluate(() => {
  const bodyCopy = document.querySelector("main p, main label, main .text-muted");
  const button = document.querySelector("button:not([aria-label])");
  return {
    body: bodyCopy ? getComputedStyle(bodyCopy).fontFamily : "",
    button: button ? getComputedStyle(button).fontFamily : "",
  };
});
await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(700);
const quote = await page.locator(".editorial-quote").first().evaluate(el => getComputedStyle(el).fontFamily).catch(() => "");
const result = { before, after, scrollY: await page.evaluate(() => window.scrollY), typography, quote, errors };
console.log(JSON.stringify(result, null, 2));
await browser.close();
const sidebarPinned = after.position === "fixed" && after.top >= 0 && after.top < 140 && after.bottom <= 900;
const fontsSeparated = typography.body.includes("Corbel") && !typography.button.includes("Corbel") && quote.includes("Bodoni");
if (errors.length || !sidebarPinned || !fontsSeparated) process.exit(1);
