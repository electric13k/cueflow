import { chromium } from "playwright";

const base = process.env.CUEFLOW_URL || "http://127.0.0.1:4175";
const doc = {
  name: "find-mode-smoke.txt",
  html: "<p>Door slams now. Door slams again. Lights fade.</p>",
  cues: [],
  lookahead: 260,
};
const browser = await chromium.launch({ headless: true, executablePath: "/usr/bin/chromium", args: ["--no-sandbox", "--disable-gpu"] });
const context = await browser.newContext({ reducedMotion: "reduce" });
await context.addInitScript(value => {
  localStorage.setItem("cueflow:script", JSON.stringify(value.doc));
  localStorage.setItem("cueflow:tutorial:complete", "1");
  localStorage.setItem("cueflow:cookies", "necessary");
}, { doc });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.goto(`${base}/script`, { waitUntil: "networkidle" });
await page.waitForTimeout(300);
const necessary = page.getByRole("button", { name: /Only necessary|Accept/i }).first();
if (await necessary.count()) await necessary.click();
await page.waitForTimeout(450);
const notNow = page.getByRole("button", { name: "Not now", exact: true });
if (await notNow.count()) await notNow.click();
await page.waitForTimeout(300);

const find = page.getByPlaceholder("Find in script");
await find.fill("Door slams");
await find.press("Enter");
await page.waitForTimeout(100);
const cuesAfterEnter = await page.locator('input[placeholder="Words, comma separated"]').count();
const phraseValue = cuesAfterEnter ? await page.locator('input[placeholder="Words, comma separated"]').first().inputValue() : "";
const warningSwitches = await page.getByText("Yellow", { exact: true }).count();

await page.getByRole("button", { name: "Select all matches" }).click();
const selectedText = await page.evaluate(() => window.getSelection()?.toString() || "");
await page.getByRole("button", { name: "Select current match" }).click();
const selectedCurrent = await page.evaluate(() => window.getSelection()?.toString() || "");

await page.locator("mark[data-hit]").first().click({ button: "right" });
const menu = page.getByRole("menu");
const menuVisible = await menu.isVisible();
const contextActions = await menu.getByRole("button").allTextContents();
await menu.getByRole("button", { name: "Assign all occurrences" }).click();
await page.waitForTimeout(100);
const cuesAfterContext = await page.locator('input[placeholder="Words, comma separated"]').count();
const body = await page.locator("body").innerText();
const result = { cuesAfterEnter, phraseValue, warningSwitches, selectedText, selectedCurrent, menuVisible, contextActions, cuesAfterContext, errors };
console.log(JSON.stringify(result, null, 2));
await browser.close();
if (errors.length || cuesAfterEnter !== 1 || phraseValue !== "Door slams" || warningSwitches < 1 || !selectedText.includes("Door slams") || selectedCurrent !== "Door slams" || !menuVisible || cuesAfterContext !== 2) process.exit(1);
