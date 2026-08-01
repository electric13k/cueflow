// Vercel serverless proxy for Myinstants: ?q= searches (returns JSON), ?url= streams a sound (avoids browser CORS).
export default async function handler(req: any, res: any) {
  const q = req.query?.q as string | undefined;
  const url = req.query?.url as string | undefined;
  try {
    if (url) {
      if (!/^https:\/\/(www\.)?myinstants\.com\//.test(url)) return res.status(400).json({ error: "only myinstants.com urls" });
      const r = await fetch(url);
      if (!r.ok) return res.status(502).json({ error: "sound fetch failed" });
      const buf = Buffer.from(await r.arrayBuffer());
      res.setHeader("content-type", r.headers.get("content-type") || "audio/mpeg");
      res.setHeader("cache-control", "public, max-age=86400");
      return res.status(200).send(buf);
    }
    const page = await fetch(`https://www.myinstants.com/en/search/?name=${encodeURIComponent((q ?? "").trim())}`, { headers: { "user-agent": "Mozilla/5.0" } });
    const html = await page.text();
    const items: { name: string; url: string }[] = [];
    const re = /play\('(\/media\/sounds\/[^']+)'[\s\S]*?class="instant-link[^"]*"[^>]*>([^<]+)</g;
    let m: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((m = re.exec(html)) && items.length < 24) {
      const path = m[1];
      if (seen.has(path)) continue; seen.add(path);
      items.push({ name: m[2].trim(), url: `https://www.myinstants.com${path}` });
    }
    res.setHeader("cache-control", "public, max-age=300");
    return res.status(200).json({ items });
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message ?? e) });
  }
}
