/**
 * Getting a show message across Bluetooth.
 *
 * Two problems that do not exist on any other wire, both of them consequences of the same thing:
 * a BLE link carries a couple of hundred bytes at a time, over a range measured in metres.
 *
 * **Frames.** A GATT write carries `MTU - 3` bytes. The common negotiated MTU is 247, so 244 bytes,
 * and phones that never negotiate are stuck at 20. A cue fits; a deck does not. So a message is cut
 * into numbered frames and put back together at the other end, and a message that never completes
 * is dropped rather than held for ever.
 *
 * **Hops.** Bluetooth reaches across a room, not across a building, and a phone will hold only a
 * handful of links at once -- around seven on Android, fewer on some hardware. In a theatre the
 * person on followspot at the back of the circle is not in range of the desk. So a device passes on
 * what it hears, and `ttl` is what stops that going round for ever.
 *
 * This is not the SIG's Bluetooth Mesh profile. That is a provisioned network built for lighting
 * and sensors, it is not reachable from Web Bluetooth or from any of the Rust peripheral crates,
 * and it would mean commissioning every phone in the building before a rehearsal. This is a small
 * flood over ordinary GATT connections, which is the thing that can actually be built.
 */

/** ATT payload at the usual negotiated MTU of 247: three bytes of that are the ATT header. */
export const BLE_FRAME = 244;

/**
 * How far a message travels before it is dropped.
 *
 * Four hops covers a venue -- desk to the wings to the circle to the back of house -- without a
 * message being able to circulate indefinitely if two devices ever relay to each other.
 */
export const DEFAULT_TTL = 4;

/** `magic | version | msgId(2) | index(2) | total(2) | ttl` */
export const FRAME_HEADER = 9;
const MAGIC = 0xc0;
const VERSION = 1;

export type FramePayload = { msgId: number; ttl: number; body: Uint8Array };

const view = (frame: Uint8Array) => new DataView(frame.buffer, frame.byteOffset, frame.byteLength);

/**
 * One message, cut into frames small enough to write.
 *
 * `msgId` identifies the message across every frame and every hop, so a device that hears the same
 * message twice -- once directly and once relayed -- can recognise it before reassembling it again.
 */
export function chunk(body: Uint8Array, msgId: number, ttl = DEFAULT_TTL, frameSize = BLE_FRAME): Uint8Array[] {
  const room = frameSize - FRAME_HEADER;
  if (room <= 0) throw new Error(`A ${frameSize} byte frame has no room for a header.`);
  const total = Math.max(1, Math.ceil(body.length / room));
  if (total > 0xffff) throw new Error("That message needs more frames than one message may have.");
  const frames: Uint8Array[] = [];
  for (let index = 0; index < total; index++) {
    const slice = body.subarray(index * room, (index + 1) * room);
    const frame = new Uint8Array(FRAME_HEADER + slice.length);
    const head = view(frame);
    frame[0] = MAGIC;
    frame[1] = VERSION;
    head.setUint16(2, msgId & 0xffff);
    head.setUint16(4, index);
    head.setUint16(6, total);
    frame[8] = ttl;
    frame.set(slice, FRAME_HEADER);
    frames.push(frame);
  }
  return frames;
}

export type FrameHead = { msgId: number; index: number; total: number; ttl: number; body: Uint8Array };

/** Reads a frame, or null when it is not one of ours -- another app on the same characteristic. */
export function readFrame(frame: Uint8Array): FrameHead | null {
  if (frame.length < FRAME_HEADER || frame[0] !== MAGIC || frame[1] !== VERSION) return null;
  const head = view(frame);
  const total = head.getUint16(6);
  const index = head.getUint16(4);
  if (total === 0 || index >= total) return null;
  return { msgId: head.getUint16(2), index, total, ttl: frame[8], body: frame.subarray(FRAME_HEADER) };
}

/**
 * Puts frames back into messages.
 *
 * Bounded in both directions. `limit` caps how many part-finished messages are held at once, because
 * a device out of range mid-message would otherwise leave a fragment in memory for the rest of the
 * night; `expireAfter` drops one whose remaining frames never arrived. Both matter more here than
 * on a reliable wire: BLE loses a device the moment somebody walks through a doorway.
 */
export function createReassembler({ limit = 32, expireAfter = 20_000, now = () => Date.now() } = {}) {
  type Partial = { frames: (Uint8Array | undefined)[]; have: number; total: number; ttl: number; at: number };
  const pending = new Map<number, Partial>();

  const expire = () => {
    const cutoff = now() - expireAfter;
    for (const [id, held] of pending) if (held.at < cutoff) pending.delete(id);
  };

  return {
    get pending() { return pending.size; },

    /** Returns the whole message once its last frame lands, and null until then. */
    accept(frame: Uint8Array): FramePayload | null {
      const head = readFrame(frame);
      if (!head) return null;
      expire();

      if (head.total === 1) return { msgId: head.msgId, ttl: head.ttl, body: head.body.slice() };

      let held = pending.get(head.msgId);
      if (held && held.total !== head.total) {
        // Same id, different length: an id has wrapped round onto a message still in flight. The
        // older one is the one to lose, since the newer frames are the ones still arriving.
        pending.delete(head.msgId);
        held = undefined;
      }
      if (!held) {
        held = { frames: new Array(head.total), have: 0, total: head.total, ttl: head.ttl, at: now() };
        pending.set(head.msgId, held);
        // Oldest out first, so a stream of half-heard messages cannot grow without limit.
        while (pending.size > limit) { const oldest = pending.keys().next().value; if (oldest === undefined) break; pending.delete(oldest); }
      }
      if (held.frames[head.index]) return null;   // heard this frame already, over another link
      held.frames[head.index] = head.body.slice();
      held.have += 1;
      held.at = now();
      // The lowest ttl any copy arrived with is the honest one: it is how far this really travelled.
      held.ttl = Math.min(held.ttl, head.ttl);
      if (held.have < held.total) return null;

      pending.delete(head.msgId);
      const size = held.frames.reduce((n, part) => n + (part?.length ?? 0), 0);
      const body = new Uint8Array(size);
      let at = 0;
      for (const part of held.frames) { if (part) { body.set(part, at); at += part.length; } }
      return { msgId: head.msgId, ttl: held.ttl, body };
    },

    forget() { pending.clear(); },
  };
}

/**
 * What to put on the wire when passing a message on, or null to stop here.
 *
 * One less than it arrived with, and nothing at zero. Without this a room with two devices that can
 * both hear each other relays the same cue back and forth until the batteries die.
 */
export const relayTtl = (ttl: number) => (ttl > 1 ? ttl - 1 : null);

/** Message ids are two bytes and wrap. They only have to be unique among what is still in flight. */
export function messageIds(start = Math.floor(Math.random() * 0x10000)) {
  let next = start & 0xffff;
  return () => { next = (next + 1) & 0xffff; return next; };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const toBytes = (value: unknown) => encoder.encode(JSON.stringify(value));
export const fromBytes = <T>(bytes: Uint8Array): T | null => {
  try { return JSON.parse(decoder.decode(bytes)) as T; } catch { return null; }
};

/**
 * How long a message of this size takes, in milliseconds, at a given rate.
 *
 * Worth being able to compute rather than guess, because the answers decide what may travel this
 * way at all. Measured BLE throughput on phones runs from about 2.7 kB/s at the pessimistic end to
 * roughly 100 kB/s where Data Length Extension and a short connection interval both land. A cue is
 * a couple of hundred bytes and arrives instantly either way. A 180 KB script does not: at the slow
 * end that is over a minute, which is why `bleTransport` refuses it rather than appearing to hang.
 */
export const transferMs = (bytes: number, bytesPerSecond = 8_000, frameSize = BLE_FRAME) => {
  const frames = Math.ceil(bytes / (frameSize - FRAME_HEADER));
  return Math.round(((frames * frameSize) / bytesPerSecond) * 1000);
};
