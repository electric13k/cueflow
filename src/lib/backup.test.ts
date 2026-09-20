import { describe, expect, it, vi } from "vitest";
import { readJsonBackup, writeJsonBackup } from "./backup";

// buildBackup needs an account and a bucket; what is under test here is the file format, which is
// what a restore has to survive. The module reaches for the client at import time, so it is stubbed.
vi.mock("./store", () => ({ supabase: null }));

const show = {
  projects: [{ id: "p1", name: "Act One" }],
  tracks: Array.from({ length: 80 }, (_, i) => ({
    id: `t${i}`, title: `Cue ${i}`, storage_path: `public/ab${i}.flac`, gain: 0.8, trim: null,
  })),
};

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

/** Takes CompressionStream away for one test, the way older Safari has it away permanently. */
async function withoutCompressionStream<T>(run: () => Promise<T>): Promise<T> {
  const g = globalThis as { CompressionStream?: unknown };
  const real = g.CompressionStream;
  delete g.CompressionStream;
  try { return await run(); } finally { g.CompressionStream = real; }
}

describe("writeJsonBackup", () => {
  it("writes gzip, magic bytes and all, under a .json.gz name", async () => {
    const file = await writeJsonBackup(show, new Date("2026-09-20T12:00:00Z"));
    const bytes = await bytesOf(file.blob);
    expect(file.name).toBe("cueflow-backup-2026-09-20.json.gz");
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
  });

  it("is a fraction of the JSON it was given", async () => {
    const plain = new TextEncoder().encode(JSON.stringify(show)).length;
    const packed = (await bytesOf((await writeJsonBackup(show)).blob)).length;
    expect(packed).toBeLessThan(plain / 2);
  });

  it("falls back to plain JSON under the old name when CompressionStream is missing", async () => {
    const file = await withoutCompressionStream(() => writeJsonBackup(show, new Date("2026-09-20T12:00:00Z")));
    expect(file.name).toBe("cueflow-backup-2026-09-20.json");
    const bytes = await bytesOf(file.blob);
    expect([bytes[0], bytes[1]]).not.toEqual([0x1f, 0x8b]);
    // Still readable: the fallback writes a backup, not an unopenable file.
    expect(await readJsonBackup(bytes)).toEqual(show);
  });
});

describe("readJsonBackup", () => {
  it("round trips what writeJsonBackup wrote", async () => {
    const file = await writeJsonBackup(show);
    expect(await readJsonBackup(await bytesOf(file.blob))).toEqual(show);
  });

  it("reads a legacy uncompressed backup, which is every backup already on disk", async () => {
    const legacy = new TextEncoder().encode(JSON.stringify(show, null, 2));
    expect(await readJsonBackup(legacy)).toEqual(show);
  });

  it("takes a Blob as well as bytes, because a restore hands it a File", async () => {
    const file = await writeJsonBackup(show);
    expect(await readJsonBackup(file.blob)).toEqual(show);
    expect(await readJsonBackup(new Blob([JSON.stringify(show)]))).toEqual(show);
  });

  it("sniffs the header rather than the name, so a renamed backup still opens", async () => {
    const gz = await bytesOf((await writeJsonBackup(show)).blob);
    // Same bytes a user would have after saving them as "show.json": the name says nothing.
    expect(await readJsonBackup(gz)).toEqual(show);
  });

  it("says why when the bytes are gzipped and the browser cannot unzip them", async () => {
    const gz = await bytesOf((await writeJsonBackup(show)).blob);
    const g = globalThis as { DecompressionStream?: unknown };
    const real = g.DecompressionStream;
    delete g.DecompressionStream;
    try {
      await expect(readJsonBackup(gz)).rejects.toThrow(/gzipped/);
    } finally { g.DecompressionStream = real; }
  });
});
