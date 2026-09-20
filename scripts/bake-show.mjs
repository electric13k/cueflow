#!/usr/bin/env node
/**
 * Bake a show into the app, so the installer IS the show.
 *
 *   node scripts/bake-show.mjs macbeth-display.cueflow
 *   node scripts/bake-show.mjs macbeth-display.cueflow --name "Macbeth (Foyer)"
 *   node scripts/bake-show.mjs --reset
 *
 * Then `npm run tauri build` (or `npm run android:build`) produces an installer that opens already
 * holding that production, in the job the pack was cut for, with nothing to type and nothing to
 * download. `src/lib/bakedShow.ts` is the other end of this.
 *
 * Two things are changed and both of them matter. The pack is copied into `src-tauri/resources/`,
 * which is what the bundler picks up. And `productName` and `identifier` are given the show's name,
 * because the alternative is four installers on one laptop all called CueFlow, all with the same
 * app id, each one replacing the last. A crew laptop that needs the sound copy and the display copy
 * side by side needs them to be two different applications, and to Windows and Android that means
 * two different identifiers.
 *
 * `--reset` puts the config back and removes the pack, which is what CI does between builds and
 * what a developer wants after testing one.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = resolve(root, "src-tauri/tauri.conf.json");
const RESOURCES = resolve(root, "src-tauri/resources");
const BAKED = resolve(RESOURCES, "show.cueflow");
/**
 * The config exactly as it was, bytes and all, so `--reset` restores it rather than reconstructing
 * it. Rewriting three fields back would leave the file reformatted by `JSON.stringify`, and a
 * developer who baked a show to test it would find their next commit carrying a whole-file diff
 * they did not make.
 */
const SAVED = resolve(RESOURCES, ".before-bake.tauri.conf.json");

const die = (message) => { console.error(`bake-show: ${message}`); process.exit(1); };

/* ── the smallest zip reader that can find one file ──────────────────────────────────────── */

/**
 * One named entry out of a zip. Deliberately not a dependency: this reads a single small JSON file
 * out of an archive this repository's own code wrote, and a build script that can be run from a
 * clean checkout with no install is worth more here than generality.
 */
function readFromZip(bytes, wanted) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === 0x06054b50) { end = at; break; }
  }
  if (end < 0) return null;
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) return null;
    const method = view.getUint16(at + 10, true);
    const packedSize = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = bytes.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    at += 46 + nameLen + extraLen + commentLen;
    if (name !== wanted) continue;
    const dataAt = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    const packed = bytes.subarray(dataAt, dataAt + packedSize);
    return method === 0 ? packed : inflateRawSync(packed);
  }
  return null;
}

/* ── naming ──────────────────────────────────────────────────────────────────────────────── */

/** A Tauri identifier segment: lowercase, alphanumeric and hyphens, never empty, never leading digit. */
const idPart = (text) => {
  const clean = String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  return clean && !/^\d/.test(clean) ? clean : `s${clean || "how"}`;
};

/* ── arguments ───────────────────────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const opts = {};
const loose = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--reset") { opts.reset = true; continue; }
  // Every other flag takes a value. Consuming it here is what stops a show called "--name" from
  // being treated as the file, and the file from being treated as a flag's value.
  if (arg.startsWith("--")) { opts[arg.slice(2)] = argv[++i]; continue; }
  loose.push(arg);
}
const flag = (name) => opts[name];
const reset = !!opts.reset;
const file = loose[0];

/* ── reset ───────────────────────────────────────────────────────────────────────────────── */

if (reset) {
  if (existsSync(SAVED)) {
    writeFileSync(CONFIG, readFileSync(SAVED));
    rmSync(SAVED);
  }
  if (existsSync(BAKED)) rmSync(BAKED);
  console.log("bake-show: the app carries no show again.");
  process.exit(0);
}

if (!file) die("give it a .cueflow file, or --reset. See the comment at the top of this script.");
const from = resolve(process.cwd(), file);
if (!existsSync(from)) die(`${from} is not there.`);

/* ── read the pack ───────────────────────────────────────────────────────────────────────── */

const bytes = readFileSync(from);
const manifestBytes = readFromZip(bytes, "manifest.json");
if (!manifestBytes) die(`${file} is not a CueFlow show: there is no manifest.json in it.`);
let manifest;
try { manifest = JSON.parse(manifestBytes.toString("utf8")); }
catch { die(`${file} has a manifest that will not parse, so it is damaged.`); }
if (!String(manifest.format ?? "").startsWith("cueflow-show/")) die(`${file} is not a CueFlow show.`);

const role = manifest.role?.name ?? null;
// The role is in the name on purpose. Three installers for one production differ only by job, and
// "Macbeth" three times on a download page helps nobody find the right one.
const defaultName = [manifest.showName || "CueFlow show", role].filter(Boolean).join(" · ");
const productName = flag("name") ?? defaultName;
const identifier = flag("identifier")
  ?? `app.cueflow.${idPart(manifest.showName || "show")}${role ? `.${idPart(role)}` : ""}`;

/* ── write ───────────────────────────────────────────────────────────────────────────────── */

mkdirSync(RESOURCES, { recursive: true });
copyFileSync(from, BAKED);

const config = JSON.parse(readFileSync(CONFIG, "utf8"));
if (!existsSync(SAVED)) writeFileSync(SAVED, readFileSync(CONFIG));
config.productName = productName;
config.identifier = identifier;
if (config.app?.windows?.[0]) config.app.windows[0].title = productName;
// The bundler needs the resource glob or the pack is built and left out of the installer, which is
// the one failure that looks exactly like success until somebody installs it in a venue.
config.bundle ??= {};
if (!Array.isArray(config.bundle.resources) || !config.bundle.resources.includes("resources/*")) {
  config.bundle.resources = [...new Set([...(config.bundle.resources ?? []), "resources/*"])];
}
writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`);

const mb = (bytes.length / 1_048_576).toFixed(1);
console.log(`bake-show: ${manifest.showName || "show"}${role ? ` (${role})` : " (everything)"}, ${manifest.assets?.length ?? 0} files, ${mb} MB`);
console.log(`bake-show: product "${productName}", identifier ${identifier}`);
console.log("bake-show: now run  npm run tauri build   or   npm run android:build");
