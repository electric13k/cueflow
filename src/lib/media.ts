import type { Kind } from "../types";

// --- What kind of asset is this? -------------------------------------------------------------
const EXT: Record<string, Kind> = {
  mp3: "audio", wav: "audio", ogg: "audio", oga: "audio", m4a: "audio", aac: "audio", flac: "audio", opus: "audio", weba: "audio",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", avif: "image", svg: "image", bmp: "image",
  mp4: "video", webm: "video", mov: "video", m4v: "video", ogv: "video", mkv: "video",
};
const extOf = (name: string) => (name.split(/[?#]/)[0].split(".").pop() ?? "").toLowerCase();

export function kindFromFile(file: File): Kind | null {
  const [top] = file.type.split("/");
  if (top === "audio" || top === "image" || top === "video") return top;
  return EXT[extOf(file.name)] ?? null; // some browsers report "" for .flac / .m4a
}
export const kindFromUrl = (url: string): Kind => EXT[extOf(url)] ?? "audio";

/** Google Slides / PowerPoint Online / Canva links present as a slide deck we embed rather than host. */
export function embedUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.replace(/^www\./, "");
  if (host === "docs.google.com" && u.pathname.includes("/presentation/")) {
    // /edit and /pub both work as /embed, which is the only view without the Google chrome.
    return `${u.origin}${u.pathname.replace(/\/(edit|pub|view|preview|htmlpresent).*$/, "")}/embed?start=false&loop=false&rm=minimal`;
  }
  if (host.endsWith("officeapps.live.com") || host.endsWith("sharepoint.com") || host.endsWith("office.com")) return raw;
  if (host === "canva.com" && u.pathname.includes("/design/")) return raw.replace(/\/(view|edit).*$/, "/view?embed");
  return null;
}

// --- Auto-naming ------------------------------------------------------------------------------
/**
 * "airhorn-2_final.mp3", "%20vine%20boom_45123", "IMG_2481.JPG" -> "Airhorn 2 Final", "Vine Boom",
 * "IMG 2481". Trailing numeric ids that CDNs append are noise; a real word is not.
 */
export function prettyName(raw: string) {
  let slug = raw;
  try { slug = decodeURIComponent(new URL(raw, location.href).pathname.split("/").filter(Boolean).pop() ?? raw); }
  catch { slug = decodeURIComponent(raw.split(/[?#]/)[0].split("/").filter(Boolean).pop() ?? raw); }
  const words = slug
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/[-_+]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")      // camelCase exports from editing apps
    .replace(/\s*\b\d{4,}\b\s*$/, "")          // …_45123 style ids
    .replace(/\s+/g, " ")
    .trim();
  if (!words) return "Untitled";
  return words.replace(/\b\w/g, c => c.toUpperCase());
}

/** "Airhorn" against an existing "Airhorn" -> "Airhorn 2". Keeps a library of imports readable. */
export function uniqueTitle(base: string, taken: string[]) {
  const lower = new Set(taken.map(t => t.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!lower.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

// --- Download ---------------------------------------------------------------------------------
/**
 * Saves an asset to disk. Same-origin and Supabase URLs fetch cleanly, so they download under a
 * proper filename; anything the browser refuses to read cross-origin falls back to a plain link,
 * which at worst opens it in a tab the user can save from.
 */
export async function downloadAsset(url: string, title: string) {
  const name = `${title.replace(/[\\/:*?"<>|]+/g, "-")}.${extOf(url) || "mp3"}`;
  let href = url, blobUrl = "";
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    href = blobUrl = URL.createObjectURL(await res.blob());
  } catch { /* cross-origin without CORS: let the browser handle the plain href */ }
  const a = Object.assign(document.createElement("a"), { href, download: name, rel: "noreferrer" });
  document.body.append(a); a.click(); a.remove();
  if (blobUrl) setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
}

// --- Search providers -------------------------------------------------------------------------
export type Source = "library" | "archive" | "commons" | "myinstants" | "url";
export type Hit = { id: string; title: string; by?: string; source: Source; url?: string; archiveId?: string };

const j = async (url: string) => { const r = await fetch(url); if (!r.ok) throw new Error(`Search failed (${r.status})`); return r.json(); };

/** Internet Archive: millions of public-domain and CC recordings, open JSON API, CORS enabled. */
export async function searchArchive(q: string): Promise<Hit[]> {
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(`${q} AND mediatype:(audio)`)}&fl[]=identifier&fl[]=title&fl[]=creator&rows=15&page=1&output=json`;
  const data = await j(url) as { response?: { docs?: { identifier: string; title?: string | string[]; creator?: string | string[] }[] } };
  const one = (v?: string | string[]) => Array.isArray(v) ? v[0] : v;
  return (data.response?.docs ?? []).map(d => ({
    id: d.identifier, source: "archive" as const, archiveId: d.identifier,
    title: one(d.title) ?? d.identifier, by: one(d.creator),
  }));
}

/** Wikimedia Commons: freely licensed audio, open API, CORS enabled via origin=*. */
export async function searchCommons(q: string): Promise<Hit[]> {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(`filetype:audio ${q}`)}&gsrnamespace=6&gsrlimit=15&prop=imageinfo&iiprop=url|mime`;
  const data = await j(url) as { query?: { pages?: Record<string, { title: string; imageinfo?: { url: string; mime: string }[] }> } };
  // Commons reports Ogg Vorbis as application/ogg, so a plain audio/* test drops half the results.
  const playable = (mime = "") => mime.startsWith("audio/") || mime === "application/ogg";
  return Object.values(data.query?.pages ?? {})
    .filter(p => playable(p.imageinfo?.[0]?.mime))
    .map(p => ({ id: p.title, source: "commons" as const, title: p.title.replace(/^File:/, "").replace(/\.[^.]+$/, ""), url: p.imageinfo![0].url, by: "Wikimedia Commons" }));
}

/** Archive results name a collection, not a file, so the playable URL is resolved on import. */
export async function resolveHit(hit: Hit): Promise<string> {
  if (hit.url) return hit.url;
  if (!hit.archiveId) throw new Error("That result has no audio file.");
  const meta = await j(`https://archive.org/metadata/${encodeURIComponent(hit.archiveId)}`) as { files?: { name: string; format?: string }[] };
  const file = (meta.files ?? []).find(f => /\.(mp3|ogg|m4a|wav|flac)$/i.test(f.name));
  if (!file) throw new Error("That item has no downloadable audio file.");
  return `https://archive.org/download/${encodeURIComponent(hit.archiveId)}/${encodeURIComponent(file.name)}`;
}
