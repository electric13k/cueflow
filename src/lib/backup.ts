import { supabase } from "./store";
import { zip, type Bytes, type ZipEntry } from "./zip";

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

  return { blob: zip(entries), files: entries.length, missing };
}

/** Hands the archive to the browser's downloader under a dated name. */
export function saveBackup(blob: Blob, now = new Date()) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cueflow-export-${now.toISOString().slice(0, 10)}.zip`;
  a.click();
  // Revoking immediately can cancel the download in some browsers, so let the click settle first.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
