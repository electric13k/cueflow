import { describe, expect, it } from "vitest";
import { DEFAULT_VOICES, VoicePool } from "./audio";

/** Enough of an `HTMLAudioElement` for the pool: it only ever pauses one and reads `paused`. */
function stubElement() {
  const el = { paused: true, pause() { el.paused = true; }, play() { el.paused = false; } };
  return el as unknown as HTMLAudioElement;
}

function pool(size = 3) {
  let clock = 0;
  const made: HTMLAudioElement[] = [];
  const p = new VoicePool(size, () => { const el = stubElement(); made.push(el); return el; }, () => ++clock);
  return { p, made };
}

describe("VoicePool", () => {
  it("gives a different voice to a second sound, so cues overlap", () => {
    const { p } = pool();
    const a = p.claim("kick");
    const b = p.claim("bed");
    expect(a.id).not.toBe(b.id);
    expect(p.all()).toHaveLength(2);
  });

  it("re-uses the voice a track is already on, rather than stacking a copy on itself", () => {
    const { p } = pool();
    const first = p.claim("sting");
    const again = p.claim("sting");
    expect(again).toBe(first);
    expect(p.all()).toHaveLength(1);
  });

  it("does not grow past its size", () => {
    const { p } = pool(3);
    for (const id of ["a", "b", "c", "d", "e"]) p.claim(id);
    expect(p.all()).toHaveLength(3);
  });

  it("steals the voice that has been going longest when everything is busy", () => {
    const { p } = pool(2);
    const oldest = p.claim("first");
    p.claim("second");
    const stolen = p.claim("third");
    expect(stolen).toBe(oldest);
    expect(stolen.trackId).toBe("third");
    expect(p.find("first")).toBeUndefined();
  });

  it("stops the sound on a voice it steals, instead of leaving it running", () => {
    const { p } = pool(1);
    const voice = p.claim("first");
    voice.element.play();
    p.claim("second");
    expect(voice.element.paused).toBe(true);
  });

  it("re-claiming refreshes a voice's age, so an active sound is not the next one stolen", () => {
    const { p } = pool(2);
    const first = p.claim("bed");
    p.claim("music");
    p.claim("bed");                    // touched, so "music" is now the oldest
    const stolen = p.claim("sting");
    expect(stolen).not.toBe(first);
    expect(p.find("bed")).toBe(first);
  });

  it("frees a voice on release", () => {
    const { p } = pool();
    const voice = p.claim("one");
    p.release(voice);
    expect(voice.trackId).toBeNull();
    expect(p.claim("two")).toBe(voice);
  });

  it("stops everything at once", () => {
    const { p } = pool(3);
    for (const id of ["a", "b", "c"]) p.claim(id).element.play();
    p.stopAll();
    expect(p.playing()).toHaveLength(0);
    expect(p.all().every(v => v.trackId === null)).toBe(true);
  });

  it("reports what is sounding, newest first, so the transport acts on the latest cue", () => {
    const { p } = pool(3);
    p.claim("a").element.play();
    p.claim("b").element.play();
    const quiet = p.claim("c");           // claimed but never started
    expect(p.playing().map(v => v.trackId)).toEqual(["b", "a"]);
    expect(p.playing()).not.toContain(quiet);
  });

  it("defaults to enough voices for a busy cue stack", () => {
    expect(DEFAULT_VOICES).toBeGreaterThanOrEqual(4);
  });
});
