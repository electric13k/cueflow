import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deflateEntries, zip } from "../src/lib/zip";

/**
 * The seam between the app and the build.
 *
 * `bake-show.mjs` reads a file the app wrote, with its own zip reader, in a different runtime, with
 * no shared code. That is two implementations of one format and they are exactly the pair that
 * drifts: the app keeps working, the script keeps running, and the installer comes out of CI
 * carrying a show nobody can open. So this runs the real script against a real pack.
 *
 * It writes to `src-tauri/tauri.conf.json` and puts it back, which is what `--reset` is for and is
 * therefore also worth proving.
 */

const bytes = (text: string) => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
const CONFIG = "src-tauri/tauri.conf.json";
const BAKED = "src-tauri/resources/show.cueflow";

const readConfig = () => JSON.parse(readFileSync(CONFIG, "utf8")) as {
  productName: string; identifier: string;
  bundle?: { resources?: string[] };
  app?: { windows?: { title?: string }[] };
};

const run = (...args: string[]) =>
  execFileSync(process.execPath, ["scripts/bake-show.mjs", ...args], { encoding: "utf8" });

async function packFile(dir: string, manifest: unknown, name = "show.cueflow") {
  const blob = zip(await deflateEntries([
    { name: "manifest.json", body: bytes(JSON.stringify(manifest)) },
    { name: "show.json", body: bytes(JSON.stringify({ show: { id: "CF-K7QM2X", name: "Macbeth" } })) },
    // Padding so the manifest is not the last entry and the directory walk has to actually walk.
    { name: "assets/" + "a".repeat(64) + ".mp3", body: bytes("x".repeat(3000)) },
  ]));
  const path = join(dir, name);
  writeFileSync(path, Buffer.from(await blob.arrayBuffer()));
  return path;
}

const manifest = (role: { name: string } | null) => ({
  format: "cueflow-show/1",
  app: "CueFlow",
  created: new Date().toISOString(),
  showId: "CF-K7QM2X",
  showName: "Macbeth",
  role,
  assets: [{ hash: "a".repeat(64), ext: "mp3", bytes: 3000, mime: "audio/mpeg" }],
});

let temp: string | null = null;

afterEach(() => {
  run("--reset");
  if (temp) { rmSync(temp, { recursive: true, force: true }); temp = null; }
});

describe("bake-show", () => {
  it("reads a pack this app wrote, and names the app after the show and the job", async () => {
    temp = mkdtempSync(join(tmpdir(), "cueflow-bake-"));
    const before = readConfig();
    const output = run(await packFile(temp, manifest({ name: "Display" })));

    expect(output).toContain("Macbeth");
    expect(output).toContain("Display");
    const after = readConfig();
    expect(after.productName).toBe("Macbeth · Display");
    // A different identifier is what lets the sound copy and the display copy sit on one laptop
    // without one replacing the other.
    expect(after.identifier).toBe("app.cueflow.macbeth.display");
    expect(after.identifier).not.toBe(before.identifier);
    expect(after.app?.windows?.[0]?.title).toBe("Macbeth · Display");
    expect(after.bundle?.resources).toContain("resources/*");
    expect(existsSync(BAKED)).toBe(true);
  });

  it("calls a pack with no job the whole show, and gives it the show's own id", async () => {
    temp = mkdtempSync(join(tmpdir(), "cueflow-bake-"));
    run(await packFile(temp, manifest(null)));
    expect(readConfig().productName).toBe("Macbeth");
    expect(readConfig().identifier).toBe("app.cueflow.macbeth");
  });

  it("takes a name and an id over the ones it would derive", async () => {
    temp = mkdtempSync(join(tmpdir(), "cueflow-bake-"));
    run(await packFile(temp, manifest({ name: "Display" })), "--name", "Foyer TV", "--identifier", "app.cueflow.foyer");
    expect(readConfig().productName).toBe("Foyer TV");
    expect(readConfig().identifier).toBe("app.cueflow.foyer");
  });

  it("puts the config back byte for byte, so a bake is never committed by accident", async () => {
    temp = mkdtempSync(join(tmpdir(), "cueflow-bake-"));
    const before = readFileSync(CONFIG, "utf8");
    run(await packFile(temp, manifest({ name: "Display" })));
    expect(readFileSync(CONFIG, "utf8")).not.toBe(before);
    run("--reset");
    // Byte for byte, not field for field: reconstructing it would leave the file reformatted and
    // a developer testing a bake would find a whole-file diff in their next commit.
    expect(readFileSync(CONFIG, "utf8")).toBe(before);
    expect(existsSync(BAKED)).toBe(false);
  });

  it("refuses a file that is not a CueFlow show rather than building an installer around it", async () => {
    temp = mkdtempSync(join(tmpdir(), "cueflow-bake-"));
    const notAShow = join(temp, "readme.zip");
    writeFileSync(notAShow, Buffer.from(await zip([{ name: "hello.txt", body: bytes("hi") }]).arrayBuffer()));
    // This is also the check that stops CI baking an HTML error page a bad link served.
    expect(() => run(notAShow)).toThrow();
    expect(existsSync(BAKED)).toBe(false);
  });
});
