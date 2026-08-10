import { describe, expect, it } from "vitest";
import { crc32, dosTime, zip, zipName } from "./zip";

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
