import type { Config } from "@netlify/functions";

// Myinstants proxy: ?q= searches (JSON), ?url= streams a sound (avoids browser CORS).
export default async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const url = params.get("url");
  try {
    if (url) {
      if (!/^https:\/\/(www\.)?myinstants\.com\//.test(url)) return Response.json({ error: "only myinstants.com urls" }, { status: 400 });
      const r = await fetch(url);
      if (!r.ok) return Response.json({ error: "sound fetch failed" }, { status: 502 });
      return new Response(await r.arrayBuffer(), {
        headers: { "content-type": r.headers.get("content-type") ?? "audio/mpeg", "cache-control": "public, max-age=86400" },
      });
    }
    const page = await fetch(`https://www.myinstants.com/en/search/?name=${encodeURIComponent((params.get("q") ?? "").trim())}`, { headers: { "user-agent": "Mozilla/5.0" } });
    const html = await page.text();
    const items: { name: string; url: string }[] = [];
    const re = /play\('(\/media\/sounds\/[^']+)'[\s\S]*?class="instant-link[^"]*"[^>]*>([^<]+)</g;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && items.length < 24) {
      const path = m[1];
      if (seen.has(path)) continue;
      seen.add(path);
      items.push({ name: m[2].trim(), url: `https://www.myinstants.com${path}` });
    }
    // Myinstants sits behind Cloudflare, which serves an interstitial challenge to datacenter IPs
    // instead of search results. Say so plainly rather than returning a silent empty list.
    if (params.get("debug")) return Response.json({ items, htmlLength: html.length, head: html.slice(0, 600) });
    if (!items.length && /challenges\.cloudflare\.com|Just a moment/.test(html)) {
      return Response.json({ error: "Myinstants is blocking this server (Cloudflare bot check). Paste a direct sound URL instead.", items: [] }, { status: 503 });
    }
    return Response.json({ items }, { headers: { "cache-control": "public, max-age=300" } });
  } catch (e: any) {
    return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
};

export const config: Config = { path: "/api/myinstants" };
