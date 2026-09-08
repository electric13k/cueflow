import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { listen, send } from "./bus";
import type { Msg } from "./bus";

/**
 * happy-dom has no BroadcastChannel, so this is a small one that behaves the way the real API does
 * in the respect the app depends on: a message reaches every other open channel on the name and
 * never comes back to the object that posted it.
 *
 * One class for the whole file, because `bus.ts` caches its outgoing channel for the life of the
 * module and swapping the constructor between tests would leave that cached object orphaned.
 */
const live = new Set<Fake>();
class Fake {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;
  constructor(readonly name: string) { live.add(this); }
  postMessage(data: unknown) {
    for (const other of live) if (other !== this && !other.closed) other.onmessage?.({ data });
  }
  close() { this.closed = true; live.delete(this); }
}

beforeAll(() => vi.stubGlobal("BroadcastChannel", Fake));
afterEach(() => vi.clearAllMocks());

describe("send and listen", () => {
  it("carries a message from one window to another", () => {
    const heard: Msg[] = [];
    const stop = listen(msg => heard.push(msg));
    send({ type: "fire", index: 3 });
    stop();
    expect(heard).toEqual([{ type: "fire", index: 3 }]);
  });

  it("reaches every window that is listening, not just the first", () => {
    const a: Msg[] = []; const b: Msg[] = [];
    const stopA = listen(msg => a.push(msg));
    const stopB = listen(msg => b.push(msg));
    send({ type: "hello" });
    stopA(); stopB();
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("stops delivering once the listener is torn down", () => {
    const heard: Msg[] = [];
    listen(msg => heard.push(msg))();
    send({ type: "hello" });
    expect(heard).toEqual([]);
  });

  it("does not echo back to the window that sent it", () => {
    // The Studio both sends and listens. If a message came home the alert handler would fire twice
    // for one cue word, and the reader would reload its own script on every save.
    const heard: Msg[] = [];
    const stop = listen(msg => heard.push(msg));
    send({ type: "script" });
    stop();
    expect(heard).toEqual([{ type: "script" }]);
  });

  it("carries a deck the control panel can render", () => {
    const heard: Msg[] = [];
    const stop = listen(msg => heard.push(msg));
    const deck: Msg = {
      type: "deck", name: "Act one", index: 2, armed: true,
      cues: [{ id: "c1", label: "Thunder", number: "1", kind: "audio" }],
    };
    send(deck);
    stop();
    expect(heard[0]).toEqual(deck);
  });
});

describe("a runtime with no usable BroadcastChannel", () => {
  it("loses the second window rather than the whole Studio", () => {
    // The name can be present without a usable constructor, which is why the guard checks the type
    // rather than the key. Getting this wrong throws on the first send and takes the desk with it.
    vi.stubGlobal("BroadcastChannel", undefined);
    expect(() => send({ type: "hello" })).not.toThrow();
    let stop = () => {};
    expect(() => { stop = listen(() => { throw new Error("nothing should arrive"); }); }).not.toThrow();
    expect(() => stop()).not.toThrow();
    vi.stubGlobal("BroadcastChannel", Fake);
  });
});
