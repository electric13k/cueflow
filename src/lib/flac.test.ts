import { describe, expect, it } from "vitest";
import { crc8, crc16, encodeFlac, toInt16, utf8Number } from "./flac";

/**
 * A FLAC reader, here rather than in the library, and deliberately only as much of the format as
 * `encodeFlac` emits.
 *
 * The claim the encoder makes is that the decoder gets back the exact integers that went in. A test
 * that only measured the output size would pass on a stream no decoder can read, and one that only
 * round-tripped through the encoder's own helpers would agree with its own mistakes. So this walks
 * the bitstream the way a real decoder does -- sync word, header CRC, subframe types, Rice
 * partitions, stereo decorrelation, frame CRC -- and any of those getting written wrongly shows up
 * as a failure here rather than as a cue that will not play in a venue.
 */
class Reader {
  private at = 0;
  constructor(private readonly bytes: Uint8Array) {}

  read(width: number) {
    let value = 0;
    for (let i = 0; i < width; i++) {
      const bit = (this.bytes[this.at >> 3] >> (7 - (this.at & 7))) & 1;
      value = value * 2 + bit;
      this.at++;
    }
    return value;
  }

  signed(width: number) {
    const value = this.read(width);
    return value >= 2 ** (width - 1) ? value - 2 ** width : value;
  }

  unary() {
    let zeros = 0;
    while (this.read(1) === 0) zeros++;
    return zeros;
  }

  align() {
    this.at = (this.at + 7) & ~7;
  }

  get byteAt() {
    return this.at >> 3;
  }

  get done() {
    return this.byteAt >= this.bytes.length;
  }
}

const unfold = (value: number) => (value & 1 ? -((value + 1) / 2) : value / 2);

function subframe(reader: Reader, size: number, bps: number): number[] {
  expect(reader.read(1)).toBe(0);
  const type = reader.read(6);
  expect(reader.read(1)).toBe(0); // no wasted bits are ever written

  if (type === 0) return new Array(size).fill(reader.signed(bps));
  if (type === 1) return Array.from({ length: size }, () => reader.signed(bps));

  expect(type & 0b111000).toBe(0b001000);
  const order = type & 0b000111;
  expect(order).toBeLessThanOrEqual(4);

  const out: number[] = [];
  for (let i = 0; i < order; i++) out.push(reader.signed(bps));

  expect(reader.read(2)).toBe(0);
  const partitionOrder = reader.read(4);
  const partitions = 1 << partitionOrder;
  const each = size >> partitionOrder;
  const residual: number[] = [];
  for (let index = 0; index < partitions; index++) {
    const k = reader.read(4);
    expect(k).toBeLessThan(15);
    const count = (index === 0 ? each - order : each);
    for (let i = 0; i < count; i++) residual.push(unfold(reader.unary() * 2 ** k + reader.read(k)));
  }
  expect(residual.length).toBe(size - order);

  for (const value of residual) {
    const n = out.length;
    const predicted =
      order === 0 ? 0
        : order === 1 ? out[n - 1]
          : order === 2 ? 2 * out[n - 1] - out[n - 2]
            : order === 3 ? 3 * out[n - 1] - 3 * out[n - 2] + out[n - 3]
              : 4 * out[n - 1] - 6 * out[n - 2] + 4 * out[n - 3] - out[n - 4];
    out.push(predicted + value);
  }
  return out;
}

function decodeFlac(bytes: Uint8Array) {
  expect([...bytes.subarray(0, 4)]).toEqual([0x66, 0x4c, 0x61, 0x43]);
  const meta = new Reader(bytes.subarray(4));
  expect(meta.read(1)).toBe(1); // the only metadata block
  expect(meta.read(7)).toBe(0); // STREAMINFO
  expect(meta.read(24)).toBe(34);
  meta.read(16); meta.read(16); meta.read(24); meta.read(24);
  const sampleRate = meta.read(20);
  const channelCount = meta.read(3) + 1;
  const bps = meta.read(5) + 1;
  const total = meta.read(4) * 2 ** 32 + meta.read(32);

  const channels: number[][] = Array.from({ length: channelCount }, () => []);
  let from = 4 + 4 + 34;
  let number = 0;
  while (from < bytes.length) {
    const reader = new Reader(bytes.subarray(from));
    expect(reader.read(14)).toBe(0b11111111111110);
    expect(reader.read(1)).toBe(0);
    expect(reader.read(1)).toBe(0); // fixed block size
    expect(reader.read(4)).toBe(0b0111); // size follows the header
    expect(reader.read(4)).toBe(0); // sample rate from STREAMINFO
    const assignment = reader.read(4);
    expect(reader.read(3)).toBe(0); // sample size from STREAMINFO
    expect(reader.read(1)).toBe(0);
    expect([...bytes.subarray(from + reader.byteAt, from + reader.byteAt + utf8Number(number).length)]).toEqual(utf8Number(number));
    for (let i = 0; i < utf8Number(number).length; i++) reader.read(8);
    const size = reader.read(16) + 1;
    const headerBytes = bytes.subarray(from, from + reader.byteAt);
    expect(reader.read(8)).toBe(crc8(headerBytes));

    // The difference channel needs one bit more than the others, and which of the two it is
    // depends on the assignment: channel 0 for right/side, channel 1 for left/side and mid/side.
    const side = assignment === 9 ? 0 : 1;
    const blocks = assignment >= 8
      ? [0, 1].map(index => subframe(reader, size, bps + (index === side ? 1 : 0)))
      : Array.from({ length: assignment + 1 }, () => subframe(reader, size, bps));

    if (assignment === 8) for (let i = 0; i < size; i++) blocks[1][i] = blocks[0][i] - blocks[1][i];
    if (assignment === 9) for (let i = 0; i < size; i++) blocks[0][i] = blocks[0][i] + blocks[1][i];
    if (assignment === 10) for (let i = 0; i < size; i++) {
      const side = blocks[1][i];
      const mid = blocks[0][i] * 2 + (side & 1);
      blocks[0][i] = (mid + side) >> 1;
      blocks[1][i] = (mid - side) >> 1;
    }

    reader.align();
    const bodyEnd = from + reader.byteAt;
    expect(reader.read(16)).toBe(crc16(bytes.subarray(from, bodyEnd)));
    blocks.forEach((block, index) => channels[index].push(...block));
    from = bodyEnd + 2;
    number++;
  }
  expect(channels[0].length).toBe(total);
  return { channels, sampleRate, bps };
}

const encodeOrThrow = (source: Parameters<typeof encodeFlac>[0]) => {
  const bytes = encodeFlac(source);
  if (!bytes) throw new Error("The encoder refused this input, so there is nothing to decode.");
  return bytes;
};

describe("the checksums a decoder validates against", () => {
  const check = new TextEncoder().encode("123456789");
  it("matches the standard CRC-8 vector", () => expect(crc8(check)).toBe(0xf4));
  it("matches the standard CRC-16 vector", () => expect(crc16(check)).toBe(0xfee8));
});

describe("frame numbering", () => {
  // FLAC numbers frames with UTF-8's own variable-length scheme, so for every value UTF-8 can also
  // express, the platform encoder is an independent answer to check against.
  it("agrees with UTF-8 wherever UTF-8 reaches", () => {
    const encoder = new TextEncoder();
    for (const value of [0, 1, 0x7f, 0x80, 0x7ff, 0x800, 0xffff, 0x10000, 0x10ffff]) {
      if (value >= 0xd800 && value <= 0xdfff) continue;
      expect(utf8Number(value)).toEqual([...encoder.encode(String.fromCodePoint(value))]);
    }
  });

  it("carries on past what UTF-8 stops at", () => {
    expect(utf8Number(0x200000)).toEqual([0xf8, 0x88, 0x80, 0x80, 0x80]);
    expect(utf8Number(0xfffffffff)).toEqual([0xfe, 0xbf, 0xbf, 0xbf, 0xbf, 0xbf, 0xbf]);
  });

  it("refuses a recording longer than the field", () => {
    expect(() => utf8Number(0x1000000000)).toThrow(/too long/);
  });
});

/** Deterministic so a failure is reproducible, and shaped so the fixed predictors have work to do. */
function tone(length: number, seed: number, noise = 0) {
  const out = new Int32Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    out[i] = Math.round(12000 * Math.sin(i / 17) + 3000 * Math.sin(i / 3.1) + noise * ((state / 0x7fffffff) * 2 - 1));
  }
  return out;
}

describe("encoding a stream a decoder can read back", () => {
  it("returns every sample of a mono block unchanged", () => {
    const channels = [tone(9000, 7, 400)];
    const { channels: back, sampleRate, bps } = decodeFlac(encodeOrThrow({ channels, sampleRate: 44100, bitsPerSample: 16 }));
    expect(sampleRate).toBe(44100);
    expect(bps).toBe(16);
    expect(back[0]).toEqual([...channels[0]]);
  });

  it("returns both channels of a stereo stream unchanged", () => {
    const left = tone(5000, 11, 900);
    const right = tone(5000, 23, 900);
    const { channels: back } = decodeFlac(encodeOrThrow({ channels: [left, right], sampleRate: 48000, bitsPerSample: 16 }));
    expect(back[0]).toEqual([...left]);
    expect(back[1]).toEqual([...right]);
  });

  it("survives correlated channels, which is where stereo decorrelation is chosen", () => {
    const left = tone(4600, 5);
    const right = Int32Array.from(left, value => value + 3);
    const { channels: back } = decodeFlac(encodeOrThrow({ channels: [left, right], sampleRate: 44100, bitsPerSample: 16 }));
    expect(back[0]).toEqual([...left]);
    expect(back[1]).toEqual([...right]);
  });

  it("survives the extremes of the sample range", () => {
    // Both rails, inside material a predictor can still follow -- which is what a clipped master
    // actually looks like, as opposed to the alternating-rail case below.
    const channels = [tone(3000, 31, 100)];
    channels[0][0] = -32768;
    channels[0][1] = 32767;
    channels[0][2999] = -32768;
    const { channels: back } = decodeFlac(encodeOrThrow({ channels, sampleRate: 44100, bitsPerSample: 16 }));
    expect(back[0]).toEqual([...channels[0]]);
  });

  it("survives a block that is exactly silent", () => {
    const channels = [new Int32Array(5000)];
    const { channels: back } = decodeFlac(encodeOrThrow({ channels, sampleRate: 44100, bitsPerSample: 16 }));
    expect(back[0]).toEqual([...channels[0]]);
  });

  // 4096 samples to a frame, so this is the case where the last frame is short and the one before
  // it is full -- the boundary that a fixed block size stream gets wrong if it is got wrong at all.
  it("survives a length that does not divide by the block size", () => {
    const channels = [tone(4097, 3, 200)];
    const { channels: back } = decodeFlac(encodeOrThrow({ channels, sampleRate: 44100, bitsPerSample: 16 }));
    expect(back[0]).toEqual([...channels[0]]);
  });

  it("survives a stream shorter than one frame", () => {
    const channels = [tone(1000, 9, 150)];
    const { channels: back } = decodeFlac(encodeOrThrow({ channels, sampleRate: 22050, bitsPerSample: 16 }));
    expect(back[0]).toEqual([...channels[0]]);
  });
});

describe("what it refuses", () => {
  // Every sample the opposite rail from the one before it. No fixed predictor fits, the residual
  // needs seventeen bits, and the four-bit Rice parameter stops at fourteen -- so the cheapest
  // legal encoding is verbatim, which is the PCM plus a header. Refusing is the right answer.
  it("gives back nothing for a signal that alternates between the rails", () => {
    const channels = [Int32Array.from({ length: 700 }, (_, i) => (i % 2 ? 32767 : -32768))];
    expect(encodeFlac({ channels, sampleRate: 44100, bitsPerSample: 16 })).toBeNull();
  });

  it("gives back nothing for a clip too short to pay for a header", () => {
    expect(encodeFlac({ channels: [Int32Array.from([1, -2, 3])], sampleRate: 44100, bitsPerSample: 16 })).toBeNull();
  });

  it("gives back nothing rather than a file larger than the PCM", () => {
    // Full-scale white noise has no predictor to find, so an honest encoder cannot shrink it.
    let state = 1;
    const channels = [Int32Array.from({ length: 6000 }, () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return (state % 65536) - 32768;
    })];
    const bytes = encodeFlac({ channels, sampleRate: 44100, bitsPerSample: 16 });
    if (bytes) expect(bytes.length).toBeLessThan(channels[0].length * 2);
  });

  it("refuses channels that are not the same length", () => {
    expect(() => encodeFlac({ channels: [new Int32Array(4), new Int32Array(5)], sampleRate: 44100, bitsPerSample: 16 }))
      .toThrow(/different lengths/);
  });

  it("has nothing to say about an empty stream", () => {
    expect(encodeFlac({ channels: [], sampleRate: 44100, bitsPerSample: 16 })).toBeNull();
    expect(encodeFlac({ channels: [new Int32Array(0)], sampleRate: 44100, bitsPerSample: 16 })).toBeNull();
  });
});

describe("quantisation", () => {
  it("matches what the WAV writer does, so changing container changes no sample", () => {
    const samples = Float32Array.from([0, 1, -1, 0.5, -0.5, 0.25, 2, -2]);
    // Ground truth: the same values through the same DataView call `encodeWav` makes.
    const view = new DataView(new ArrayBuffer(samples.length * 2));
    samples.forEach((raw, i) => {
      const sample = Math.max(-1, Math.min(1, raw));
      view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    });
    const wav = Array.from(samples, (_, i) => view.getInt16(i * 2, true));
    expect([...toInt16(samples)]).toEqual(wav);
    expect(wav).toEqual([0, 32767, -32768, 16383, -16384, 8191, 32767, -32768]);
  });
});
