const supabaseUrl = "https://uumbvunbgcbkzoenupay.supabase.co";
const publishableKey = "sb_publishable_UVLFeDFDrxvAeVesqdEeHw_pdQRrzLb";
const redirects = ["https://cueflow.pages.dev/workspace", "https://cuefloww.vercel.app/workspace"];
const results = [];
for (const redirectTo of redirects) {
  const url = new URL(`${supabaseUrl}/auth/v1/authorize`);
  url.searchParams.set("provider", "google");
  url.searchParams.set("redirect_to", redirectTo);
  const response = await fetch(url, { headers: { apikey: publishableKey }, redirect: "manual" });
  const location = response.headers.get("location");
  results.push({
    redirectTo,
    status: response.status,
    accepted: response.status >= 300 && response.status < 400 && Boolean(location),
    locationHost: location ? new URL(location).host : "",
    locationPath: location ? new URL(location).pathname : "",
    body: location ? "" : (await response.text()).slice(0, 300),
  });
}
console.log(JSON.stringify(results, null, 2));
