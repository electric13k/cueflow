/**
 * What happens to a file between "the operator picked it" and "it is in the bucket".
 *
 * Three things, and none of them changes a sample, a pixel or a byte the app will later read back:
 *
 * 1. **Repack what is worth repacking.** A WAV is uncompressed PCM. Every other format the app
 *    accepts -- MP3, AAC, Opus, FLAC, JPEG, PNG, WebP, MP4, and the ZIP-shaped office formats --
 *    is already compressed, and running another pass over it costs CPU to gain under a percent. So
 *    WAV and AIFF become FLAC and everything else is uploaded exactly as it came.
 * 2. **Name by content.** The path is the SHA-256 of the bytes, so the same sound imported twice,
 *    by one person or by two, is one object. Before this, every import was `uuid-filename` and a
 *    company that put the same sting in nine shows stored it nine times.
 * 3. **Label honestly.** The old fallback content type was `audio/mpeg` for anything the browser
 *    did not name, which labelled every `.pptx` as an MP3. The bucket's own MIME allow-list then
 *    rejected or mis-served it, and the failure surfaced as "upload failed" with no reason.
 *
 * On dedup and privacy: a content-addressed name in a public bucket lets someone who already holds
 * a file confirm that it has been uploaded. That is not a new exposure here -- the `public/` prefix
 * is readable and listable by `anon` under the policy in `0002_sync_and_shows.sql`, so enumeration
 * was already possible -- but it is the reason the scheme is worth stating rather than assuming.
 */

/** The bucket's own `file_size_limit`. Checked here so the operator gets a sentence rather than a
 *  storage API error with a number in it. */
export const MAX_UPLOAD = 50 * 1024 * 1024;

/**
 * Extensions whose bytes are already entropy-coded. Repacking these is work for nothing: the
 * containers are deflate or better internally, and a second pass typically grows them.
 */
const ALREADY_PACKED = new Set([
  "mp3", "aac", "m4a", "mp4", "m4v", "ogg", "oga", "opus", "webm", "flac", "wma", "amr", "3gp",
  "jpg", "jpeg", "png", "webp", "avif", "gif", "heic", "heif", "jxl",
  "zip", "pptx", "docx", "xlsx", "odp", "odt", "ods", "gz", "br", "7z", "rar",
]);

/** Uncompressed or lightly-packed audio, which is the one case worth re-encoding. */
const RAW_AUDIO = new Set(["wav", "wave", "aif", "aiff", "aifc", "pcm", "au", "caf"]);

/**
 * Content types by extension, for the files a browser hands over with `file.type` empty. That
 * happens for `.pptx` and `.flac` on more platforms than it does not.
 */
const TYPES: Record<string, string> = {
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg",
  opus: "audio/ogg", wav: "audio/wav", wave: "audio/wav", flac: "audio/flac", aif: "audio/aiff",
  aiff: "audio/aiff", weba: "audio/webm",
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif",
  gif: "image/gif", svg: "image/svg+xml",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
  pdf: "application/pdf", txt: "text/plain", zip: "application/zip",
};

/**
 * The extension, or nothing.
 *
 * `split(".").pop()` returns the whole name when there is no dot in it, which then goes into a
 * storage path as `<hash>.untitled` and into a MIME lookup as a key that will never match. The
 * shape test is what keeps "Act 2, scene 4" from contributing " scene 4" as an extension.
 */
export const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  const tail = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  return /^[a-z0-9]{1,8}$/.test(tail) ? tail : "";
};

/**
 * The content type to upload with.
 *
 * What the browser said, unless it said nothing, in which case the extension. `application/octet-
 * stream` is the last resort and is deliberately not `audio/mpeg`: a wrong type that sounds
 * plausible is worse than an honest unknown, because the bucket's allow-list will accept it and
 * the player will then fail on bytes that are not what the header promised.
 */
export function typeFor(name: string, declared = ""): string {
  if (declared && declared !== "application/octet-stream") return declared;
  return TYPES[extensionOf(name)] ?? declared ?? "application/octet-stream";
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");

/**
 * The storage path for these exact bytes.
 *
 * SHA-256 because this is a name, not a security boundary, and a name that collides is a file
 * served in place of another one. `crypto.subtle` needs a secure context, which the app already
 * requires for the service worker; where it is missing the caller falls back to a random name and
 * simply does not dedup.
 */
export async function contentPath(file: Blob, name: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const ext = extensionOf(name);
  return `public/${hex(digest)}${ext ? `.${ext}` : ""}`;
}

export type Packed = {
  file: File;
  /** Bytes before and after, so the caller can say what it saved rather than claim it. */
  from: number;
  to: number;
  /** `flac` when the audio was repacked, `kept` when the original bytes were the right answer. */
  how: "flac" | "kept";
};

/** Decoding is injected: it needs an `AudioContext`, and neither the tests nor a worker have one. */
export type Decoder = (bytes: ArrayBuffer) => Promise<AudioBuffer>;

/**
 * The file to actually upload.
 *
 * Never throws for a repack that did not work out. A WAV this cannot decode, a browser with no
 * Web Audio, an encoder that would have produced something larger -- all of them mean the original
 * goes up unchanged, because failing an import over a size optimisation would be the wrong trade.
 */
export async function packForUpload(file: File, decode?: Decoder): Promise<Packed> {
  const kept: Packed = { file, from: file.size, to: file.size, how: "kept" };
  const ext = extensionOf(file.name);
  if (ALREADY_PACKED.has(ext) || !RAW_AUDIO.has(ext) || !decode) return kept;

  try {
    const [{ encodeFlac, toInt16 }, buffer] = await Promise.all([import("./flac"), decode(await file.arrayBuffer())]);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => toInt16(buffer.getChannelData(c)));
    const flac = encodeFlac({ channels, sampleRate: buffer.sampleRate, bitsPerSample: 16 });
    if (!flac || flac.length >= file.size) return kept;
    const base = file.name.replace(/\.[^.]+$/, "");
    const packed = new File([flac], `${base}.flac`, { type: "audio/flac" });
    return { file: packed, from: file.size, to: packed.size, how: "flac" };
  } catch {
    return kept;
  }
}

/** "4.2 MB", for a sentence an operator reads rather than a byte count. */
export const size = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB`
      : `${bytes} B`;
