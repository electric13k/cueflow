import type { Config } from "@netlify/functions";

// Server-side audio fetcher. Browsers cannot fetch most remote audio directly, the host sends no
// CORS headers, so the request fails and, worse, an <audio crossOrigin="anonymous"> element refuses
// to load it at all. Fetching here and re-uploading to our own storage sidesteps both.
//
// This is a URL fetcher exposed to the internet, so it is deliberately narrow: public http(s) hosts
// only, no redirects into private space, audio content-types, size-capped.
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

export default async (req: Request) => {
  const raw = new URL(req.url).searchParams.get("url");
  if (!raw) return Response.json({ error: "Missing url" }, { status: 400 });

  let target = check(raw);
  if ("error" in target) return Response.json({ error: target.error }, { status: 400 });

  // Follow redirects by hand so every hop is re-checked against the private-address list.
  let res: Response | undefined;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    res = await fetch(target.url!.toString(), {
      redirect: "manual",
      headers: { "user-agent": "Mozilla/5.0 (compatible; CueFlow/1.0)", accept: "audio/*,*/*;q=0.8" },
    });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!next) break;
    const hopped = check(new URL(next, target.url!).toString());
    if ("error" in hopped) return Response.json({ error: hopped.error }, { status: 400 });
    target = hopped;
    res = undefined;
  }
  if (!res) return Response.json({ error: "That link redirects too many times." }, { status: 400 });
  if (!res.ok) return Response.json({ error: `The host returned ${res.status} for that link.` }, { status: 502 });

  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  const looksAudio = type.startsWith("audio/") || type.startsWith("video/") || type.includes("octet-stream");
  if (!looksAudio) {
    return Response.json({ error: "That link is a web page, not an audio file. Copy the address of the sound itself (it usually ends in .mp3, .wav, .ogg or .m4a)." }, { status: 415 });
  }

  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return Response.json({ error: "That file is bigger than 25 MB." }, { status: 413 });
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return Response.json({ error: "That file is bigger than 25 MB." }, { status: 413 });

  return new Response(bytes, {
    headers: { "content-type": type.split(";")[0] || "audio/mpeg", "cache-control": "public, max-age=86400" },
  });
};

export const config: Config = { path: "/api/audio" };
