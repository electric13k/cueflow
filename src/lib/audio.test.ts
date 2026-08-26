import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AudioEngine } from "./audio";
import { defaultEffects } from "../types";

const node = () => ({
  connect: vi.fn(function (this: unknown) { return this; }),
  gain: { setTargetAtTime: vi.fn() },
  frequency: { value: 0 },
  Q: { value: 0 },
  curve: null,
  buffer: null,
});

class FakeAudioContext {
  static constructed = 0;
  static events: string[] = [];
  state = "suspended";
  currentTime = 0;
  destination = node();
  constructor() { FakeAudioContext.constructed += 1; }
  createMediaElementSource() { return node(); }
  createGain() { return node(); }
  createWaveShaper() { return node(); }
  createConvolver() { return node(); }
  createBiquadFilter() { return node(); }
  createBuffer() { return { getChannelData: () => new Float32Array(1) }; }
  resume() { FakeAudioContext.events.push("resume"); return Promise.resolve(); }
}

describe("AudioEngine playback lifecycle", () => {
  beforeEach(() => {
    FakeAudioContext.constructed = 0;
    FakeAudioContext.events = [];
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });
  afterEach(() => vi.unstubAllGlobals());

  test("does not construct Web Audio while applying effects before a gesture", () => {
    const engine = new AudioEngine();
    const audio = { playbackRate: 1, volume: 1, play: vi.fn(() => Promise.resolve()) } as unknown as HTMLAudioElement;

    engine.apply(audio, defaultEffects());

    expect(FakeAudioContext.constructed).toBe(0);
    expect(audio.playbackRate).toBe(1);
    expect(audio.volume).toBe(.9);
  });

  test("starts media before a suspended context resume resolves", async () => {
    const engine = new AudioEngine();
    const events: string[] = [];
    let resolveResume!: () => void;
    const audio = {
      playbackRate: 1,
      volume: 1,
      play: vi.fn(() => { events.push("play"); return Promise.resolve(); }),
    } as unknown as HTMLAudioElement;
    vi.spyOn(FakeAudioContext.prototype, "resume").mockImplementation(() => {
      events.push("resume");
      return new Promise<void>(resolve => { resolveResume = resolve; });
    });

    const pending = engine.play(audio, defaultEffects());
    await Promise.resolve();
    expect(events).toEqual(["resume", "play"]);
    resolveResume();
    await pending;

    expect(FakeAudioContext.constructed).toBe(1);
  });
});
