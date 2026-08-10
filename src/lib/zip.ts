/**
 * A zip writer, store method only, about eighty lines.
 *
 * ponytail: the only thing this app ever zips is one person's own library on their way out, so
 * compression buys a smaller download of files that are already compressed (mp3, png, mp4) and
 * costs a dependency. Store is the honest choice here. If a future export is mostly text, add
 * DEFLATE with CompressionStream rather than a library.
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

/** MS-DOS packed date and time, which is what a zip header carries. Seconds land on even numbers. */
export function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Names are stored with forward slashes and no leading slash, whatever the caller passes. */
export const zipName = (name: string) => name.replace(/\\/g, "/").replace(/^\/+/, "");

export function zip(entries: ZipEntry[], now = new Date()): Blob {
  const enc = new TextEncoder();
  const { time, date } = dosTime(now);
  const locals: Bytes[] = [];
  const central: Bytes[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = enc.encode(zipName(e.name));
    const sum = crc32(e.body);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true); // names are UTF-8
    head.setUint16(8, 0, true);      // stored
    head.setUint16(10, time, true);
    head.setUint16(12, date, true);
    head.setUint32(14, sum, true);
    head.setUint32(18, e.body.length, true);
    head.setUint32(22, e.body.length, true);
    head.setUint16(26, name.length, true);
    locals.push(new Uint8Array(head.buffer), name, e.body);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, date, true);
    dir.setUint32(16, sum, true);
    dir.setUint32(20, e.body.length, true);
    dir.setUint32(24, e.body.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);

    offset += 30 + name.length + e.body.length;
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
