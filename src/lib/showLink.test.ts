import { describe, expect, it } from "vitest";
import type { ShowMsg } from "./shows";
import { backoffFor, createShowLink, QUEUE_LIMIT } from "./showLink";
import type { Capability, Router, Transport } from "./transport";

const cue = (index: number): ShowMsg => ({ type: "cue", index, label: String(index + 1) });
const here: ShowMsg = { type: "here", who: "Sam", role: "Sound", member: "m1" };
const capability: Capability = { maxPayload: 100_000, latency: "low", reach: "local" };

/**
 * Stands in for `openShowLink`. `settle` decides whether that attempt produced a live router, so a
 * test can make the first attempt fail and the second succeed -- which is the case that matters,
 * because it is what a venue's wifi coming back up looks like.
 */
function fakeOpener(script: (attempt: number) => "up" | "down" | "throw") {
  const sent: ShowMsg[] = [];
  let attempts = 0;
  let live = false;
  let announce: ((id: string | null) => void) | null = null;

  const opener = async (
    _show: string,
    _transports: Transport[],
    _onMessage: (msg: ShowMsg, from: string) => void,
    onTransportChange?: (id: string | null) => void,
  ): Promise<Router> => {
    const outcome = script(attempts++);
    if (outcome === "throw") throw new Error("nothing available");
    live = outcome === "up";
    announce = onTransportChange ?? null;
    onTransportChange?.(live ? "fake" : null);
    return {
      get transport() { return live ? "fake" : null; },
      get capability() { return live ? capability : null; },
      send(msg) { if (!live) throw new Error("No link to the room, so nothing was sent."); sent.push(msg); },
      close() { live = false; },
    };
  };

  return {
    opener,
    sent,
    get attempts() { return attempts; },
    /** The wire comes back without a fresh `openShowLink`, the way the router's own failover does. */
    revive: () => { live = true; announce?.("fake"); },
  };
}

/** Runs every timer the link scheduled, in order, without waiting out a real backoff. */
function manualClock() {
  const pending: { at: number; fn: () => void }[] = [];
  let now = 0;
  const delay = (fn: () => void, ms: number) => {
    const item = { at: now + ms, fn };
    pending.push(item);
    return () => { const at = pending.indexOf(item); if (at >= 0) pending.splice(at, 1); };
  };
  const tick = async () => {
    const due = pending.splice(0, pending.length).sort((a, b) => a.at - b.at);
    for (const item of due) { now = item.at; item.fn(); await Promise.resolve(); }
    await Promise.resolve();
  };
  return { delay, tick, get scheduled() { return pending.length; } };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe("backoffFor", () => {
  it("grows, then stops growing", () => {
    expect(backoffFor(0)).toBe(1_000);
    expect(backoffFor(3)).toBe(8_000);
    expect(backoffFor(40)).toBe(15_000);
  });
});

describe("createShowLink", () => {
  it("greets the room as soon as it connects, without the caller asking", async () => {
    const wire = fakeOpener(() => "up");
    createShowLink({ show: "s1", transports: [], onMessage: () => {}, hello: () => here, open: wire.opener });
    await settle();
    expect(wire.sent).toEqual([here]);
  });

  it("holds a message sent before the link is up, then sends it", async () => {
    const wire = fakeOpener(() => "up");
    const link = createShowLink({ show: "s1", transports: [], onMessage: () => {}, open: wire.opener });
    // This is the exact sequence that used to strand a crew device: send, then connect.
    link.send(cue(0));
    expect(wire.sent).toHaveLength(0);
    expect(link.queued).toBe(1);
    await settle();
    expect(wire.sent).toEqual([cue(0)]);
    expect(link.queued).toBe(0);
  });

  it("sends the greeting before the queued messages, so the host has context first", async () => {
    const wire = fakeOpener(() => "up");
    const link = createShowLink({ show: "s1", transports: [], onMessage: () => {}, hello: () => here, open: wire.opener });
    link.send(cue(0));
    await settle();
    expect(wire.sent).toEqual([here, cue(0)]);
  });

  it("drops the oldest rather than growing without limit while the link is down", async () => {
    const wire = fakeOpener(() => "down");
    const clock = manualClock();
    const link = createShowLink({ show: "s1", transports: [], onMessage: () => {}, open: wire.opener, delay: clock.delay });
    await settle();
    for (let i = 0; i < QUEUE_LIMIT + 10; i++) link.send(cue(i));
    expect(link.queued).toBe(QUEUE_LIMIT);
  });

  it("greets again on a reconnect, because the deck it holds may be stale", async () => {
    const wire = fakeOpener(() => "up");
    createShowLink({ show: "s1", transports: [], onMessage: () => {}, hello: () => here, open: wire.opener });
    await settle();
    wire.revive();
    await settle();
    expect(wire.sent).toEqual([here, here]);
  });

  it("keeps retrying when no transport is available, instead of giving up", async () => {
    const wire = fakeOpener(attempt => (attempt < 2 ? "down" : "up"));
    const clock = manualClock();
    const link = createShowLink({ show: "s1", transports: [], onMessage: () => {}, hello: () => here, open: wire.opener, delay: clock.delay });
    await settle();
    expect(link.transport).toBeNull();
    await clock.tick();
    await settle();
    await clock.tick();
    await settle();
    expect(wire.attempts).toBe(3);
    expect(link.transport).toBe("fake");
    expect(wire.sent).toEqual([here]);
  });

  it("retries when every transport refuses to open at all", async () => {
    const wire = fakeOpener(attempt => (attempt === 0 ? "throw" : "up"));
    const clock = manualClock();
    const link = createShowLink({ show: "s1", transports: [], onMessage: () => {}, open: wire.opener, delay: clock.delay });
    await settle();
    expect(link.transport).toBeNull();
    await clock.tick();
    await settle();
    expect(link.transport).toBe("fake");
  });

  it("delivers what was queued during an outage once the wire returns", async () => {
    const wire = fakeOpener(attempt => (attempt === 0 ? "down" : "up"));
    const clock = manualClock();
    const link = createShowLink({ show: "s1", transports: [], onMessage: () => {}, open: wire.opener, delay: clock.delay });
    await settle();
    link.send(cue(7));
    await clock.tick();
    await settle();
    expect(wire.sent).toEqual([cue(7)]);
  });

  it("passes received messages straight through", async () => {
    const heard: ShowMsg[] = [];
    const deliver: { to: ((msg: ShowMsg, from: string) => void) | null } = { to: null };
    const opener = async (_s: string, _t: Transport[], onMessage: (m: ShowMsg, f: string) => void, onChange?: (id: string | null) => void): Promise<Router> => {
      deliver.to = onMessage;
      onChange?.("fake");
      return { transport: "fake", capability, send: () => {}, close: () => {} };
    };
    createShowLink({ show: "s1", transports: [], onMessage: msg => heard.push(msg), open: opener });
    await settle();
    deliver.to?.(cue(2), "other");
    expect(heard).toEqual([cue(2)]);
  });

  it("stops sending and stops retrying once closed", async () => {
    const wire = fakeOpener(() => "down");
    const clock = manualClock();
    const link = createShowLink({ show: "s1", transports: [], onMessage: () => {}, open: wire.opener, delay: clock.delay });
    await settle();
    link.close();
    link.send(cue(0));
    await clock.tick();
    await settle();
    expect(link.queued).toBe(0);
    expect(wire.sent).toHaveLength(0);
    // One attempt at construction; nothing after close.
    expect(wire.attempts).toBe(1);
  });

  it("reports which transport is carrying the show", async () => {
    const wire = fakeOpener(() => "up");
    const changes: (string | null)[] = [];
    const link = createShowLink({ show: "s1", transports: [], onMessage: () => {}, open: wire.opener, onTransport: id => changes.push(id) });
    await settle();
    expect(link.transport).toBe("fake");
    expect(changes).toContain("fake");
  });
});
