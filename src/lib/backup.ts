import { supabase } from "./store";
import { deflateEntries, pipeBytes, zip, type Bytes, type ZipEntry } from "./zip";

/**
 * Everything one account owns, as a zip you can open without CueFlow: the rows as JSON, the media
 * as the files they were uploaded as, and a README that says what the JSON means.
 *
 * This is the "keep my data" half of the retention notice, so it deliberately does not need the
 * account to still be in good standing, and it runs entirely in the browser: the files come down
 * from storage to the tab and go straight into the archive, so nothing new is uploaded anywhere.
 */

const TABLES = ["projects", "tracks", "sequences", "sequence_items", "shows", "show_roles", "editor_sessions"] as const;

const README = `CueFlow export

data/*.json   your rows, one file per table, exactly as the app stores them
media/        every file you uploaded, under its original name

The JSON is plain: a sequence lists sequence_items by position, and each item points at a track by
id. A track's storage_path names the file under media/.

Nothing here needs CueFlow to read. Keeping this zip is keeping your show.
`;

const safe = (name: string) => name.replace(/[^\w.\- ]+/g, "_").slice(0, 80) || "file";

/** Fetch one asset. A file that will not come down must not lose you the rest of the archive. */
async function pull(url: string): Promise<Bytes | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer()) as Bytes;
  } catch { return null; }
}

export type BackupResult = { blob: Blob; files: number; missing: string[] };

export async function buildBackup(onProgress?: (done: number, total: number) => void): Promise<BackupResult> {
  if (!supabase) throw new Error("Cloud is not configured for this build.");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in to export your data.");

  const entries: ZipEntry[] = [{ name: "README.txt", body: new TextEncoder().encode(README) }];
  const rows: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    const { data } = await supabase.from(table).select("*");
    rows[table] = data ?? [];
    entries.push({ name: `data/${table}.json`, body: new TextEncoder().encode(JSON.stringify(data ?? [], null, 2)) });
  }
  entries.push({
    name: "data/account.json",
    body: new TextEncoder().encode(JSON.stringify({ id: user.id, email: user.email, exported: new Date().toISOString() }, null, 2)),
  });

  const tracks = (rows.tracks ?? []) as { title: string; source_url: string | null; storage_path: string | null }[];
  const media = tracks.filter(t => t.source_url);
  const missing: string[] = [];
  let done = 0;
  for (const t of media) {
    const body = await pull(t.source_url as string);
    done++;
    onProgress?.(done, media.length);
    if (!body) { missing.push(t.title); continue; }
    const ext = (t.storage_path ?? t.source_url ?? "").split(".").pop()?.slice(0, 5) ?? "bin";
    entries.push({ name: `media/${safe(t.title)}.${ext}`, body });
  }

  // The media is already compressed and the JSON is not, so deflateEntries() decides per entry.
  return { blob: zip(await deflateEntries(entries)), files: entries.length, missing };
}

/** Hands the archive to the browser's downloader under a dated name. */
export function saveBackup(blob: Blob, now = new Date()) {
  download(blob, `cueflow-export-${now.toISOString().slice(0, 10)}.zip`);
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // Revoking immediately can cancel the download in some browsers, so let the click settle first.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * The snapshot half: rows as one JSON file rather than an archive, which is what a restore reads
 * back. JSON is the most compressible thing the app produces, and gzip commonly takes structured
 * rows to a tenth or a fifth of their size, so it is written through CompressionStream.
 */
export type JsonBackup = { blob: Blob; name: string };

const stamp = (now: Date) => now.toISOString().slice(0, 10);

export async function writeJsonBackup(data: unknown, now = new Date()): Promise<JsonBackup> {
  const json = new TextEncoder().encode(JSON.stringify(data));
  // No CompressionStream (older Safari, some test environments) means plain JSON under the old
  // name. Naming uncompressed bytes .json.gz would hand somebody a backup that no gzip reader and
  // no other browser could open, which is worse than a large one.
  if (typeof globalThis.CompressionStream !== "function")
    return { blob: new Blob([json], { type: "application/json" }), name: `cueflow-backup-${stamp(now)}.json` };
  const packed = await pipeBytes(json, new CompressionStream("gzip"));
  return { blob: new Blob([packed], { type: "application/gzip" }), name: `cueflow-backup-${stamp(now)}.json.gz` };
}

/**
 * Reads either form. Every backup written before gzip shipped is plain JSON, and a restore that
 * refused those would destroy the only copy of somebody's show, so the gzip magic bytes 1f 8b are
 * sniffed off the front rather than the extension being trusted: a file gets renamed, a header
 * does not.
 */
export async function readJsonBackup(source: Blob | Uint8Array): Promise<unknown> {
  const bytes: Bytes = source instanceof Uint8Array
    ? (source as Bytes)
    : new Uint8Array(await source.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof globalThis.DecompressionStream !== "function")
      throw new Error("This backup is gzipped and this browser cannot unzip it. Open it in a current browser.");
    return JSON.parse(new TextDecoder().decode(await pipeBytes(bytes, new DecompressionStream("gzip"))));
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Hands a JSON backup to the browser's downloader under the name writeJsonBackup chose. */
export function saveJsonBackup(file: JsonBackup) {
  download(file.blob, file.name);
}
