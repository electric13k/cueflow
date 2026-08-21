import { chromium } from "playwright";

const origin = process.env.CUEFLOW_URL || "http://127.0.0.1:5177";
const browser = await chromium.launch({ headless: true, executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.setDefaultTimeout(7000);
const runtimeErrors = [];
page.on("pageerror", error => runtimeErrors.push(error.message));
await page.goto(`${origin}/studio`, { waitUntil: "domcontentloaded", timeout: 15000 });
await page.waitForSelector("body", { state: "attached", timeout: 15000 });
await page.waitForTimeout(1500);
if (await page.locator(".cue-select__trigger").count() === 0) {
  console.log(JSON.stringify({ origin, path: new URL(page.url()).pathname, title: await page.title(), body: (await page.locator("body").innerText({ timeout: 3000 }).catch(() => "")).slice(0, 500), runtimeErrors }, null, 2));
  await context.close();
  await browser.close();
  process.exit(1);
}
await page.locator(".cue-select__trigger").first().waitFor();
const skipTour = page.getByRole("button", { name: "Skip the tour" });
if (await skipTour.count()) await skipTour.click();
await page.waitForTimeout(250);

const trigger = page.locator(".cue-select__trigger").first();
const before = (await trigger.innerText()).trim();
await trigger.click();
const popover = page.locator(".cue-select__popover").last();
await popover.waitFor();
const optionCount = await popover.locator(".cue-select__item").count();
const darkBefore = await page.evaluate(() => {
  document.documentElement.classList.add("theme-dark");
  return getComputedStyle(document.documentElement).getPropertyValue("--surface");
});
const popoverBackground = await popover.evaluate(el => getComputedStyle(el).backgroundColor);
await popover.locator(".cue-select__item").nth(1).click();
const after = (await trigger.innerText()).trim();
const triggerClass = await trigger.getAttribute("class");

const report = { origin, before, after, optionCount, darkSurface: darkBefore.trim(), popoverBackground, hasCueflowTrigger: triggerClass?.includes("cue-select__trigger") ?? false };
console.log(JSON.stringify(report, null, 2));
await context.close();
await browser.close();
if (optionCount < 2 || before === after || !report.hasCueflowTrigger) process.exit(1);
