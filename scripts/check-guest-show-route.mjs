import { chromium } from "playwright";

const origin = process.env.CUEFLOW_URL || "http://127.0.0.1:5177";
const browser = await chromium.launch({ headless: true, executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(5000);

await page.goto(`${origin}/show`, { waitUntil: "domcontentloaded" });
await page.getByRole("heading", { name: "Type your key" }).waitFor();
const guestDoor = await page.getByText("No account needed.", { exact: false }).count();
const joinButton = await page.getByRole("button", { name: "Go in" }).count();
const showPath = new URL(page.url()).pathname;

await page.goto(`${origin}/workspace`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(300);
const protectedPath = new URL(page.url()).pathname;
const workspaceHeading = await page.getByText("Your workspace", { exact: false }).count();

const report = { origin, showPath, guestDoor, joinButton, protectedPath, workspaceHeading };
console.log(JSON.stringify(report, null, 2));
await context.close();
await browser.close();
if (showPath !== "/show" || guestDoor !== 1 || joinButton !== 1 || workspaceHeading !== 0) process.exit(1);
