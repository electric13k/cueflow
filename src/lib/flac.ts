/**
 * FLAC, written here rather than fetched.
 *
 * Every edit in the waveform editor used to come back as a WAV -- `encodeWav` in `lib/audio.ts`,
 * 16-bit PCM, no container overhead worth mentioning and no compression at all. Trim four seconds
 * off a four-megabyte MP3 and the thing that goes back to storage is fifty megabytes. That is the
 * single largest waste in the app: it is paid on upload, again on every device that syncs, and
 * again in the offline cache of everyone in the room.
 *
 * FLAC fixes it without changing a sample. It is lossless by definition -- the decoder reconstructs
 * the exact integers that went in -- and every browser that can play the app can decode it, so the
 * cue still plays from a plain `<audio src>`.
 *
 * **Why not ffmpeg.wasm.** It is already a dependency (`lib/video.ts`), and `-c:a flac` would work.
 * But its 30 MB core is fetched from a CDN at runtime, and an app whose whole claim is that it runs
 * a show with no network cannot make "save an edit" depend on a third-party download. This encoder
 * is a few hundred lines with no dependency and no fetch.
 *
 * **What is implemented.** Fixed predictors (orders 0-4) with Rice-coded residuals, a partition
 * order search, and the four stereo decorrelations. Not LPC: the gain over fixed predictors on
 * ordinary programme material is real but modest, and it costs an autocorrelation and a
 * Levinson-Durbin per block. The encoder refuses to emit anything larger than the PCM it was given
 * (`encodeFlac` returns null), so a pathological input falls back to WAV rather than growing.
 *
 * Reference: the FLAC format specification, https://xiph.org/flac/format.html
 */

/** One block of samples per frame. 4096 is the reference encoder's default and divides by 32, which
 *  is what lets the partition order search go as deep as 5. */
const BLOCK = 4096;

/** Rice parameter 15 is the escape code for an unencoded partition, so a real parameter stops at 14. */
const MAX_RICE = 14;

/** How deep the partition search goes. Beyond this the 4 bits per partition costs more than the
 *  better-fitted parameters save. */
const MAX_PARTITION_ORDER = 5;

/** Bits MSB-first, which is the only order FLAC uses. */
class Bits {
  private out: number[] = [];
  private acc = 0;
  private held = 0;

  /** `width` must be 1..32, and `value` is taken modulo that width. */
  write(value: number, width: number) {
    for (let bit = width - 1; bit >= 0; bit--) this.one((value >>> bit) & 1);
  }

  /** Two's complement in `width` bits. */
  writeSigned(value: number, width: number) {
    this.write(value < 0 ? value + (width === 32 ? 0x100000000 : 1 << width) : value, width);
  }

  /** `zeros` zero bits then a one: the unary half of a Rice code. */
  unary(zeros: number) {
    for (let i = 0; i < zeros; i++) this.one(0);
    this.one(1);
  }

  /** Zero-fill to the next byte. FLAC frames are byte-aligned before their CRC-16. */
  align() {
    while (this.held) this.one(0);
  }

  get length() {
    return this.out.length;
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.out);
  }

  private one(bit: number) {
    this.acc = (this.acc << 1) | bit;
    if (++this.held !== 8) return;
    this.out.push(this.acc & 0xff);
    this.acc = 0;
    this.held = 0;
  }
}

const CRC8 = new Uint8Array(256);
const CRC16 = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  let eight = i;
  let sixteen = i << 8;
  for (let bit = 0; bit < 8; bit++) {
    eight = eight & 0x80 ? ((eight << 1) ^ 0x07) & 0xff : (eight << 1) & 0xff;
    sixteen = sixteen & 0x8000 ? ((sixteen << 1) ^ 0x8005) & 0xffff : (sixteen << 1) & 0xffff;
  }
  CRC8[i] = eight;
  CRC16[i] = sixteen;
}

export const crc8 = (bytes: Uint8Array) => bytes.reduce((crc, byte) => CRC8[crc ^ byte], 0);
export const crc16 = (bytes: Uint8Array) => bytes.reduce((crc, byte) => ((crc << 8) ^ CRC16[((crc >> 8) ^ byte) & 0xff]) & 0xffff, 0);

/**
 * The frame number, in the same variable-length scheme UTF-8 uses for code points, extended to 36
 * bits. Frames are numbered from zero and a long recording passes 127 in twelve seconds, so the
 * multi-byte forms are reached in practice and not only in theory.
 */
export function utf8Number(value: number): number[] {
  if (value < 0x80) return [value];
  const widths: [number, number, number][] = [
    [0x800, 2, 0xc0],
    [0x10000, 3, 0xe0],
    [0x200000, 4, 0xf0],
    [0x4000000, 5, 0xf8],
    [0x80000000, 6, 0xfc],
    [0x1000000000, 7, 0xfe],
  ];
  const found = widths.find(([limit]) => value < limit);
  if (!found) throw new Error("That recording is too long to number a FLAC frame for.");
  const [, bytes, lead] = found;
  const out: number[] = [];
  let left = value;
  for (let i = bytes - 1; i > 0; i--) {
    out[i] = 0x80 | (left % 64);
    left = Math.floor(left / 64);
  }
  out[0] = lead | left;
  return out;
}

/** Zig-zag: Rice codes unsigned integers, and residuals are signed and centred on zero. */
const fold = (value: number) => (value < 0 ? -2 * value - 1 : 2 * value);

/** The five fixed predictors, as the differences the decoder will undo. */
function residualsFor(samples: Int32Array, order: number): Int32Array {
  const out = new Int32Array(samples.length - order);
  for (let i = order; i < samples.length; i++) {
    const s = samples;
    out[i - order] =
      order === 0 ? s[i]
        : order === 1 ? s[i] - s[i - 1]
          : order === 2 ? s[i] - 2 * s[i - 1] + s[i - 2]
            : order === 3 ? s[i] - 3 * s[i - 1] + 3 * s[i - 2] - s[i - 3]
              : s[i] - 4 * s[i - 1] + 6 * s[i - 2] - 4 * s[i - 3] + s[i - 4];
  }
  return out;
}

/** What a partition of `count` residuals summing to `sum` costs at Rice parameter `k`.
 *  An estimate, because `sum(u >> k)` is not `sum(u) >> k`; it is within a bit a sample and it is
 *  what picks the parameter, never what is written. The winner's real cost is measured below. */
const estimate = (count: number, sum: number, k: number) => count * (k + 1) + Math.floor(sum / 2 ** k);

const riceCost = (folded: Uint32Array, from: number, to: number, k: number) => {
  let bits = 0;
  for (let i = from; i < to; i++) bits += (folded[i] >>> k) + 1 + k;
  return bits;
};

/**
 * The cheapest Rice parameter for one partition.
 *
 * Costed from a running total rather than by walking the samples once per candidate: the search is
 * fifteen parameters deep inside six partition orders inside five predictor orders, so measuring
 * each combination exactly meant four hundred passes over every block and an encode that ran at a
 * third of real time. The optimum is at `log2(mean)` by construction, so three candidates around it
 * find it, and the arithmetic is O(1) once the partition sums exist.
 */
function bestParam(count: number, sum: number) {
  const around = count > 0 && sum > count ? Math.floor(Math.log2(sum / count)) : 0;
  let param = 0;
  let cost = Infinity;
  for (let k = Math.max(0, around - 1); k <= Math.min(MAX_RICE, around + 2); k++) {
    const tried = estimate(count, sum, k);
    if (tried >= cost) continue;
    cost = tried;
    param = k;
  }
  return { param, cost };
}

type Partitioning = { order: number; params: number[]; bits: number };

/**
 * How to split the residual so each part gets a Rice parameter that fits it.
 *
 * A quiet passage followed by a loud one is the case this exists for: one parameter over the whole
 * block is set by the loud half and wastes bits on the quiet one. Each extra order doubles the
 * partition count and costs 4 more bits of parameter, so the search stops as soon as that is not
 * repaid.
 */
function partition(folded: Uint32Array, blockSize: number, predictorOrder: number): Partitioning {
  // Running totals, so any partition's sum is two lookups however the block is cut up.
  const running = new Float64Array(folded.length + 1);
  for (let i = 0; i < folded.length; i++) running[i + 1] = running[i] + folded[i];
  const sumOf = (from: number, to: number) => running[to] - running[from];

  let best: Partitioning | null = null;
  for (let order = 0; order <= MAX_PARTITION_ORDER; order++) {
    const count = 1 << order;
    if (blockSize % count) break;
    const each = blockSize >> order;
    if (each <= predictorOrder) break;
    const params: number[] = [];
    let bits = 6 + count * 4;
    for (let index = 0; index < count; index++) {
      const from = index === 0 ? 0 : index * each - predictorOrder;
      const to = (index + 1) * each - predictorOrder;
      const { param, cost } = bestParam(to - from, sumOf(from, to));
      params.push(param);
      bits += cost;
    }
    if (!best || bits < best.bits) best = { order, params, bits };
  }
  // A block one sample long with an order-4 predictor has no residual to partition; order 0 with an
  // empty partition is still a legal encoding of it.
  if (!best) return { order: 0, params: [0], bits: 6 + 4 };

  // The search ran on estimates. What gets compared against verbatim, and against the other stereo
  // decorrelations, has to be the number of bits that will actually be written.
  const each = blockSize >> best.order;
  let exact = 6 + (1 << best.order) * 4;
  for (let index = 0; index < 1 << best.order; index++) {
    const from = index === 0 ? 0 : index * each - predictorOrder;
    exact += riceCost(folded, from, (index + 1) * each - predictorOrder, best.params[index]);
  }
  return { ...best, bits: exact };
}

type Plan = { bits: number; emit: (bits: Bits) => void };

/** The cheapest way to write one channel of one block, and a closure that writes it. */
function planSubframe(samples: Int32Array, bps: number): Plan {
  const header = 8; // zero bit + 6 type bits + wasted-bits flag

  const constant = samples.every(value => value === samples[0]);
  if (constant) {
    return {
      bits: header + bps,
      emit: bits => {
        bits.write(0, 1);
        bits.write(0b000000, 6);
        bits.write(0, 1);
        bits.writeSigned(samples[0], bps);
      },
    };
  }

  let best: Plan = {
    bits: header + bps * samples.length,
    emit: bits => {
      bits.write(0, 1);
      bits.write(0b000001, 6);
      bits.write(0, 1);
      for (const value of samples) bits.writeSigned(value, bps);
    },
  };

  for (let order = 0; order <= 4 && order < samples.length; order++) {
    const residual = residualsFor(samples, order);
    const folded = new Uint32Array(residual.length);
    let overflow = false;
    for (let i = 0; i < residual.length; i++) {
      const value = fold(residual[i]);
      // A residual wider than the bit writer can take would be written wrong rather than large.
      if (!Number.isSafeInteger(value) || value < 0 || value > 0x7fffffff) { overflow = true; break; }
      folded[i] = value;
    }
    if (overflow) continue;
    const chosen = partition(folded, samples.length, order);
    const bits = header + order * bps + chosen.bits;
    if (bits >= best.bits) continue;
    best = {
      bits,
      emit: writer => {
        writer.write(0, 1);
        writer.write(0b001000 | order, 6);
        writer.write(0, 1);
        for (let i = 0; i < order; i++) writer.writeSigned(samples[i], bps);
        writer.write(0, 2); // residual coding method: 4-bit Rice parameters
        writer.write(chosen.order, 4);
        const count = 1 << chosen.order;
        const each = samples.length >> chosen.order;
        for (let index = 0; index < count; index++) {
          const k = chosen.params[index];
          writer.write(k, 4);
          const from = index === 0 ? 0 : index * each - order;
          const to = (index + 1) * each - order;
          for (let i = from; i < to; i++) {
            writer.unary(folded[i] >>> k);
            if (k) writer.write(folded[i] & ((1 << k) - 1), k);
          }
        }
      },
    };
  }

  return best;
}

/** Channel assignment 8-10 in the frame header: which pair of signals is actually written. */
type Stereo = { assignment: number; plans: [Plan, Plan] };

function planStereo(left: Int32Array, right: Int32Array, bps: number): Stereo {
  const length = left.length;
  const side = new Int32Array(length);
  const mid = new Int32Array(length);
  for (let i = 0; i < length; i++) {
    side[i] = left[i] - right[i];
    // Floor division, not a truncating one: the decoder recovers the lost bit from side's parity.
    mid[i] = (left[i] + right[i]) >> 1;
  }
  const l = planSubframe(left, bps);
  const r = planSubframe(right, bps);
  const s = planSubframe(side, bps + 1);
  const m = planSubframe(mid, bps);
  const options: Stereo[] = [
    { assignment: 1, plans: [l, r] },
    { assignment: 8, plans: [l, s] },
    { assignment: 9, plans: [s, r] },
    { assignment: 10, plans: [m, s] },
  ];
  return options.reduce((a, b) => (a.plans[0].bits + a.plans[1].bits <= b.plans[0].bits + b.plans[1].bits ? a : b));
}

export type FlacSource = {
  /** One Int32Array per channel, each the same length, already quantised to `bitsPerSample`. */
  channels: Int32Array[];
  sampleRate: number;
  bitsPerSample: number;
};

/**
 * The encoded stream, or `null` when it would be no smaller than the PCM it came from.
 *
 * Returning null rather than a bigger file is deliberate: the caller's fallback is the WAV it
 * already has, and silence about a format that grew is how an "optimisation" ends up costing
 * storage.
 */
// The buffer is spelled out because TypeScript 5.7 made `Uint8Array` generic over it, and a plain
// `Uint8Array` now means `ArrayBufferLike`, which `new File([...])` will not take: the callers that
// write this straight to a File could not type-check. What is returned is always its own buffer.
export function encodeFlac({ channels, sampleRate, bitsPerSample: bps }: FlacSource): Uint8Array<ArrayBuffer> | null {
  if (!channels.length) return null;
  const total = channels[0].length;
  if (!total) return null;
  if (channels.some(channel => channel.length !== total)) throw new Error("Channels of different lengths cannot be one FLAC stream.");
  if (bps < 4 || bps > 24) throw new Error(`FLAC here writes 4 to 24 bits a sample, not ${bps}.`);
  if (sampleRate < 1 || sampleRate > 0xfffff) throw new Error(`${sampleRate} Hz is outside what a FLAC header can hold.`);

  const frames: Uint8Array[] = [];
  let minFrame = Infinity;
  let maxFrame = 0;

  for (let start = 0, number = 0; start < total; start += BLOCK, number++) {
    const size = Math.min(BLOCK, total - start);
    const block = channels.map(channel => channel.subarray(start, start + size) as Int32Array);

    const stereo = block.length === 2 ? planStereo(block[0], block[1], bps) : null;
    const plans = stereo ? stereo.plans : block.map(channel => planSubframe(channel, bps));
    const assignment = stereo ? stereo.assignment : block.length - 1;

    const head = new Bits();
    head.write(0b11111111111110, 14);
    head.write(0, 1); // reserved
    head.write(0, 1); // fixed blocksize: frames are numbered, not sample-addressed
    head.write(0b0111, 4); // block size follows the header as a 16-bit value
    head.write(0b0000, 4); // sample rate: from STREAMINFO
    head.write(assignment, 4);
    // Sample size: from STREAMINFO. The four-bit codes only name 8, 12, 16, 20 and 24, so deferring
    // is both shorter and the only option that stays right if this is ever handed 18-bit audio.
    head.write(0b000, 3);
    head.write(0, 1); // reserved
    for (const byte of utf8Number(number)) head.write(byte, 8);
    head.write(size - 1, 16);
    const headBytes = head.bytes();

    const frame = new Bits();
    for (const byte of headBytes) frame.write(byte, 8);
    frame.write(crc8(headBytes), 8);
    for (const plan of plans) plan.emit(frame);
    frame.align();
    const body = frame.bytes();

    const whole = new Uint8Array(body.length + 2);
    whole.set(body);
    const sum = crc16(body);
    whole[body.length] = sum >> 8;
    whole[body.length + 1] = sum & 0xff;
    frames.push(whole);
    minFrame = Math.min(minFrame, whole.length);
    maxFrame = Math.max(maxFrame, whole.length);
  }

  const header = new Bits();
  for (const byte of [0x66, 0x4c, 0x61, 0x43]) header.write(byte, 8); // "fLaC"
  header.write(1, 1); // this is the last metadata block
  header.write(0, 7); // STREAMINFO
  header.write(34, 24);
  header.write(Math.min(BLOCK, total), 16);
  header.write(BLOCK, 16);
  header.write(minFrame === Infinity ? 0 : minFrame, 24);
  header.write(maxFrame, 24);
  header.write(sampleRate, 20);
  header.write(channels.length - 1, 3);
  header.write(bps - 1, 5);
  // 36 bits, and the writer takes 32 at a time.
  header.write(Math.floor(total / 0x100000000), 4);
  header.write(total >>> 0, 32);
  // The MD5 of the input samples. All zeros is the spec's "not computed", which every decoder
  // accepts; computing it would mean an MD5 implementation for a field nothing here reads.
  for (let i = 0; i < 16; i++) header.write(0, 8);

  const meta = header.bytes();
  const size = frames.reduce((sum, frame) => sum + frame.length, meta.length);
  if (size >= total * channels.length * Math.ceil(bps / 8)) return null;

  const out = new Uint8Array(size);
  out.set(meta);
  let at = meta.length;
  for (const frame of frames) { out.set(frame, at); at += frame.length; }
  return out;
}

/**
 * The same quantisation `encodeWav` uses, so switching container changes no sample.
 *
 * Two details are inherited rather than improved on: the asymmetry (`0x8000` down, `0x7fff` up),
 * and truncation towards zero, which is what `DataView.setInt16` does to a fractional value.
 * Rounding would be a shade more accurate and would also mean the FLAC of an edit and the WAV of
 * the same edit hold different integers -- and then "the container changed, the audio did not" is
 * no longer a claim anything can check.
 */
export const toInt16 = (data: Float32Array): Int32Array => {
  const out = new Int32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const sample = Math.max(-1, Math.min(1, data[i]));
    out[i] = Math.trunc(sample < 0 ? sample * 0x8000 : sample * 0x7fff);
  }
  return out;
};
