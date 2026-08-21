import { chromium } from "playwright";

const origin = process.env.CUEFLOW_URL || "http://127.0.0.1:5177";
const routes = ["/", "/features", "/studio", "/settings", "/account", "/workspace", "/projects", "/show", "/script", "/tutorial", "/credits", "/contact", "/terms", "/privacy", "/audience"];
const safeControls = [
  /^library$/i, /^sequences$/i, /^deck$/i, /^shows$/i, /^script$/i,
  /^new sequence$/i, /^export$/i, /^undo$/i, /^redo$/i,
  /^open run history$/i, /^open command palette$/i, /^rehearsal$/i,
  /^save template$/i, /^duplicate$/i, /^new collection$/i,
  /^most useful$/i, /^newest$/i, /^oldest$/i,
  /^light mode$/i, /^dark mode$/i, /^toggle theme$/i,
];
const browser = await chromium.launch({ headless: true, executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript(() => {
  localStorage.setItem("cueflow:onboarded", "1");
  localStorage.setItem("cueflow:signin-prompt", "dismissed");
  localStorage.setItem("cueflow:tour", JSON.stringify({ done: true, step: 0 }));
  localStorage.setItem("cueflow:taught", JSON.stringify(["studio", "library", "editor", "sequence", "armed", "script", "show", "sidebar", "projects", "presenter", "transport"]));
  sessionStorage.setItem("cueflow:demo-cleared", "1");
  document.cookie = "cueflow:consent=accepted; path=/";
});
const page = await context.newPage();
page.setDefaultTimeout(2500);
page.setDefaultNavigationTimeout(10000);
await page.route("https://**/*", route => route.abort());
const errors = [];
page.on("pageerror", error => errors.push(`pageerror: ${error.message}`));
page.on("console", message => {
  if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(`console: ${message.text()}`);
});
const results = [];

for (const route of routes) {
  const before = errors.length;
  const result = { route, loaded: false, finalPath: "", links: [], controls: [], clicked: [], failures: [] };
  try {
    await page.goto(`${origin}${route}`, { waitUntil: "commit", timeout: 10000 });
    await page.waitForTimeout(300);
    result.loaded = true;
    result.finalPath = new URL(page.url()).pathname;
    result.links = await page.locator("a[href]:visible").evaluateAll(nodes => [...new Set(nodes.map(node => (node.textContent || node.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim()).filter(Boolean))]);
    result.controls = await page.locator("button:visible").evaluateAll(nodes => [...new Set(nodes.map(node => (node.textContent || node.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim()).filter(Boolean))]);
    for (const pattern of safeControls) {
      const candidate = page.getByRole("button", { name: pattern }).first();
      if (!await candidate.isVisible().catch(() => false)) continue;
      if (!await candidate.isEnabled().catch(() => false)) continue;
      try {
        await candidate.click({ timeout: 1800 });
        result.clicked.push((await candidate.innerText().catch(() => "")) || pattern.toString());
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(80);
      } catch (error) {
        result.failures.push(`${pattern}: ${error.message}`);
      }
    }
  } catch (error) {
    result.failures.push(error.message);
  }
  result.failures.push(...errors.slice(before));
  results.push(result);
}
await context.close();
await browser.close();
const failedRoutes = results.filter(result => !result.loaded || result.failures.length);
console.log(JSON.stringify({ origin, results, failedRoutes: failedRoutes.length, errors }, null, 2));
process.exitCode = failedRoutes.length ? 1 : 0;
