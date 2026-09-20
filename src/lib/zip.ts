/**
 * A zip writer, store and DEFLATE, about a hundred and fifty lines.
 *
 * ponytail: store was the honest choice while the only thing this app zipped was one person's
 * library of mp3s and pngs on their way out, bytes that are already entropy-coded. An export now
 * carries the rows as JSON and a README as well, and those are the compressible half, so entries
 * go through CompressionStream and each one keeps whichever of the two forms is smaller. No
 * dependency, and no growth on the media.
 *
 * zip() stays synchronous, because pptx.ts builds a deck with `new File([zip(entries)], ...)` and
 * CompressionStream cannot be awaited inside that. Run entries through deflateEntries() first when
 * you want them compressed; zip() writes whatever form it is handed.
 *
 * The output is a real zip: local headers, a central directory and an end record, UTF-8 names.
 */

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Blob only accepts views over a plain ArrayBuffer, so the bytes are typed that way end to end. */
export type Bytes = Uint8Array<ArrayBuffer>;
export type ZipEntry = { name: string; body: Bytes };

/**
 * An entry whose payload has already been through DEFLATE. `body` stays the ORIGINAL bytes: the
 * CRC-32 and the uncompressed-size field of both headers describe those, and only the
 * compressed-size field describes `packed`. Getting that pair the wrong way round writes an
 * archive that one reader opens and the next rejects.
 */
export type PackedEntry = ZipEntry & { packed: Bytes; method: 0 | 8 };

const stored = (e: ZipEntry): PackedEntry => ({ ...e, packed: e.body, method: 0 });

/**
 * Bytes in, transformed bytes out. Exported because backup.ts gzips through the same mechanism and
 * two copies of a reader loop drift.
 */
export async function pipeBytes(bytes: Bytes, t: GenericTransformStream): Promise<Bytes> {
  const writer = t.writable.getWriter();
  // Not awaited: the writer only drains as the reader below pulls, so awaiting the write of
  // anything past one chunk deadlocks. A failure here still surfaces, as a rejected read().
  const written = writer.write(bytes).then(() => writer.close());
  const reader = (t.readable as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await written;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** CompressionStream is missing in older Safari and in some test environments. */
const canDeflate = () => typeof globalThis.CompressionStream === "function";

/**
 * DEFLATE the entries that get smaller for it and store the rest.
 *
 * Two constraints shape this. First, a FLAC, an MP3, a PNG or a nested zip is already
 * entropy-coded and comes out of DEFLATE a few bytes LARGER, so keeping the smaller of the two
 * forms per entry is what stops an export being bigger than the files that went into it. Second,
 * no CompressionStream means every entry is stored: a larger archive, still a valid one. Never
 * throw because compression is unavailable, the export is somebody's only copy.
 */
export async function deflateEntries(entries: ZipEntry[]): Promise<PackedEntry[]> {
  if (!canDeflate()) return entries.map(stored);
  const out: PackedEntry[] = [];
  // One at a time: an export holds a whole library, and deflating every file at once would hold
  // both forms of all of them in the tab at the same time.
  for (const e of entries) {
    try {
      // "deflate-raw", not "deflate". A zip entry carries bare DEFLATE, while "deflate" wraps it
      // in a two byte zlib header and an Adler-32 trailer; readers that skip the extra bytes open
      // such an archive and readers that do not reject it. That is the whole bug risk here.
      const packed = await pipeBytes(e.body, new CompressionStream("deflate-raw"));
      out.push(packed.length < e.body.length ? { ...e, packed, method: 8 } : stored(e));
    } catch {
      out.push(stored(e));
    }
  }
  return out;
}

/** MS-DOS packed date and time, which is what a zip header carries. Seconds land on even numbers. */
export function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Names are stored with forward slashes and no leading slash, whatever the caller passes. */
export const zipName = (name: string) => name.replace(/\\/g, "/").replace(/^\/+/, "");

export function zip(entries: (ZipEntry | PackedEntry)[], now = new Date()): Blob {
  const enc = new TextEncoder();
  const { time, date } = dosTime(now);
  const locals: Bytes[] = [];
  const central: Bytes[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = enc.encode(zipName(e.name));
    const sum = crc32(e.body);
    // An entry deflateEntries() left alone is written exactly as before, stored.
    const packed = "packed" in e ? e.packed : e.body;
    const method = "packed" in e ? e.method : 0;
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true); // names are UTF-8
    head.setUint16(8, method, true); // 8 deflated, 0 stored
    head.setUint16(10, time, true);
    head.setUint16(12, date, true);
    head.setUint32(14, sum, true);
    head.setUint32(18, packed.length, true);  // compressed size
    head.setUint32(22, e.body.length, true);  // uncompressed size, the original either way
    head.setUint16(26, name.length, true);
    locals.push(new Uint8Array(head.buffer), name, packed);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, method, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, date, true);
    dir.setUint32(16, sum, true);
    dir.setUint32(20, packed.length, true);   // compressed size
    dir.setUint32(24, e.body.length, true);   // uncompressed size, the original either way
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);

    offset += 30 + name.length + packed.length;
  }

  const dirSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...locals, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
}

/* ── reading ─────────────────────────────────────────────────────────────────────────────── */

/**
 * The reader half, added because an export is only half a feature.
 *
 * A show now leaves this app as a zip and has to come back in on another device, so the format
 * needs a parser as well as a writer. Written here rather than pulled in as a dependency for the
 * same reason the writer was: this is a hundred lines of DataView reads, and the archives it opens
 * are ones this file wrote.
 *
 * Central directory first, never the local headers alone. A local header is allowed to carry zeroes
 * for both sizes and defer them to a data descriptor after the payload, which is what a streaming
 * writer emits; the central directory always has the real numbers. Reading the local header only
 * for its name and extra lengths, and taking the sizes from the directory, opens both kinds.
 */
export type ReadEntry = { name: string; body: Bytes };

const canInflate = () => typeof globalThis.DecompressionStream === "function";

/** Where the end-of-central-directory record starts, or -1. The comment can be 64 KB, so scan back. */
function endRecord(view: DataView): number {
  const from = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let at = view.byteLength - 22; at >= from; at--) {
    if (view.getUint32(at, true) === 0x06054b50) return at;
  }
  return -1;
}

/**
 * Every entry in the archive, names and bytes.
 *
 * Throws with something a person can act on rather than returning null: every caller of this is
 * somebody opening a file they chose, and "that file is not a CueFlow show" belongs on screen.
 * Directory entries (a name ending in "/") are dropped; they carry no payload and every consumer
 * here works from full paths anyway.
 */
export async function unzip(source: Blob | Bytes): Promise<ReadEntry[]> {
  const bytes = source instanceof Blob ? (new Uint8Array(await source.arrayBuffer()) as Bytes) : source;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = endRecord(view);
  if (end < 0) throw new Error("That file is not a zip archive, so there is nothing in it to open.");

  const count = view.getUint16(end + 10, true);
  const dirAt = view.getUint32(end + 16, true);
  if (dirAt + 4 > bytes.length) throw new Error("This archive's directory points past the end of the file, so it is truncated.");

  const dec = new TextDecoder();
  const out: ReadEntry[] = [];
  let at = dirAt;
  for (let i = 0; i < count; i++) {
    // Thrown, never broken out of. Stopping early would return the entries read so far, and a
    // truncated download of a show would then import as a show with fewer cues in it than it has,
    // silently, which is found out on the night. A directory that does not parse is a damaged file.
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) {
      throw new Error("This archive's directory is damaged, so what is in it cannot be listed.");
    }
    const method = view.getUint16(at + 10, true);
    const packedSize = view.getUint32(at + 20, true);
    const plainSize = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue;
    if (localAt + 30 > bytes.length || view.getUint32(localAt, true) !== 0x04034b50) {
      throw new Error(`"${name}" is not where this archive says it is, so the file is damaged.`);
    }
    const dataAt = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    const packed = bytes.subarray(dataAt, dataAt + packedSize) as Bytes;
    if (packed.length < packedSize) throw new Error(`"${name}" runs past the end of this archive, so the file is truncated.`);

    if (method === 0) { out.push({ name, body: packed }); continue; }
    if (method !== 8) throw new Error(`"${name}" uses a compression method CueFlow cannot read.`);
    if (!canInflate()) throw new Error("This browser cannot decompress zip archives, so this file cannot be opened here.");
    const body = await pipeBytes(new Uint8Array(packed) as Bytes, new DecompressionStream("deflate-raw"));
    if (plainSize && body.length !== plainSize) throw new Error(`"${name}" did not decompress to the size this archive claims.`);
    out.push({ name, body });
  }
  return out;
}

/** The archive as a name-to-bytes map, which is how every caller here actually wants it. */
export async function unzipMap(source: Blob | Bytes): Promise<Map<string, Bytes>> {
  return new Map((await unzip(source)).map(e => [e.name, e.body]));
}
