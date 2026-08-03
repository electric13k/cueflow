// Vercel twin of netlify/functions/audio.mts. Same guards, same behaviour, so /api/audio works
// identically on either host. Edge runtime: standard Request/Response, no Node-only APIs.
export const config = { runtime: "edge" };

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_HOPS = 4;

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

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default async function handler(req: Request): Promise<Response> {
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
  if (!looksMedia) return json({ error: "That link is a web page, not a media file. Copy the address of the file itself (it usually ends in .mp3, .wav, .ogg, .m4a, .png, .jpg or .mp4)." }, 415);

  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return json({ error: "That file is bigger than 25 MB." }, 413);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return json({ error: "That file is bigger than 25 MB." }, 413);

  return new Response(bytes, {
    headers: { "content-type": type.split(";")[0] || "audio/mpeg", "cache-control": "public, max-age=86400" },
  });
}
