/**
 * Cloudflare Pages Functions run the same two endpoints as Netlify (netlify/functions/*.mts) and
 * Vercel (api/*.ts). All three are plain Web `Request` -> `Response`, so the logic lives here once
 * and each route file is a two-line adapter. Files starting with `_` are not routed by Pages.
 *
 * Keep the guards in this file in step with the Netlify and Vercel twins if you touch them.
 */
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_HOPS = 4;
const LIMITS = { name: 80, email: 254, message: 4000 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const PRIVATE = [
  /^localhost$/i, /\.local$/i, /^\[?::1\]?$/, /^0\./,
  /^127\./, /^10\./, /^192\.168\./, /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
];

function check(raw: string) {
  let u: URL;
  try { u = new URL(raw); } catch { return { error: "That doesn't look like a URL." }; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { error: "Only http and https links can be imported." };
  if (PRIVATE.some(re => re.test(u.hostname))) return { error: "That address isn't reachable from the internet." };
  return { url: u };
}

/**
 * Server-side media fetcher (audio, image, video). Browsers cannot fetch most remote media directly,
 * the host sends no CORS headers. Deliberately narrow: public http(s) only, no redirects into
 * private space, media content-types, size-capped.
 */
export async function audio(req: Request): Promise<Response> {
  const raw = new URL(req.url).searchParams.get("url");
  if (!raw) return json({ error: "Missing url" }, 400);

  let target = check(raw);
  if ("error" in target) return json({ error: target.error }, 400);

  // Follow redirects by hand so every hop is re-checked against the private-address list.
  let res: Response | undefined;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    res = await fetch(target.url!.toString(), {
      redirect: "manual",
      headers: { "user-agent": "Mozilla/5.0 (compatible; CueFlow/1.0)", accept: "audio/*,image/*,video/*,*/*;q=0.8" },
    });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!next) break;
    const hopped = check(new URL(next, target.url!).toString());
    if ("error" in hopped) return json({ error: hopped.error }, 400);
    target = hopped;
    res = undefined;
  }
  if (!res) return json({ error: "That link redirects too many times." }, 400);
  if (!res.ok) return json({ error: `The host returned ${res.status} for that link.` }, 502);

  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  const looksMedia = ["audio/", "video/", "image/"].some(p => type.startsWith(p)) || type.includes("octet-stream");
  if (!looksMedia) {
    return json({ error: "That link is a web page, not a media file. Copy the address of the file itself (it usually ends in .mp3, .wav, .ogg, .m4a, .png, .jpg or .mp4)." }, 415);
  }

  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return json({ error: "That file is bigger than 25 MB." }, 413);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return json({ error: "That file is bigger than 25 MB." }, 413);

  return new Response(bytes, {
    headers: { "content-type": type.split(";")[0] || "audio/mpeg", "cache-control": "public, max-age=86400" },
  });
}

/** Contact form -> Slack. Without SLACK_WEBHOOK_URL bound it reports "not configured" rather than 500ing. */
export async function contact(req: Request, hook?: string): Promise<Response> {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Expected JSON" }, 400); }

  if (typeof body.company === "string" && body.company.trim()) return json({ ok: true }); // honeypot

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim();
  const message = String(body.message ?? "").trim();
  const topic = String(body.topic ?? "").trim() || "General";

  if (!message) return json({ error: "Please write a message." }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "That email address looks wrong." }, 400);
  if (name.length > LIMITS.name || email.length > LIMITS.email || message.length > LIMITS.message) {
    return json({ error: "That's longer than the form accepts." }, 400);
  }
  if (!hook) return json({ error: "Contact form is not configured yet. Try again later." }, 503);

  const res = await fetch(hook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: `New CueFlow message, ${topic}`,
      blocks: [
        { type: "header", text: { type: "plain_text", text: `CueFlow: ${topic}` } },
        { type: "section", text: { type: "mrkdwn", text: message.slice(0, LIMITS.message) } },
        { type: "context", elements: [{ type: "mrkdwn", text: `*From:* ${name || "anonymous"}${email ? ` <mailto:${email}|${email}>` : ", no reply address given"}` }] },
      ],
    }),
  });
  if (!res.ok) return json({ error: "Could not deliver that message. Try again in a moment." }, 502);
  return json({ ok: true });
}
