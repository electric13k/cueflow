import { afterEach, describe, expect, it, vi } from "vitest";
import { controllersPossible, listenToGamepads, listenToMidi, padOrder } from "./controllers";

const nav = navigator as unknown as Record<string, unknown>;
const original = { midi: nav.requestMIDIAccess, pads: nav.getGamepads };

afterEach(() => {
  nav.requestMIDIAccess = original.midi;
  nav.getGamepads = original.pads;
  vi.restoreAllMocks();
});

/** A pad, reduced to the one thing the poll reads. */
const pad = (pressed: boolean[]) => ({ index: 0, buttons: pressed.map(p => ({ pressed: p })) });

describe("controllers", () => {
  it("is inert rather than throwing when the browser has neither API", () => {
    nav.requestMIDIAccess = undefined;
    nav.getGamepads = undefined;
    const fire = vi.fn();
    expect(() => listenToMidi(fire)()).not.toThrow();
    expect(() => listenToGamepads(fire)()).not.toThrow();
    expect(fire).not.toHaveBeenCalled();
    expect(controllersPossible()).toBe(false);
  });

  it("survives a browser that has the method and refuses the permission", async () => {
    nav.requestMIDIAccess = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    const stop = listenToMidi(vi.fn());
    await Promise.resolve();
    expect(() => stop()).not.toThrow();
  });

  describe("midi", () => {
    /** Hands back the message handler the module installed, so a note can be played at it. */
    const connect = async () => {
      const input: { onmidimessage: ((e: { data: Uint8Array }) => void) | null } = { onmidimessage: null };
      const access = { inputs: new Map([["a", input]]), onstatechange: null as unknown };
      nav.requestMIDIAccess = vi.fn().mockResolvedValue(access);
      const fire = vi.fn();
      const stop = listenToMidi(fire);
      await Promise.resolve();
      await Promise.resolve();
      return { input, fire, stop, access };
    };

    it("fires the first action for the lowest note the device sends", async () => {
      const { input, fire } = await connect();
      input.onmidimessage!({ data: new Uint8Array([0x90, 60, 100]) });
      expect(fire).toHaveBeenCalledWith(padOrder()[0]);
    });

    it("maps notes by position from that device's own bottom note", async () => {
      // A 25-key controller starting at 48 and a 61-key one starting at 36 must both step a cue
      // from their lowest pad, without anybody looking up a note table first.
      const { input, fire } = await connect();
      input.onmidimessage!({ data: new Uint8Array([0x90, 48, 100]) });
      input.onmidimessage!({ data: new Uint8Array([0x90, 49, 100]) });
      expect(fire.mock.calls.map(c => c[0])).toEqual([padOrder()[0], padOrder()[1]]);
    });

    it("ignores note-on at velocity 0, which is how most hardware says note-off", async () => {
      // Without this a pad fires its cue again on release, and firing a cue twice is worse than
      // not firing it.
      const { input, fire } = await connect();
      input.onmidimessage!({ data: new Uint8Array([0x90, 60, 0]) });
      expect(fire).not.toHaveBeenCalled();
    });

    it("ignores anything that is not note-on", async () => {
      const { input, fire } = await connect();
      input.onmidimessage!({ data: new Uint8Array([0x80, 60, 100]) });  // note-off
      input.onmidimessage!({ data: new Uint8Array([0xb0, 60, 100]) });  // control change
      expect(fire).not.toHaveBeenCalled();
    });

    it("ignores a note past the end of the map rather than firing something arbitrary", async () => {
      const { input, fire } = await connect();
      input.onmidimessage!({ data: new Uint8Array([0x90, 60, 100]) });
      fire.mockClear();
      input.onmidimessage!({ data: new Uint8Array([0x90, 60 + padOrder().length, 100]) });
      expect(fire).not.toHaveBeenCalled();
    });

    it("stops listening when it is torn down", async () => {
      const { input, fire, stop } = await connect();
      stop();
      expect(input.onmidimessage).toBeNull();
      expect(fire).not.toHaveBeenCalled();
    });
  });

  describe("gamepads", () => {
    /** Runs the rAF loop by hand for a fixed number of frames. */
    const frames = (n: number) => {
      let queued: FrameRequestCallback | null = null;
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { queued = cb; return 1; });
      vi.stubGlobal("cancelAnimationFrame", () => {});
      return {
        tick: () => { for (let i = 0; i < n; i++) { const cb = queued; queued = null; cb?.(0); } },
      };
    };

    it("fires once on the press, not on every frame it is held", () => {
      // A held button firing per frame steps through an entire cue stack before anybody notices.
      nav.getGamepads = () => [pad([true])];
      const fire = vi.fn();
      const loop = frames(5);
      const stop = listenToGamepads(fire);
      loop.tick();
      stop();
      expect(fire).toHaveBeenCalledTimes(1);
      expect(fire).toHaveBeenCalledWith(padOrder()[0]);
    });

    it("fires again after the button is released and pressed once more", () => {
      let pressed = true;
      nav.getGamepads = () => [pad([pressed])];
      const fire = vi.fn();
      const loop = frames(1);
      const stop = listenToGamepads(fire);
      loop.tick();
      pressed = false; loop.tick();
      pressed = true; loop.tick();
      stop();
      expect(fire).toHaveBeenCalledTimes(2);
    });

    it("does not keep spinning a frame loop when nothing is plugged in", () => {
      nav.getGamepads = () => [];
      const fire = vi.fn();
      let scheduled = 0;
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { scheduled++; if (scheduled < 3) cb(0); return scheduled; });
      vi.stubGlobal("cancelAnimationFrame", () => {});
      const stop = listenToGamepads(fire);
      stop();
      // One frame ran, found no pad, and did not queue another.
      expect(scheduled).toBeLessThanOrEqual(2);
      expect(fire).not.toHaveBeenCalled();
    });
  });
});
