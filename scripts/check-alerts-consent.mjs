import { chromium } from "playwright";

const base = process.env.CUEFLOW_URL || "http://127.0.0.1:4175";
const browser = await chromium.launch({ headless: true, executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));

await page.goto(`${base}/settings`, { waitUntil: "networkidle" });
const consent = page.getByRole("dialog", { name: "Cookie consent" });
if (await consent.count() !== 1) throw new Error("Cookie consent dialog did not appear for a fresh context");
await consent.getByRole("button", { name: "Only necessary", exact: true }).click();
await consent.waitFor({ state: "detached", timeout: 3000 });

const surface = page.getByRole("radiogroup", { name: "Alert surface" });
await surface.getByRole("radio", { name: "Script only", exact: true }).click();
if (await page.evaluate(() => localStorage.getItem("cueflow:alertScope")) !== "script") throw new Error("Script-only alert scope did not persist");
if (await page.getByRole("button", { name: "Restore demo resources", exact: true }).count() !== 1) throw new Error("Demo restore control is missing");

await page.goto(`${base}/cookies`, { waitUntil: "networkidle" });
if (!(await page.getByRole("heading", { name: "Cookies and local storage" }).count())) throw new Error("Cookies policy route did not load");

await page.goto(`${base}/audience`, { waitUntil: "networkidle" });
if (await page.locator(".flash-hit, .flash-warn").count() !== 0) throw new Error("Audience view contains an alert overlay");
const pointerEvents = await page.evaluate(() => {
  const node = document.createElement("div");
  node.className = "flash-hit";
  document.body.append(node);
  const value = getComputedStyle(node).pointerEvents;
  node.remove();
  return value;
});
if (pointerEvents !== "none") throw new Error(`Alert overlay intercepts pointer input: ${pointerEvents}`);
if (errors.length) throw new Error(errors.join("\n"));

console.log(JSON.stringify({ base, consent: "opt-out", alertScope: "script", audienceAlertCount: 0, pointerEvents, errors }, null, 2));
await browser.close();
