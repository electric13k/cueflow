import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AudioEngine, masterLevel } from "./audio";
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

/** A media element with nothing on it but the three things the engine touches. */
const element = () => ({ playbackRate: 1, volume: 1, play: vi.fn(() => Promise.resolve()) } as unknown as HTMLAudioElement);

describe("AudioEngine playback lifecycle", () => {
  beforeEach(() => {
    FakeAudioContext.constructed = 0;
    FakeAudioContext.events = [];
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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

    expect(FakeAudioContext.constructed).toBeLessThanOrEqual(1);
  });

  test("shares one realtime context across engines rather than one per voice", async () => {
    for (let i = 0; i < 4; i++) await new AudioEngine().play(element(), defaultEffects());
    // Browsers cap concurrent contexts around six, so a context per voice left the last cues mute.
    expect(FakeAudioContext.constructed).toBeLessThanOrEqual(1);
  });

  test("a graph that failed to build is tried again, instead of latching for the session", async () => {
    const audio = element();
    let first = true;
    const source = vi.spyOn(FakeAudioContext.prototype, "createMediaElementSource").mockImplementation(() => {
      if (first) { first = false; throw new Error("this element cannot be graphed yet"); }
      return node();
    });

    const engine = new AudioEngine();
    await engine.play(audio, defaultEffects());
    await engine.play(audio, defaultEffects());

    expect(source).toHaveBeenCalledTimes(2);
  });

  test("plays at the ceiling it is given, not at the volume the cue asked for", () => {
    const audio = element();
    new AudioEngine().apply(audio, { ...defaultEffects(), volume: 1 }, .4);
    expect(audio.volume).toBe(.4);
  });

  test("a fade-in ramps to the ceiling, so the master fader is not undone by it", async () => {
    const audio = element();
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (fn: () => void) => { frames.push(fn); return 0; });
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);

    await new AudioEngine().play(audio, { ...defaultEffects(), volume: 1, fadeIn: 1 }, .4);
    clock = 5_000;
    while (frames.length) frames.shift()!();

    expect(audio.volume).toBe(.4);
  });

  test("a second play supersedes the fade the first one left running", async () => {
    const audio = element();
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (fn: () => void) => { frames.push(fn); return 0; });
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const engine = new AudioEngine();

    await engine.play(audio, { ...defaultEffects(), volume: 1, fadeIn: 1 }, 1);
    const orphaned = frames.splice(0);
    await engine.play(audio, { ...defaultEffects(), volume: 1, fadeIn: 0 }, .25);
    clock = 5_000;
    orphaned.forEach(frame => frame());

    expect(audio.volume).toBe(.25);
  });
});

describe("masterLevel", () => {
  test("an absent key is wide open, not shut", () => {
    // `Number(null)` is 0, and 0 passes every range check: a fresh install played every cue silent.
    expect(masterLevel(null)).toBe(1);
    expect(masterLevel("")).toBe(1);
    expect(masterLevel("  ")).toBe(1);
  });

  test("a stored level is kept, and nonsense is not", () => {
    expect(masterLevel("0")).toBe(0);
    expect(masterLevel("0.4")).toBe(.4);
    expect(masterLevel("1")).toBe(1);
    expect(masterLevel("2")).toBe(1);
    expect(masterLevel("-1")).toBe(1);
    expect(masterLevel("loud")).toBe(1);
  });
});
