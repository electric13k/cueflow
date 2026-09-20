import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Envelope } from "../transport";
import { meshPossible, meshStatus, nativeTransport, type MeshStatus } from "./native";

/**
 * The Rust side, faked.
 *
 * Hoisted because `vi.mock` is lifted above the imports, and the transport reaches the module under
 * test through `await import(...)` rather than a static import, so the mock has to be in place
 * before the first `open()` resolves it. `handlers` is how a test emits an event the way Tauri
 * would; `unlistened` is how it proves `close()` actually detached them, which is the bug the BLE
 * transport had for months: every transport switch left another live listener parsing envelopes
 * into a link nobody was watching.
 */
const rust = vi.hoisted(() => {
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  const unlistened: string[] = [];
  let status: MeshStatus = { planes: [{ id: "wifi", peers: 1, detail: "1 peer" }], peers: 1 };

  const invoke = vi.fn(async (cmd: string, _args?: Record<string, unknown>): Promise<unknown> => {
    if (cmd === "mesh_start" || cmd === "mesh_status") return status;
    return undefined;
  });

  const listen = vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    handlers.set(name, handler);
    return () => { unlistened.push(name); };
  });

  return {
    handlers,
    unlistened,
    invoke,
    listen,
    setStatus(next: MeshStatus) { status = next; },
    emit(name: string, payload: unknown) { handlers.get(name)?.({ payload }); },
    reset() {
      handlers.clear();
      unlistened.length = 0;
      status = { planes: [{ id: "wifi", peers: 1, detail: "1 peer" }], peers: 1 };
      invoke.mockClear();
      listen.mockClear();
    },
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: rust.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: rust.listen }));

const shell = (on: boolean) => {
  if (on) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
};

const envelope = (show: string, msg = "Go"): Envelope =>
  ({ v: 1, show, from: "them", seq: 7, msg: { type: "cue", index: 0, label: msg } });

/** `open` with throwaway callbacks, so a test only has to name the one it cares about. */
const open = (
  show = "s1",
  onEnvelope: (e: Envelope) => void = () => {},
  onDropped: () => void = () => {},
) => nativeTransport.open(show, onEnvelope, onDropped);

beforeEach(() => { rust.reset(); shell(true); });
afterEach(() => { shell(false); vi.restoreAllMocks(); });

describe("nativeTransport", () => {
  it("is unavailable in a browser, without asking the Rust side anything", async () => {
    shell(false);
    expect(meshPossible()).toBe(false);
    expect(await nativeTransport.available()).toBe(false);
    expect(await meshStatus()).toBeNull();
    // The point of the cheap probe: the website pays no IPC call to learn it has no mesh.
    expect(rust.invoke).not.toHaveBeenCalled();
  });

  it("opens a link and starts the mesh for this show and device", async () => {
    const link = await open("s1");
    expect(await nativeTransport.available()).toBe(true);
    expect(link.transport).toBe("mesh");
    expect(link.status).toBe("open");
    expect(link.capability).toEqual({ maxPayload: 256 * 1024, latency: "low", reach: "local" });

    const [cmd, args] = rust.invoke.mock.calls[0];
    expect(cmd).toBe("mesh_start");
    expect(args).toMatchObject({ show: "s1" });
    // A stable id, not a fresh one per link: it is what makes a message relayed back to us a
    // duplicate rather than a second cue.
    expect(typeof (args as { device: string }).device).toBe("string");
    expect(rust.handlers.has("mesh://envelope")).toBe(true);
    expect(rust.handlers.has("mesh://status")).toBe(true);
  });

  it("parses an inbound envelope and hands it up", async () => {
    const heard: Envelope[] = [];
    await open("s1", e => heard.push(e));

    rust.emit("mesh://envelope", JSON.stringify(envelope("s1")));
    expect(heard).toHaveLength(1);
    expect(heard[0].msg).toEqual({ type: "cue", index: 0, label: "Go" });

    // Another room's traffic on a shared radio is not ours to act on.
    rust.emit("mesh://envelope", JSON.stringify(envelope("s2")));
    expect(heard).toHaveLength(1);
  });

  it("drops a payload that will not parse instead of throwing into the listener", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const heard: Envelope[] = [];
    await open("s1", e => heard.push(e));

    // Tauri calls this handler from the webview's own dispatch, where a throw has nowhere to go
    // and would leave every later envelope delivered to a channel nobody is watching.
    expect(() => rust.emit("mesh://envelope", "{not json")).not.toThrow();
    expect(() => rust.emit("mesh://envelope", { not: "a string" })).not.toThrow();
    expect(heard).toHaveLength(0);
    expect(warn).toHaveBeenCalled();

    // Still listening afterwards, which is the whole reason it is caught.
    rust.emit("mesh://envelope", JSON.stringify(envelope("s1")));
    expect(heard).toHaveLength(1);
  });

  it("sends the envelope as the JSON the Rust side will frame", async () => {
    const link = await open("s1");
    const outgoing = envelope("s1");
    link.send(outgoing);

    const send = rust.invoke.mock.calls.find(([cmd]) => cmd === "mesh_send");
    expect(send?.[1]).toEqual({ body: JSON.stringify(outgoing) });
  });

  it("refuses a message larger than the mesh carries, rather than losing it quietly", async () => {
    const link = await open("s1");
    const huge: Envelope = { v: 1, show: "s1", from: "me", seq: 1, msg: { type: "cue", index: 0, label: "x".repeat(300_000) } };

    expect(() => link.send(huge)).toThrowError(/256|carries/);
    expect(rust.invoke.mock.calls.some(([cmd]) => cmd === "mesh_send")).toBe(false);
  });

  it("unlistens both events and stops the mesh on close", async () => {
    const link = await open("s1");
    link.close();

    expect(link.status).toBe("closed");
    expect(rust.unlistened).toEqual(["mesh://envelope", "mesh://status"]);
    expect(rust.invoke).toHaveBeenCalledWith("mesh_stop");
  });

  it("reports a drop when the last peer leaves, so the router re-probes", async () => {
    rust.setStatus({ planes: [{ id: "wifi", peers: 2, detail: "2 peers" }], peers: 2 });
    const dropped = vi.fn();
    const link = await open("s1", () => {}, dropped);

    rust.emit("mesh://status", { planes: [{ id: "wifi", peers: 1, detail: "1 peer" }], peers: 1 });
    expect(dropped).not.toHaveBeenCalled();

    rust.emit("mesh://status", { planes: [{ id: "wifi", peers: 0, detail: "alone" }], peers: 0 });
    expect(dropped).toHaveBeenCalledTimes(1);

    // Once, not on every status event that follows, and never after the link is closed.
    rust.emit("mesh://status", { planes: [], peers: 0 });
    link.close();
    rust.emit("mesh://status", { planes: [], peers: 0 });
    expect(dropped).toHaveBeenCalledTimes(1);
  });

  it("stays quiet while the room is merely empty, because nothing was lost", async () => {
    rust.setStatus({ planes: [{ id: "wifi", peers: 0, detail: "alone" }], peers: 0 });
    const dropped = vi.fn();
    await open("s1", () => {}, dropped);

    // The host opens the link before anyone joins. Treating that as a dead link would make it
    // fall through to the cloud every time, which is the opposite of what a venue needs.
    rust.emit("mesh://status", { planes: [{ id: "wifi", peers: 0, detail: "alone" }], peers: 0 });
    expect(dropped).not.toHaveBeenCalled();
  });

  it("answers meshStatus from the Rust side inside the app", async () => {
    rust.setStatus({ planes: [{ id: "ble", peers: 3, detail: "3 peers" }], peers: 3 });
    expect(await meshStatus()).toEqual({ planes: [{ id: "ble", peers: 3, detail: "3 peers" }], peers: 3 });
    expect(rust.invoke).toHaveBeenCalledWith("mesh_status");
  });
});
