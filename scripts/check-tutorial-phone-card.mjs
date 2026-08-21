import { chromium } from "playwright";

const origin = process.env.CUEFLOW_URL || "http://127.0.0.1:5177";
const browser = await chromium.launch({ headless: true, executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(5000);

async function visibleCards(viewport) {
  await page.setViewportSize(viewport);
  await page.goto(`${origin}/tutorial`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  const phone = page.locator(".tutorial-phone-only:visible");
  const cards = page.locator("section button[aria-label*='flip for details']:visible");
  return { viewport, phoneCards: await phone.count(), totalCards: await cards.count() };
}

const desktop = await visibleCards({ width: 1280, height: 900 });
const phone = await visibleCards({ width: 390, height: 844 });
await context.close();
await browser.close();
const report = { origin, desktop, phone };
console.log(JSON.stringify(report, null, 2));
if (desktop.phoneCards !== 0 || desktop.totalCards !== 3 || phone.phoneCards !== 1 || phone.totalCards !== 4) process.exit(1);
