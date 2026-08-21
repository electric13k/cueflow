const origin = process.env.CUEFLOW_ORIGIN || "https://cueflow.pages.dev";
const html = await (await fetch(origin)).text();
const assets = [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map(match => new URL(match[1], origin).href);
let bundle = "";
for (const asset of assets) bundle += `\n${await (await fetch(asset)).text()}`;
const supabaseUrl = bundle.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[0];
const publishableKey = bundle.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0];
if (!supabaseUrl || !publishableKey) {
  console.log(JSON.stringify({ origin, assets: assets.length, supabaseConfigured: false }, null, 2));
  process.exit(0);
}
const settingsResponse = await fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: publishableKey } });
const settings = await settingsResponse.json().catch(() => ({}));
const publicSettings = {
  externalGoogle: settings.external?.google ?? settings.external?.google_oidc ?? null,
  externalGithub: settings.external?.github ?? null,
  disableSignup: settings.disable_signup ?? null,
  mailerAutoconfirm: settings.mailer_autoconfirm ?? null,
  uriAllowList: settings.uri_allow_list ?? settings.uri_allowlist ?? null,
  siteUrl: settings.site_url ?? null,
  status: settingsResponse.status,
};
console.log(JSON.stringify({ origin, assets: assets.length, supabaseConfigured: true, supabaseHost: new URL(supabaseUrl).host, settings: publicSettings }, null, 2));
