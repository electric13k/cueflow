import { chromium } from "playwright";

const origins = (process.env.CUEFLOW_ORIGINS || "https://cueflow.pages.dev,https://cuefloww.vercel.app").split(",");
const browser = await chromium.launch({ headless: true, executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
const results = [];

for (const origin of origins) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem("cueflow:onboarded", "1");
    localStorage.setItem("cueflow:signin-prompt", "dismissed");
    localStorage.setItem("cueflow:tour", JSON.stringify({ done: true, step: 0 }));
    sessionStorage.setItem("cueflow:demo-cleared", "1");
    document.cookie = "cueflow:consent=accepted; path=/";
  });
  const page = await context.newPage();
  const errors = [];
  const authRequests = [];
  page.on("pageerror", error => errors.push(`pageerror: ${error.message}`));
  page.on("console", message => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  page.on("request", request => {
    if (/supabase\.co\/auth\/v1\/authorize|accounts\.google\.com/.test(request.url())) authRequests.push(request.url());
  });
  await page.route("**://accounts.google.com/**", route => route.abort());
  try {
    await page.goto(`${origin}/studio`, { waitUntil: "domcontentloaded", timeout: 15000 });
    const signIn = page.getByRole("button", { name: /^sign in$/i }).first();
    const signInVisible = await signIn.isVisible().catch(() => false);
    if (signInVisible) await signIn.click();
    const google = page.getByRole("button", { name: /continue with google/i });
    const googleVisible = await google.isVisible().catch(() => false);
    if (googleVisible) {
      await google.evaluate(element => element.click()).catch(() => {});
      await page.waitForTimeout(2500);
    }
    results.push({
      origin,
      signInVisible,
      googleVisible,
      googleRedirectStarted: authRequests.length > 0,
      authorizationHost: authRequests[0] ? new URL(authRequests[0]).host : "",
      errors: errors.slice(0, 10),
    });
  } catch (error) {
    results.push({ origin, error: error.message, errors: errors.slice(0, 10) });
  } finally {
    await context.close();
  }
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
