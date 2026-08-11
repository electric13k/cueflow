/**
 * Netlify, Vercel and Cloudflare Pages all run the /api functions. GitHub Pages is static hosting
 * with no server at all, and its SPA fallback answers /api/... with index.html rather than a 404,
 * so a runtime probe would happily "succeed" and hand back HTML. The build says which it is.
 */
export const hasApi = import.meta.env.VITE_STATIC_HOST !== "1";

/**
 * Where the full-featured build lives, for pointing at when this one cannot do something.
 *
 * Cloudflare Pages, because that is the deployment that is actually current. Whatever this says has
 * to agree with Supabase's Site URL, which is what every auth email builds its link from.
 */
export const PRIMARY_ORIGIN = "https://cueflow.pages.dev";

/**
 * Pulls a remote file down for import. The proxy exists because most hosts send no CORS headers;
 * without it we can only import from hosts that allow cross-origin reads, which is the case for the
 * Internet Archive and Wikimedia Commons searches but not for a random link.
 */
export async function fetchMedia(src: string): Promise<Blob> {
  if (hasApi) {
    const res = await fetch(`/api/audio?url=${encodeURIComponent(src)}`);
    if (res.ok) return res.blob();
    const { error } = await res.json().catch(() => ({ error: "" }));
    throw new Error(error || `Import failed (${res.status}).`);
  }
  let res: Response;
  try {
    res = await fetch(src, { mode: "cors" });
  } catch {
    throw new Error("This build has no import proxy, so the file has to allow cross-origin downloads and that one doesn't. Search results from the Internet Archive and Wikimedia Commons do work here.");
  }
  if (!res.ok) throw new Error(`Import failed (${res.status}).`);
  return res.blob();
}
