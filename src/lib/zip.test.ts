import { describe, expect, it } from "vitest";
import { crc32, deflateEntries, dosTime, zip, zipName, type ZipEntry } from "./zip";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("crc32", () => {
  it("matches the known check value for the string 123456789", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
  });
  it("is zero for nothing", () => {
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("zipName", () => {
  it("uses forward slashes and drops a leading one", () => {
    expect(zipName("\\cueflow\\library\\horn.mp3")).toBe("cueflow/library/horn.mp3");
  });
});

describe("dosTime", () => {
  it("packs the date the way a zip header expects", () => {
    const { time, date } = dosTime(new Date(2026, 7, 10, 13, 45, 20));
    expect(date >> 9).toBe(2026 - 1980);
    expect((date >> 5) & 0xf).toBe(8);
    expect(date & 0x1f).toBe(10);
    expect(time >> 11).toBe(13);
    expect((time >> 5) & 0x3f).toBe(45);
  });
});

describe("zip", () => {
  it("writes a real archive: signatures, one directory entry per file, correct end record", async () => {
    const blob = zip([
      { name: "cueflow/library.json", body: bytes('{"tracks":[]}') },
      { name: "cueflow/audio/horn.mp3", body: bytes("not really an mp3") },
    ], new Date(2026, 0, 1, 0, 0, 0));
    const buf = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(buf.buffer);

    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = buf.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);

    // The end record points at the central directory, which must start where it says it does.
    const dirAt = view.getUint32(end + 16, true);
    expect(view.getUint32(dirAt, true)).toBe(0x02014b50);
    expect(view.getUint32(end + 12, true)).toBe(end - dirAt);
  });

  it("is empty but still valid with no entries", async () => {
    const buf = new Uint8Array(await zip([]).arrayBuffer());
    expect(buf.length).toBe(22);
    expect(new DataView(buf.buffer).getUint32(0, true)).toBe(0x06054b50);
  });
});

/** Rows, which is what half an export is and the half DEFLATE was added for. */
const compressible = bytes(JSON.stringify(
  Array.from({ length: 200 }, (_, i) => ({ id: i, label: "house lights", cue: "LX", at: 12.5 })),
));

/** Bytes DEFLATE cannot help with, standing in for the FLAC and png an export is mostly made of. */
const incompressible = (() => {
  let seed = 7;
  return Uint8Array.from({ length: 4096 }, () => {
    seed = (Math.imul(seed, 1103515245) + 12345) | 0;
    return (seed >>> 16) & 0xff;
  });
})();

/**
 * An independent reader: it walks the central directory and the local headers the way a zip tool
 * does, so a header zip.ts writes wrongly fails here rather than being read back by its own mirror
 * image. Nothing from zip.ts is used to parse.
 */
type Parsed = { name: string; method: number; crc: number; size: number; packed: number; body: Uint8Array };

async function inflate(raw: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const t = new DecompressionStream("deflate-raw");
  const w = t.writable.getWriter();
  w.write(raw).then(() => w.close()).catch(() => {});
  const r = (t.readable as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

async function readZip(blob: Blob): Promise<Parsed[]> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(buf.buffer);
  const end = buf.length - 22; // no zip comment is written, so the end record is the last 22 bytes
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out: Parsed[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const packed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(buf.subarray(at + 46, at + 46 + nameLen));
    // The payload sits past the LOCAL header, whose own name and extra lengths are what count.
    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    const from = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    const raw = buf.subarray(from, from + packed);
    out.push({ name, method, crc, size, packed, body: method === 8 ? await inflate(raw) : raw });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Takes CompressionStream away for one test, the way older Safari has it away permanently. */
async function withoutCompressionStream<T>(run: () => Promise<T>): Promise<T> {
  const g = globalThis as { CompressionStream?: unknown };
  const real = g.CompressionStream;
  delete g.CompressionStream;
  try { return await run(); } finally { g.CompressionStream = real; }
}

describe("deflateEntries", () => {
  it("deflates compressible rows and leaves the original bytes as the body", async () => {
    const [entry] = await deflateEntries([{ name: "data/cues.json", body: compressible }]);
    expect(entry.method).toBe(8);
    expect(entry.packed.length).toBeLessThan(compressible.length / 2);
    expect(entry.body).toBe(compressible);
  });

  it("stores what DEFLATE would grow rather than growing it", async () => {
    const [entry] = await deflateEntries([{ name: "media/horn.flac", body: incompressible }]);
    expect(entry.method).toBe(0);
    expect(entry.packed.length).toBe(incompressible.length);
    expect(entry.packed).toBe(entry.body);
  });

  it("stores everything and does not throw when CompressionStream is missing", async () => {
    const packed = await withoutCompressionStream(() =>
      deflateEntries([{ name: "data/cues.json", body: compressible }, { name: "media/horn.flac", body: incompressible }]));
    expect(packed.map(p => p.method)).toEqual([0, 0]);
    const parsed = await readZip(zip(packed));
    expect(parsed[0].body).toEqual(compressible);
    expect(parsed[1].body).toEqual(incompressible);
  });
});

describe("zip with deflated entries", () => {
  const entries = (): ZipEntry[] => [
    { name: "data/cues.json", body: compressible },
    { name: "media/horn.flac", body: incompressible },
  ];

  it("writes method 8 for a deflated entry and 0 for a stored one", async () => {
    const parsed = await readZip(zip(await deflateEntries(entries())));
    expect(parsed.map(p => p.method)).toEqual([8, 0]);
  });

  it("keeps the CRC and the uncompressed size of the ORIGINAL bytes", async () => {
    const parsed = await readZip(zip(await deflateEntries(entries())));
    expect(parsed[0].crc).toBe(crc32(compressible));
    expect(parsed[0].size).toBe(compressible.length);
    expect(parsed[0].packed).toBeLessThan(compressible.length);
    expect(parsed[1].crc).toBe(crc32(incompressible));
    expect(parsed[1].size).toBe(incompressible.length);
    expect(parsed[1].packed).toBe(incompressible.length);
  });

  it("round trips every entry through an independent reader", async () => {
    const parsed = await readZip(zip(await deflateEntries(entries())));
    expect(parsed.map(p => p.name)).toEqual(["data/cues.json", "media/horn.flac"]);
    expect(parsed[0].body).toEqual(compressible);
    expect(parsed[1].body).toEqual(incompressible);
  });

  it("produces a smaller archive than storing the same entries", async () => {
    const deflated = (await zip(await deflateEntries(entries())).arrayBuffer()).byteLength;
    const stored = (await zip(entries()).arrayBuffer()).byteLength;
    expect(deflated).toBeLessThan(stored);
  });
});

describe("unzip", () => {
  const entries = (): ZipEntry[] => [
    { name: "data/cues.json", body: compressible },
    { name: "media/horn.flac", body: incompressible },
  ];

  it("reads back exactly what zip wrote, stored and deflated alike", async () => {
    const { unzip } = await import("./zip");
    const read = await unzip(zip(await deflateEntries(entries())));
    expect(read.map(e => e.name)).toEqual(["data/cues.json", "media/horn.flac"]);
    expect(read[0].body).toEqual(compressible);
    expect(read[1].body).toEqual(incompressible);
  });

  it("reads an archive whose entries were all stored", async () => {
    const { unzip } = await import("./zip");
    const read = await unzip(zip(entries()));
    expect(read[0].body).toEqual(compressible);
    expect(read[1].body).toEqual(incompressible);
  });

  it("hands back a map, because every caller wants one", async () => {
    const { unzipMap } = await import("./zip");
    const map = await unzipMap(zip(await deflateEntries(entries())));
    expect([...map.keys()].sort()).toEqual(["data/cues.json", "media/horn.flac"]);
    expect(map.get("media/horn.flac")).toEqual(incompressible);
  });

  it("says so rather than guessing when the file is not a zip at all", async () => {
    const { unzip } = await import("./zip");
    await expect(unzip(new Blob(["not a zip, just some text"]))).rejects.toThrow(/not a zip/i);
  });

  it("refuses an archive whose tail has been cut off", async () => {
    const { unzip } = await import("./zip");
    // The end record survives and the payload does not, which is what an interrupted download
    // leaves behind. Reading it as an empty archive would silently import a show with no cues.
    const whole = new Uint8Array(await zip(entries()).arrayBuffer());
    const end = whole.length - 22;
    const broken = new Uint8Array(whole.length - 40);
    broken.set(whole.subarray(0, broken.length - 22));
    broken.set(whole.subarray(end), broken.length - 22);
    await expect(unzip(broken as Uint8Array<ArrayBuffer>)).rejects.toThrow();
  });
});
