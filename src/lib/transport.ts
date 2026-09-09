import type { ShowMsg } from "./shows";

/**
 * How a show reaches the other devices in the room.
 *
 * There is exactly one thing a running show needs from the network: get a small message to every
 * other device, now. Until now that was hard-wired to a Supabase Realtime channel, which means the
 * show stops working the moment the venue's internet does -- and venues are exactly where the
 * internet does not work.
 *
 * So the wire is a choice, not a constant. A link is a link whether it runs over the cloud, over the
 * house wifi, or over Bluetooth between two phones, and the show layer above should not know which
 * one it got. What it does need to know is what that link can physically carry, because the answers
 * differ by orders of magnitude, and pretending otherwise is how you get a cue that silently never
 * arrives.
 */

/**
 * What a link can carry, and at what cost.
 *
 * `maxPayload` is the honest one. BLE GATT negotiates an MTU in the low hundreds of bytes and moves
 * single-digit-to-tens of KB per second in practice, so a cue message fits comfortably and a deck
 * carrying a 180,000 character script does not -- not slowly, not at all within a useful time. A
 * sender that hands a link more than it can take gets told, rather than having the message vanish.
 */
export type Capability = {
  /** Largest single message this link will accept, in bytes of encoded JSON. */
  maxPayload: number;
  /** Rough delivery cost. Used to choose between two links that are both up. */
  latency: "low" | "medium" | "high";
  /** `local` reaches only devices in the room. `internet` reaches anyone holding the show id. */
  reach: "local" | "internet";
};

/**
 * Every message on the wire, whatever the wire.
 *
 * `from` and `seq` exist for one reason: once a message can arrive over more than one link, or be
 * relayed by a peer, the same message can arrive twice. A device that fires a cue twice because the
 * wifi and the Bluetooth link both delivered it is worse than one that misses it. Transports carry
 * envelopes; the router unwraps them and hands plain messages up.
 */
export type Envelope = { v: 1; show: string; from: string; seq: number; msg: ShowMsg };

export type LinkStatus = "open" | "closed";

export interface Link {
  readonly transport: string;
  readonly capability: Capability;
  readonly status: LinkStatus;
  /** Throws if the message is larger than the link can carry. Never fails silently. */
  send(envelope: Envelope): void;
  close(): void;
}

export interface Transport {
  readonly id: string;
  readonly label: string;
  readonly capability: Capability;
  /** Cheap probe. False means "not usable right now", not "not supported on this platform". */
  available(): Promise<boolean>;
  /** `onDropped` lets a transport report that its link died, so the router can find another. */
  open(show: string, onEnvelope: (envelope: Envelope) => void, onDropped: () => void): Promise<Link>;
}

const DEVICE_KEY = "cueflow:device";
const SEQ_KEY = "cueflow:seq";

/** Stable per-device id, so a message relayed back to us is recognised as one already seen. */
export function deviceId(): string {
  try {
    const held = localStorage.getItem(DEVICE_KEY);
    if (held) return held;
    const made = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, made);
    return made;
  } catch {
    // Private mode, or storage disabled. A per-session id still de-duplicates within this run.
    return crypto.randomUUID();
  }
}

/** How many sequence numbers one run claims at a time. */
const SEQ_BLOCK = 10_000;

/**
 * The next run of sequence numbers this device may use, taken out of storage before it is used.
 *
 * `from` outlives the tab, so a counter that began again at 0 handed peers numbers their `seenGate`
 * had already seen: a reloaded host's deck and every cue behind it were discarded as duplicates,
 * leaving the room on a stale deck with no error at either end. Claimed in blocks rather than
 * written on every send, because a live show must not touch the disk once per cue.
 */
export function reserveSequence(block = SEQ_BLOCK): { first: number; last: number } {
  try {
    const held = Number(localStorage.getItem(SEQ_KEY));
    const first = (Number.isFinite(held) && held > 0 ? held : 0) + 1;
    localStorage.setItem(SEQ_KEY, String(first + block));
    return { first, last: first + block };
  } catch {
    // Private mode, where `deviceId()` is a fresh id every run too, so nothing of ours can collide.
    return { first: 1, last: Number.MAX_SAFE_INTEGER };
  }
}

export const encodedSize = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

/** Thrown rather than swallowed: a cue that does not fit has to be visible to the operator. */
export class PayloadTooLarge extends Error {
  constructor(readonly transport: string, readonly size: number, readonly limit: number) {
    super(`This ${transport} link carries ${limit} bytes per message; that one is ${size}.`);
    this.name = "PayloadTooLarge";
  }
}

/**
 * Remembers which messages have already been handled, so one that arrives over two links at once is
 * acted on once. Bounded, because a long show is a lot of cues and this must not grow without limit
 * on a phone.
 */
export function seenGate(limit = 512) {
  const seen = new Set<string>();
  const order: string[] = [];
  return (from: string, seq: number) => {
    const key = `${from}:${seq}`;
    if (seen.has(key)) return false;
    seen.add(key);
    order.push(key);
    if (order.length > limit) { const gone = order.shift(); if (gone) seen.delete(gone); }
    return true;
  };
}

export type Router = {
  /** Which transport is carrying the show right now, or null while there is nothing. */
  readonly transport: string | null;
  readonly capability: Capability | null;
  send(msg: ShowMsg): void;
  close(): void;
};

/**
 * Picks a link and keeps one up.
 *
 * Order is preference, not alphabetical: the first transport that reports itself available wins, so
 * callers express what they want by ordering the array. A link that drops is replaced by re-probing
 * from the top, which is what makes "the wifi died mid-show" survivable -- the room falls back to
 * Bluetooth and the operator keeps calling cues.
 */
export async function openShowLink(
  show: string,
  transports: Transport[],
  onMessage: (msg: ShowMsg, from: string) => void,
  onTransportChange?: (id: string | null) => void,
): Promise<Router> {
  const me = deviceId();
  const fresh = seenGate();
  let link: Link | null = null;
  let closed = false;
  let block = reserveSequence();
  let seq = block.first - 1;
  const nextSeq = () => {
    if (seq >= block.last) { block = reserveSequence(); seq = block.first - 1; }
    return ++seq;
  };

  const receive = (envelope: Envelope) => {
    if (envelope.show !== show || envelope.from === me) return;
    if (!fresh(envelope.from, envelope.seq)) return;
    onMessage(envelope.msg, envelope.from);
  };

  const connect = async (): Promise<void> => {
    if (closed) return;
    for (const transport of transports) {
      if (!(await transport.available().catch(() => false))) continue;
      try {
        const opened = await transport.open(show, receive, () => { if (!closed && link?.transport === transport.id) void reconnect(); });
        if (closed) { opened.close(); return; }
        link = opened;
        onTransportChange?.(transport.id);
        return;
      } catch {
        // Try the next one. A transport that throws on open is simply not usable today.
      }
    }
    link = null;
    onTransportChange?.(null);
  };

  const reconnect = async () => {
    // Closed, not merely dropped: a channel left registered keeps auto-rejoining and keeps its
    // handler bound, so five wifi blips leave six of them parsing every envelope that arrives.
    const dead = link;
    link = null;
    dead?.close();
    onTransportChange?.(null);
    await connect();
  };

  await connect();

  return {
    get transport() { return link?.transport ?? null; },
    get capability() { return link?.capability ?? null; },
    send(msg) {
      const open = link;
      if (!open) throw new Error("No link to the room, so nothing was sent.");
      open.send({ v: 1, show, from: me, seq: nextSeq(), msg });
    },
    close() {
      closed = true;
      link?.close();
      link = null;
    },
  };
}
