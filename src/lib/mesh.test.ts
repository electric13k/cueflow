import { describe, expect, it } from "vitest";
import {
  BLE_FRAME, chunk, createReassembler, DEFAULT_TTL, FRAME_HEADER,
  fromBytes, messageIds, readFrame, relayTtl, toBytes, transferMs,
} from "./mesh";

const body = (n: number) => new Uint8Array(Array.from({ length: n }, (_, i) => i % 251));

describe("chunk", () => {
  it("puts a short message in one frame", () => {
    const frames = chunk(body(10), 1);
    expect(frames).toHaveLength(1);
    expect(frames[0].length).toBe(FRAME_HEADER + 10);
  });

  it("never exceeds the frame size a GATT write can carry", () => {
    for (const frame of chunk(body(5_000), 1)) expect(frame.length).toBeLessThanOrEqual(BLE_FRAME);
  });

  it("splits into as few frames as the size allows", () => {
    const room = BLE_FRAME - FRAME_HEADER;
    expect(chunk(body(room), 1)).toHaveLength(1);
    expect(chunk(body(room + 1), 1)).toHaveLength(2);
  });

  it("sends an empty message rather than nothing at all", () => {
    expect(chunk(new Uint8Array(0), 1)).toHaveLength(1);
  });

  it("refuses a frame size with no room for the header", () => {
    expect(() => chunk(body(10), 1, DEFAULT_TTL, FRAME_HEADER)).toThrow(/no room/);
  });
});

describe("readFrame", () => {
  it("reads back what chunk wrote", () => {
    const [frame] = chunk(body(20), 0x1234, 3);
    const head = readFrame(frame)!;
    expect(head.msgId).toBe(0x1234);
    expect(head.index).toBe(0);
    expect(head.total).toBe(1);
    expect(head.ttl).toBe(3);
  });

  it("ignores traffic that is not ours", () => {
    // Another app writing to the same characteristic must not be parsed as a cue.
    expect(readFrame(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBeNull();
    expect(readFrame(new Uint8Array(4))).toBeNull();
  });

  it("ignores a frame whose index is outside its own total", () => {
    const [frame] = chunk(body(10), 1);
    frame[4] = 0; frame[5] = 9;  // index 9 of 1
    expect(readFrame(frame)).toBeNull();
  });
});

describe("reassembly", () => {
  it("returns a single-frame message immediately", () => {
    const join = createReassembler();
    const [frame] = chunk(toBytes({ hello: true }), 7);
    expect(fromBytes(join.accept(frame)!.body)).toEqual({ hello: true });
  });

  it("waits for the last frame, then hands back the whole message", () => {
    const join = createReassembler();
    const original = body(3_000);
    const frames = chunk(original, 42);
    expect(frames.length).toBeGreaterThan(1);
    for (const frame of frames.slice(0, -1)) expect(join.accept(frame)).toBeNull();
    const done = join.accept(frames[frames.length - 1])!;
    expect(done.body).toEqual(original);
  });

  it("does not care what order the frames arrive in", () => {
    const join = createReassembler();
    const original = body(2_000);
    const frames = chunk(original, 9).reverse();
    let out = null;
    for (const frame of frames) out = join.accept(frame) ?? out;
    expect(out!.body).toEqual(original);
  });

  it("survives the same frame arriving twice over two links", () => {
    const join = createReassembler();
    const original = body(400);
    const frames = chunk(original, 5);
    expect(frames).toHaveLength(2);
    expect(join.accept(frames[0])).toBeNull();
    expect(join.accept(frames[0])).toBeNull();          // heard again, relayed
    const done = join.accept(frames[1])!;
    expect(done.body).toEqual(original);
  });

  it("reports the fewest hops any copy took, not the most", () => {
    const join = createReassembler();
    // 400 bytes is exactly two frames, so the second one completes the message.
    const original = body(400);
    const direct = chunk(original, 3, 4);
    const relayed = chunk(original, 3, 2);
    expect(direct).toHaveLength(2);
    join.accept(relayed[0]);
    const done = join.accept(direct[1])!;
    expect(done.ttl).toBe(2);
  });

  it("drops a message whose remaining frames never arrive", () => {
    let clock = 0;
    const join = createReassembler({ expireAfter: 1_000, now: () => clock });
    const frames = chunk(body(2_000), 11);
    join.accept(frames[0]);
    expect(join.pending).toBe(1);
    clock += 5_000;
    join.accept(chunk(body(10), 12)[0]);                 // any traffic triggers the sweep
    expect(join.pending).toBe(0);
  });

  it("holds only so many part-finished messages at once", () => {
    const join = createReassembler({ limit: 3 });
    for (let id = 0; id < 10; id++) join.accept(chunk(body(2_000), id)[0]);
    expect(join.pending).toBeLessThanOrEqual(3);
  });

  it("does not stitch two different messages together when an id wraps round", () => {
    const join = createReassembler();
    join.accept(chunk(body(2_000), 77)[0]);
    // Same id, a message of a different length: the older one must go, not be merged into.
    const fresh = chunk(body(400), 77);
    expect(join.accept(fresh[0])).toBeNull();
    expect(join.accept(fresh[1])!.body).toEqual(body(400));
  });
});

describe("relaying", () => {
  it("counts down, and stops", () => {
    expect(relayTtl(4)).toBe(3);
    expect(relayTtl(2)).toBe(1);
    // Without this, two devices in range of each other pass one cue back and forth for ever.
    expect(relayTtl(1)).toBeNull();
    expect(relayTtl(0)).toBeNull();
  });

  it("reaches across a venue but no further", () => {
    let ttl: number | null = DEFAULT_TTL;
    let hops = 0;
    while ((ttl = relayTtl(ttl!)) !== null) hops += 1;
    expect(hops).toBe(DEFAULT_TTL - 1);
  });
});

describe("message ids", () => {
  it("advances, and wraps rather than overflowing two bytes", () => {
    const next = messageIds(0xfffe);
    expect(next()).toBe(0xffff);
    expect(next()).toBe(0);
  });
});

describe("transferMs", () => {
  it("makes a cue instant and a script obviously not", () => {
    // The numbers that decide what may travel this way at all.
    expect(transferMs(200)).toBeLessThan(100);
    expect(transferMs(180_000)).toBeGreaterThan(20_000);
  });

  it("scales with the rate the link actually manages", () => {
    expect(transferMs(50_000, 2_700)).toBeGreaterThan(transferMs(50_000, 100_000));
  });
});

describe("encoding", () => {
  it("round-trips a message", () => {
    const msg = { type: "cue", index: 3, label: "4" };
    expect(fromBytes(toBytes(msg))).toEqual(msg);
  });

  it("returns null on rubbish rather than throwing into the receive path", () => {
    expect(fromBytes(new Uint8Array([0x7b, 0x7b, 0x7b]))).toBeNull();
  });
});
