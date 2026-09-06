import { describe, expect, it, vi } from "vitest";
import type { ShowMsg } from "./shows";
import {
  encodedSize, openShowLink, PayloadTooLarge, seenGate,
  type Capability, type Envelope, type Link, type Transport,
} from "./transport";

const cue = (index: number): ShowMsg => ({ type: "cue", index, label: String(index + 1) });

const capability = (over: Partial<Capability> = {}): Capability =>
  ({ maxPayload: 100_000, latency: "low", reach: "local", ...over });

/**
 * A transport that does nothing but record. `inbound` lets a test deliver an envelope as if it had
 * come off the wire, and `drop` simulates the link dying, which is the case that matters most.
 */
function fake(id: string, opts: { available?: boolean; failOpen?: boolean; cap?: Capability } = {}) {
  const sent: Envelope[] = [];
  let deliver: ((envelope: Envelope) => void) | null = null;
  let dropped: (() => void) | null = null;
  let closes = 0;
  const cap = opts.cap ?? capability();

  const transport: Transport = {
    id,
    label: id,
    capability: cap,
    available: async () => opts.available ?? true,
    open: async (_show, onEnvelope, onDropped) => {
      if (opts.failOpen) throw new Error(`${id} refused`);
      deliver = onEnvelope;
      dropped = onDropped;
      const link: Link = {
        transport: id,
        capability: cap,
        status: "open",
        send(envelope) {
          const size = encodedSize(envelope);
          if (size > cap.maxPayload) throw new PayloadTooLarge(id, size, cap.maxPayload);
          sent.push(envelope);
        },
        close() { closes += 1; },
      };
      return link;
    },
  };

  return {
    transport,
    sent,
    get closes() { return closes; },
    inbound: (envelope: Envelope) => deliver?.(envelope),
    drop: () => dropped?.(),
  };
}

const from = (over: Partial<Envelope> = {}): Envelope =>
  ({ v: 1, show: "show-1", from: "other-device", seq: 1, msg: cue(0), ...over });

describe("seenGate", () => {
  it("passes a message once and refuses the same one again", () => {
    const fresh = seenGate();
    expect(fresh("a", 1)).toBe(true);
    expect(fresh("a", 1)).toBe(false);
  });

  it("keeps senders apart, so two devices can both be on sequence 1", () => {
    const fresh = seenGate();
    expect(fresh("a", 1)).toBe(true);
    expect(fresh("b", 1)).toBe(true);
  });

  it("forgets the oldest rather than growing without limit", () => {
    const fresh = seenGate(2);
    fresh("a", 1); fresh("a", 2); fresh("a", 3);
    // "a:1" was evicted to make room, so it reads as new again. Bounded memory costs this.
    expect(fresh("a", 1)).toBe(true);
    expect(fresh("a", 3)).toBe(false);
  });
});

describe("openShowLink", () => {
  it("takes the first available transport, in the order given", async () => {
    const lan = fake("lan");
    const cloud = fake("cloud");
    const changed = vi.fn();
    await openShowLink("show-1", [lan.transport, cloud.transport], () => {}, changed);
    expect(changed).toHaveBeenCalledWith("lan");
  });

  it("skips one that reports itself unavailable", async () => {
    const lan = fake("lan", { available: false });
    const cloud = fake("cloud");
    const router = await openShowLink("show-1", [lan.transport, cloud.transport], () => {});
    expect(router.transport).toBe("cloud");
  });

  it("skips one that throws while opening rather than giving up entirely", async () => {
    const lan = fake("lan", { failOpen: true });
    const cloud = fake("cloud");
    const router = await openShowLink("show-1", [lan.transport, cloud.transport], () => {});
    expect(router.transport).toBe("cloud");
  });

  it("reports no transport when nothing is available, and refuses to send", async () => {
    const lan = fake("lan", { available: false });
    const router = await openShowLink("show-1", [lan.transport], () => {});
    expect(router.transport).toBeNull();
    expect(() => router.send(cue(0))).toThrow(/No link to the room/);
  });

  it("falls back to the next transport when a live link drops", async () => {
    const lan = fake("lan");
    const cloud = fake("cloud");
    const changed = vi.fn();
    const router = await openShowLink("show-1", [lan.transport, cloud.transport], () => {}, changed);
    expect(router.transport).toBe("lan");

    // The wifi goes down mid-show. The room should end up on the cloud, not silent.
    lan.transport.available = async () => false;
    lan.drop();
    await vi.waitFor(() => expect(router.transport).toBe("cloud"));
    expect(changed).toHaveBeenLastCalledWith("cloud");
  });

  it("hands a received message up, unwrapped", async () => {
    const lan = fake("lan");
    const heard: { msg: ShowMsg; from: string }[] = [];
    await openShowLink("show-1", [lan.transport], (msg, sender) => heard.push({ msg, from: sender }));
    lan.inbound(from({ msg: cue(3) }));
    expect(heard).toEqual([{ msg: cue(3), from: "other-device" }]);
  });

  it("acts on a duplicate once, however many links deliver it", async () => {
    const lan = fake("lan");
    const heard: ShowMsg[] = [];
    await openShowLink("show-1", [lan.transport], msg => heard.push(msg));
    lan.inbound(from({ seq: 7 }));
    lan.inbound(from({ seq: 7 }));
    expect(heard).toHaveLength(1);
  });

  it("ignores a message for a different show sharing the wire", async () => {
    const lan = fake("lan");
    const heard: ShowMsg[] = [];
    await openShowLink("show-1", [lan.transport], msg => heard.push(msg));
    lan.inbound(from({ show: "show-2" }));
    expect(heard).toHaveLength(0);
  });

  it("stamps outgoing messages with a rising sequence and this device's id", async () => {
    const lan = fake("lan");
    const router = await openShowLink("show-1", [lan.transport], () => {});
    router.send(cue(0));
    router.send(cue(1));
    expect(lan.sent.map(e => e.seq)).toEqual([1, 2]);
    expect(lan.sent[0].show).toBe("show-1");
    expect(lan.sent[0].from).toBe(lan.sent[1].from);
    expect(lan.sent[0].from).toBeTruthy();
  });

  it("does not act on its own message coming back off the wire", async () => {
    const lan = fake("lan");
    const heard: ShowMsg[] = [];
    const router = await openShowLink("show-1", [lan.transport], msg => heard.push(msg));
    router.send(cue(0));
    // A relaying peer echoes it straight back.
    lan.inbound(lan.sent[0]);
    expect(heard).toHaveLength(0);
  });

  it("closes the underlying link and stops sending", async () => {
    const lan = fake("lan");
    const router = await openShowLink("show-1", [lan.transport], () => {});
    router.close();
    expect(lan.closes).toBe(1);
    expect(() => router.send(cue(0))).toThrow();
  });
});

describe("payload limits", () => {
  it("refuses a message the link cannot carry instead of dropping it silently", async () => {
    // A Bluetooth-shaped link: room for a cue, nowhere near room for a script.
    const ble = fake("ble", { cap: capability({ maxPayload: 180 }) });
    const router = await openShowLink("show-1", [ble.transport], () => {});
    const script = "x".repeat(4000);
    expect(() => router.send({ type: "deck", show: "show-1", sequence: "seq-1", cues: [], index: 0, script })).toThrow(PayloadTooLarge);
  });

  it("still carries an ordinary cue over that same narrow link", async () => {
    const ble = fake("ble", { cap: capability({ maxPayload: 180 }) });
    const router = await openShowLink("show-1", [ble.transport], () => {});
    expect(() => router.send(cue(4))).not.toThrow();
    expect(ble.sent).toHaveLength(1);
  });

  it("names the transport and both sizes, so the operator can see what happened", async () => {
    const ble = fake("ble", { cap: capability({ maxPayload: 180 }) });
    const router = await openShowLink("show-1", [ble.transport], () => {});
    expect(() => router.send({ type: "flash", text: "y".repeat(500), from: "crew", member: "m1" }))
      .toThrow(/ble link carries 180 bytes per message/);
  });
});
