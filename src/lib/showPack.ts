import { deflateEntries, unzipMap, zip, type Bytes, type ZipEntry } from "./zip";
import { keepAsset, nativeStore } from "./nativeStore";
import { keepAssetWeb, readWebAsset } from "./webStore";
import { local } from "./store";
import { newCode, scopedKey } from "./projects";
import { PERMS, ROLE_PRESETS, type Perm, type Role, type Show } from "./shows";
import { listLocalShows, localRoles, rememberDoor, saveLocalShow, setLocalRoles } from "./localShow";
import { emptyDoc, loadScript, saveScript, type ScriptDoc } from "./script";
import { loadLinks, saveLinks, withScript, withSequence } from "./showLinks";
import type { Sequence, Track } from "../types";

/**
 * A show as one file: the rows, the media, and the job whoever opens it is being given.
 *
 * This is what makes the offline story finish. The app could already run a show with no internet
 * once the show was on the device; what it could not do was get it onto a second device, because
 * every route between two machines went through an account. A company that rehearses on a laptop
 * and calls the show off a phone in the wings had to sign in on the phone, from a venue whose wifi
 * is a rumour, to fetch files it was about to play out of a speaker three feet away.
 *
 * So: one zip, openable by anything, carrying the whole show and the person's job in it. Hand it
 * over on a USB stick, over AirDrop, in an email, or bake it into an installer and hand over the
 * installer. Nothing in here needs CueFlow's servers, and nothing in here phones home.
 *
 * The format is deliberately plain and deliberately versioned. `manifest.json` says what it is,
 * `show.json` holds the rows exactly as the app stores them, and `assets/` holds the media under
 * the SHA-256 of its own bytes, which is the same name the cloud, the browser store and the native
 * disk store all give it. A file that arrives somewhere it already exists is therefore recognised
 * rather than duplicated, on every one of the three.
 */

export const PACK_FORMAT = "cueflow-show/1";
export const PACK_EXT = ".cueflow";
/** Also accepted, because a plain `.zip` is what a mail client or a phone often renames it to. */
export const PACK_EXTS = [PACK_EXT, ".zip"];

/**
 * A URL inside a packed show. Not a real scheme and not meant to be: the point is that it cannot
 * accidentally be fetched. Wherever the bytes end up living on the importing device, the importer
 * rewrites these, and anything it fails to rewrite stays visibly broken rather than quietly
 * pointing at somebody else's storage host.
 */
const PACKED = "cueflow-asset:";
export const packedUrl = (hash: string, ext: string) => `${PACKED}${hash}${ext ? `.${ext}` : ""}`;
const isPacked = (url: string) => url.startsWith(PACKED);

export type PackedAsset = { hash: string; ext: string; bytes: number; mime: string };

/** What the importing device is being handed, and what job it is being given while it holds it. */
export type PackRole = {
  /** The job's name as the host wrote it, so the crew screen says the same word on both devices. */
  name: string;
  perms: Perm[];
  /** Which preset this came from, when it came from one. Only used to label the download. */
  preset?: string;
};

export type PackManifest = {
  format: typeof PACK_FORMAT;
  app: string;
  created: string;
  showId: string;
  showName: string;
  /** Null means "the whole show": whoever opens it is the host and holds every permission. */
  role: PackRole | null;
  assets: PackedAsset[];
};

export type PackBody = {
  show: Show;
  roles: Role[];
  sequences: Sequence[];
  tracks: Track[];
  script: ScriptDoc | null;
};

const enc = (text: string) => new TextEncoder().encode(text) as Bytes;

const README = `This is a CueFlow show.

show.json      the show, its jobs, its sequences and its media list, exactly as the app stores them
assets/        every sound, picture and video the show uses, named by the SHA-256 of its own bytes
manifest.json  what this file is, and which job it hands whoever opens it

Open it with CueFlow: the website at cueflow.pages.dev, or the offline app, both take it from the
same button. Nothing here needs an account and nothing here needs the internet.

It is an ordinary zip, so you can also just unzip it and take the files.
`;

/* ── packing ─────────────────────────────────────────────────────────────────────────────── */

const extOf = (url: string, fallback = "bin") => {
  const clean = url.split("?")[0].split("#")[0];
  const found = /\.([a-z0-9]{1,8})$/i.exec(clean);
  return found ? found[1].toLowerCase() : fallback;
};

/** A hash already in the URL, whichever of the three stores wrote it. All three use the same name. */
const hashIn = (url: string) => /([0-9a-f]{64})/.exec(url.split("?")[0])?.[1] ?? null;

/**
 * The bytes behind one track URL, from wherever they are.
 *
 * `fetch` covers all four cases the app produces: an `asset:`/`http://asset.localhost` URL from the
 * native disk store, a same-origin `cf-asset/` URL from the browser store, a storage host URL, and
 * a `blob:` URL from a session that never got as far as keeping anything. The browser-store read is
 * a second try rather than the first, because it only wins when no service worker is controlling
 * the page, and that case is rare enough not to be worth a branch on the hot path.
 */
async function bytesOf(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url);
    if (res.ok) return await res.blob();
  } catch { /* Falls through: an unreachable URL is a missing asset, reported, not thrown. */ }
  const hash = hashIn(url);
  return hash ? await readWebAsset(hash, extOf(url)) : null;
}

export type PackProgress = { done: number; total: number; title: string; ok: boolean };
export type PackResult = { blob: Blob; manifest: PackManifest; missing: string[] };

/**
 * Everything a device needs to run this show, in one file.
 *
 * `missing` is returned rather than thrown on, and that is the important half. A show with
 * twenty-nine of its thirty sounds is worth taking to the venue; a refusal to export because one
 * link is dead is not. The caller names what is missing so the operator can decide.
 */
export async function packShow(input: {
  show: Show;
  roles: Role[];
  sequences: Sequence[];
  tracks: Track[];
  script?: ScriptDoc | null;
  role: PackRole | null;
  onProgress?: (p: PackProgress) => void;
}): Promise<PackResult> {
  const { show, roles, sequences, script = null, role, onProgress } = input;

  // Only the tracks the packed sequences actually call. A library is everything ever imported for
  // anything, and shipping it would turn a 40 MB show into a 4 GB download.
  const wanted = new Set(sequences.flatMap(s => s.items.map(i => i.trackId)));
  const tracks = input.tracks.filter(t => wanted.has(t.id));

  const assets: PackedAsset[] = [];
  const entries: ZipEntry[] = [];
  const missing: string[] = [];
  const seen = new Map<string, string>();
  const packedTracks: Track[] = [];

  let done = 0;
  for (const track of tracks) {
    const already = seen.get(track.url);
    if (already) {
      packedTracks.push({ ...track, url: already, storagePath: undefined });
      onProgress?.({ done: ++done, total: tracks.length, title: track.title, ok: true });
      continue;
    }
    const blob = await bytesOf(track.url);
    done++;
    if (!blob) {
      missing.push(track.title);
      onProgress?.({ done, total: tracks.length, title: track.title, ok: false });
      // Kept in the rows with its original URL. A cue that is silent on the other device and still
      // in the list is recoverable; a cue that vanished from the list is not even noticed.
      packedTracks.push(track);
      continue;
    }
    const ext = extOf(track.url, track.mime?.split("/")[1] ?? "bin");
    const hash = hashIn(track.url) ?? await sha256(blob);
    const name = `assets/${hash}.${ext}`;
    if (!assets.some(a => a.hash === hash)) {
      assets.push({ hash, ext, bytes: blob.size, mime: blob.type || track.mime || "application/octet-stream" });
      entries.push({ name, body: new Uint8Array(await blob.arrayBuffer()) as Bytes });
    }
    const url = packedUrl(hash, ext);
    seen.set(track.url, url);
    packedTracks.push({ ...track, url, storagePath: undefined });
    onProgress?.({ done, total: tracks.length, title: track.title, ok: true });
  }

  const manifest: PackManifest = {
    format: PACK_FORMAT,
    app: "CueFlow",
    created: new Date().toISOString(),
    showId: show.id,
    showName: show.name,
    role,
    assets,
  };
  const body: PackBody = { show, roles, sequences, tracks: packedTracks, script };

  entries.unshift(
    { name: "manifest.json", body: enc(JSON.stringify(manifest, null, 2)) },
    { name: "show.json", body: enc(JSON.stringify(body, null, 2)) },
    { name: "README.txt", body: enc(README) },
  );
  // The JSON compresses hard and the media does not, so deflateEntries decides per entry.
  return { blob: zip(await deflateEntries(entries)), manifest, missing };
}

/** WebCrypto, with a last-resort name when it is missing, so an export never fails over a hash. */
async function sha256(blob: Blob): Promise<string> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return crypto.randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64);
  }
}

/** A filename somebody can find again on a desktop full of files. */
export function packFileName(showName: string, role: PackRole | null): string {
  const clean = (text: string) => text.trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-").slice(0, 48);
  const show = clean(showName) || "show";
  const job = role ? clean(role.name) : "";
  return `${show}${job ? `-${job}` : ""}${PACK_EXT}`.toLowerCase();
}

/* ── reading ─────────────────────────────────────────────────────────────────────────────── */

export type ReadPack = { manifest: PackManifest; body: PackBody; assets: Map<string, Bytes> };

/**
 * Open a packed show far enough to describe it, without writing a single thing to this device.
 *
 * Split from the import on purpose: somebody double-clicking a file they were sent should be told
 * what is in it and which job it gives them, and get to say no. An import that has already
 * happened by the time the dialog appears is not a choice.
 */
export async function readPack(file: Blob): Promise<ReadPack> {
  const files = await unzipMap(file);
  const text = (name: string) => {
    const bytes = files.get(name);
    return bytes ? new TextDecoder().decode(bytes) : null;
  };
  const manifestText = text("manifest.json");
  if (!manifestText) throw new Error("That file is not a CueFlow show: there is no manifest in it.");
  let manifest: PackManifest;
  let body: PackBody;
  try {
    manifest = JSON.parse(manifestText) as PackManifest;
    body = JSON.parse(text("show.json") ?? "null") as PackBody;
  } catch {
    throw new Error("This show file is damaged: the part describing the show will not parse.");
  }
  if (!manifest?.format?.startsWith("cueflow-show/")) throw new Error("That file is not a CueFlow show.");
  // Major version only. A future minor adds fields this build ignores; a future major does not
  // promise that, and guessing at it is how a half-imported show gets onto a device.
  const major = manifest.format.split("/")[1]?.split(".")[0];
  if (major !== "1") throw new Error(`This show was made by a newer CueFlow (format ${manifest.format}). Update the app and open it again.`);
  if (!body?.show?.id) throw new Error("This show file is damaged: it does not say which show it holds.");

  const assets = new Map<string, Bytes>();
  for (const [name, bytes] of files) if (name.startsWith("assets/")) assets.set(name.slice("assets/".length), bytes);
  return { manifest, body, assets };
}

/* ── importing ───────────────────────────────────────────────────────────────────────────── */

export type ImportResult = {
  showId: string;
  /** What this device may do now. Empty only when a role carried no permissions at all. */
  perms: Perm[];
  member: string;
  tracks: number;
  assets: number;
  /** Named files whose bytes were not in the archive, so their cues will be silent here. */
  missing: string[];
  renamed: boolean;
};

/** Where the bytes go on this device. Native disk if there is one, this browser's store if not. */
async function keepHere(blob: Blob, ext: string): Promise<string | null> {
  if (nativeStore()) {
    const kept = await keepAsset(blob, ext);
    if (kept) return kept.url;
  }
  const kept = await keepAssetWeb(blob, ext);
  if (kept) return kept.url;
  // Neither store would take it. A URL good for this document is worth more than no cue at all,
  // and the import reports itself as unkept rather than pretending it landed.
  return null;
}

const freeLocalId = () => {
  const taken = new Set(listLocalShows().map(s => s.id.toUpperCase()));
  for (let n = 0; n < 12; n++) {
    const id = `CF-${newCode()}`;
    if (!taken.has(id)) return id;
  }
  throw new Error("Could not find a free show key on this device. Delete an old show and try again.");
};

/**
 * Put a packed show onto this device and take the job it hands out.
 *
 * Three things make this safe to run on a machine that is already being used for something.
 *
 * It never overwrites a show. A pack whose id is already here is imported under a fresh key and
 * says so, because the alternative is that opening a colleague's copy of last year's production
 * silently replaces this year's.
 *
 * It merges the library rather than replacing it. Tracks and sequences are content-identified by
 * id, and an id already present is left exactly as it is: the device's own copy of a sound is the
 * one its own cues point at.
 *
 * It only takes the script if this device has none. A script is one document per device, and
 * quietly replacing the one an operator has been marking up all week is not an import, it is a
 * deletion.
 */
export async function importPack(pack: ReadPack, options: { name?: string } = {}): Promise<ImportResult> {
  const { manifest, body, assets } = pack;

  // Assets first: a row rewritten to point at a file that failed to store is worse than a row that
  // still points at where it came from, which at least works again once there is a connection.
  const urls = new Map<string, string>();
  const lost = new Set<string>();
  let stored = 0;
  for (const asset of manifest.assets) {
    const bytes = assets.get(`${asset.hash}.${asset.ext}`);
    const kept = bytes ? await keepHere(new Blob([bytes], { type: asset.mime }), asset.ext) : null;
    if (!kept) { lost.add(packedUrl(asset.hash, asset.ext)); continue; }
    urls.set(packedUrl(asset.hash, asset.ext), kept);
    stored++;
  }

  // What is reported is a cue's name, not a hash, because the operator has to find it and fix it.
  // A file nothing points at is still named, under its own name, rather than passed over in silence.
  const missing: string[] = [];
  const claimed = new Set<string>();
  const tracks = body.tracks.map(track => {
    if (!isPacked(track.url)) return track;
    const here = urls.get(track.url);
    if (here) return { ...track, url: here };
    claimed.add(track.url);
    if (!missing.includes(track.title)) missing.push(track.title);
    return track;
  });
  for (const url of lost) if (!claimed.has(url)) missing.push(url.slice(PACKED.length));

  // Merge by id, keeping whatever is already here. See the note above the function.
  const mergeById = <T extends { id: string }>(key: string, incoming: T[]) => {
    const here = local.get<T[]>(key, []);
    const known = new Set(here.map(row => row.id));
    const added = incoming.filter(row => !known.has(row.id));
    if (added.length) local.set(key, [...here, ...added]);
    return added.length;
  };
  const addedTracks = mergeById(scopedKey("tracks"), tracks);
  mergeById(scopedKey("sequences"), body.sequences);

  const clash = listLocalShows().some(s => s.id === body.show.id);
  const showId = clash ? freeLocalId() : body.show.id;
  const show: Show = { ...body.show, id: showId, password: showId, owner: null, startedAt: null };
  saveLocalShow(show);
  // Fresh role ids, because a role id is a uuid and two devices that both imported this pack would
  // otherwise disagree about nothing while looking like they agree about something.
  setLocalRoles(showId, (body.roles ?? []).map(role => ({ ...role, id: crypto.randomUUID() })));

  const links = loadLinks(null);
  let next = links;
  for (const sequence of body.sequences) next = withSequence(next, showId, sequence.id);
  if (body.script?.html) next = withScript(next, showId);
  saveLinks(null, next);

  // Only when this device has nothing of its own. A script is one document per device.
  if (body.script?.html && !loadScript().html.trim()) saveScript({ ...emptyDoc(), ...body.script });

  const perms = manifest.role ? manifest.role.perms : PERMS.map(p => p.key);
  const member = crypto.randomUUID();
  rememberDoor(member, showId, "in", manifest.role?.name ?? null, perms, options.name ?? "");

  return { showId, perms, member, tracks: addedTracks, assets: stored, missing, renamed: clash };
}

/* ── the roles a pack can be cut for ─────────────────────────────────────────────────────── */

/**
 * The jobs offered when exporting, including the one that is not a job.
 *
 * "Everything" is first and is null rather than a preset: a pack with no role in it makes whoever
 * opens it the host, which is what you want for the copy you are carrying yourself, and what you
 * definitely do not want for the copy going to the screen in the foyer.
 */
export type ExportChoice = { key: string; name: string; hint: string; role: PackRole | null };

export const exportChoices = (roles: Role[]): ExportChoice[] => [
  {
    key: "host",
    name: "Everything",
    hint: "Whoever opens this runs the show: every cue, the script, the stage, the door. This is the copy you keep.",
    role: null,
  },
  ...roles.map(role => ({
    key: role.id,
    name: role.name,
    hint: hintFor(role),
    role: { name: role.name, perms: role.perms, preset: presetKeyFor(role.perms) } satisfies PackRole,
  })),
];

const presetKeyFor = (perms: Perm[]) =>
  ROLE_PRESETS.find(p => p.perms.length === perms.length && p.perms.every(k => perms.includes(k)))?.key;

const hintFor = (role: Role) => {
  const preset = ROLE_PRESETS.find(p => p.key === presetKeyFor(role.perms));
  if (preset) return preset.hint;
  const named = PERMS.filter(p => role.perms.includes(p.key)).map(p => p.label.toLowerCase());
  return named.length ? `Can ${named.join(", ")}.` : "Can watch, and nothing else.";
};
