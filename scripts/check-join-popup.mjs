import { chromium } from "playwright";

const origin = process.env.CUEFLOW_URL || "http://127.0.0.1:4177";
const browser = await chromium.launch({ headless: true, executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
const results = [];
for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.goto(`${origin}/show`, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.getByRole("dialog", { name: "Type your key" }).waitFor();
  const scrim = page.locator(".show-join-scrim");
  const dialog = page.getByRole("dialog", { name: "Type your key" });
  const close = page.getByRole("button", { name: "Close join a show" });
  const result = {
    viewport,
    dialogVisible: await dialog.isVisible(),
    closeVisible: await close.isVisible(),
    scrimBackground: await scrim.evaluate(el => getComputedStyle(el).backgroundColor),
    dialogWidth: await dialog.evaluate(el => Math.round(el.getBoundingClientRect().width)),
  };
  await close.click();
  await page.waitForTimeout(250);
  result.closedByX = new URL(page.url()).pathname !== "/show";
  await page.goto(`${origin}/show`, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.getByRole("dialog", { name: "Type your key" }).waitFor();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  result.closedByEscape = new URL(page.url()).pathname !== "/show";
  results.push(result);
  await context.close();
}
console.log(JSON.stringify({ origin, results }, null, 2));
await browser.close();
if (results.some(r => !r.dialogVisible || !r.closeVisible || !r.closedByX || !r.closedByEscape || !r.scrimBackground.includes("0.72"))) process.exit(1);
