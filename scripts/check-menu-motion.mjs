import { chromium, devices } from "playwright";

const base = process.env.CUEFLOW_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch({ headless: true, executablePath: "/usr/bin/chromium", args: ["--no-sandbox", "--disable-gpu"] });
const errors = [];

async function checkPhone() {
  const context = await browser.newContext({ ...devices["iPhone 13"], reducedMotion: "no-preference" });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(`phone: ${error.message}`));
  await page.goto(`${base}/studio`, { waitUntil: "networkidle" });
  await page.waitForTimeout(250);
  await page.addStyleTag({ content: '[role="dialog"] { display: none !important; }' });
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  await menu.click();
  const drawer = page.locator('[data-cue-menu="drawer"]');
  const scrim = page.locator('[data-cue-menu="scrim"]');
  if (await drawer.count() !== 1 || await scrim.count() !== 1) throw new Error("Phone drawer or scrim did not mount");
  const enteringX = await drawer.evaluate(element => getComputedStyle(element).transform);
  await page.waitForTimeout(360);
  const restingX = await drawer.evaluate(element => getComputedStyle(element).transform);
  await drawer.getByRole("button", { name: "Close", exact: true }).click();
  await page.waitForTimeout(360);
  const remaining = await page.locator('[data-cue-menu="drawer"]').count();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (remaining !== 0) throw new Error("Phone drawer did not finish its exit");
  if (overflow > 1) throw new Error(`Phone page has horizontal overflow: ${overflow}px`);
  await context.close();
  return { enteringX, restingX, overflow };
}

async function checkDesktop() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(`desktop: ${error.message}`));
  await page.goto(`${base}/studio`, { waitUntil: "networkidle" });
  await page.waitForTimeout(350);
  await page.addStyleTag({ content: '[role="dialog"] { display: none !important; }' });
  const sidebar = page.locator('[data-cue-menu="desktop-sidebar"]');
  if (await sidebar.count() !== 1) throw new Error("Desktop sidebar did not mount");
  const before = await sidebar.evaluate(element => getComputedStyle(element).transform);
  const hide = page.getByRole("button", { name: "Hide sidebar", exact: true });
  await hide.click();
  await page.waitForTimeout(100);
  const during = await page.locator('[data-cue-menu="desktop-sidebar"]').count();
  await page.waitForTimeout(360);
  const after = await page.locator('[data-cue-menu="desktop-sidebar"]').count();
  const show = page.getByRole("button", { name: "Show sidebar", exact: true });
  await show.click();
  await page.waitForTimeout(360);
  const restored = await page.locator('[data-cue-menu="desktop-sidebar"]').count();
  if (during !== 1 || after !== 0 || restored !== 1) throw new Error("Desktop sidebar transition did not complete");
  await context.close();
  return { before, during, after, restored };
}

const phone = await checkPhone();
const desktop = await checkDesktop();
console.log(JSON.stringify({ phone, desktop, errors }, null, 2));
await browser.close();
if (errors.length) process.exit(1);
