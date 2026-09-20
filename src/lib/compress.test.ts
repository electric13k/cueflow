import { describe, expect, it } from "vitest";
import { contentPath, extensionOf, MAX_UPLOAD, packForUpload, size, typeFor } from "./compress";

/** An AudioBuffer as far as the pack path is concerned: channel count, rate, and the samples. */
const fakeBuffer = (channels: Float32Array[], sampleRate = 44100) => ({
  numberOfChannels: channels.length,
  sampleRate,
  length: channels[0].length,
  getChannelData: (c: number) => channels[c],
}) as unknown as AudioBuffer;

const tone = (length: number) => Float32Array.from({ length }, (_, i) => 0.4 * Math.sin(i / 19) + 0.1 * Math.sin(i / 3.7));

describe("naming the content type", () => {
  it("believes the browser when it says something", () => {
    expect(typeFor("cue.mp3", "audio/mpeg")).toBe("audio/mpeg");
    expect(typeFor("weird.bin", "audio/ogg")).toBe("audio/ogg");
  });

  it("reads the extension when the browser says nothing", () => {
    expect(typeFor("deck.pptx", "")).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(typeFor("edit.flac", "")).toBe("audio/flac");
    expect(typeFor("slide.png", "")).toBe("image/png");
  });

  // The old fallback was `audio/mpeg` for anything unnamed, so a .pptx went to storage labelled as
  // an MP3 and the bucket either refused it or served it wrongly.
  it("never guesses audio for something it cannot identify", () => {
    expect(typeFor("mystery.qqq", "")).not.toMatch(/^audio\//);
    expect(typeFor("mystery", "application/octet-stream")).not.toMatch(/^audio\//);
  });

  it("treats octet-stream as the browser having no opinion", () => {
    expect(typeFor("deck.pptx", "application/octet-stream")).toMatch(/presentationml/);
  });

  it("finds the extension case-insensitively", () => {
    expect(extensionOf("SHOUT.WAV")).toBe("wav");
    expect(extensionOf("no-dot")).toBe("");
  });
});

describe("naming by content", () => {
  it("gives the same path to the same bytes and a different one to different bytes", async () => {
    const one = await contentPath(new Blob(["thunder"]), "thunder.wav");
    const same = await contentPath(new Blob(["thunder"]), "renamed-by-someone-else.wav");
    const other = await contentPath(new Blob(["thunder "]), "thunder.wav");
    expect(one).toBe(same);
    expect(one).not.toBe(other);
  });

  it("stays under the prefix the storage policy allows, and keeps the extension", async () => {
    const path = await contentPath(new Blob(["x"]), "cue.flac");
    expect(path).toMatch(/^public\/[0-9a-f]{64}\.flac$/);
  });

  it("copes with a name that has no extension", async () => {
    expect(await contentPath(new Blob(["x"]), "untitled")).toMatch(/^public\/[0-9a-f]{64}$/);
  });
});

describe("what gets repacked", () => {
  it("leaves an already-compressed file exactly as it came", async () => {
    const mp3 = new File([new Uint8Array(2048)], "sting.mp3", { type: "audio/mpeg" });
    const packed = await packForUpload(mp3, async () => fakeBuffer([tone(9000)]));
    expect(packed.how).toBe("kept");
    expect(packed.file).toBe(mp3);
    expect(packed.to).toBe(packed.from);
  });

  it("leaves a WAV alone when there is nothing to decode it with", async () => {
    const wav = new File([new Uint8Array(2048)], "door.wav", { type: "audio/wav" });
    expect((await packForUpload(wav)).how).toBe("kept");
  });

  it("turns a WAV into a smaller FLAC that keeps its name", async () => {
    const samples = tone(60000);
    const wav = new File([new Uint8Array(44 + samples.length * 2)], "door slam.wav", { type: "audio/wav" });
    const packed = await packForUpload(wav, async () => fakeBuffer([samples]));
    expect(packed.how).toBe("flac");
    expect(packed.file.name).toBe("door slam.flac");
    expect(packed.file.type).toBe("audio/flac");
    expect(packed.to).toBeLessThan(packed.from);
  });

  // An import must not fail because an optimisation did. The original going up unchanged is always
  // an acceptable answer; refusing the file is not.
  it("keeps the original when decoding throws", async () => {
    const wav = new File([new Uint8Array(4096)], "corrupt.wav", { type: "audio/wav" });
    const packed = await packForUpload(wav, async () => { throw new Error("not audio this browser knows"); });
    expect(packed.how).toBe("kept");
    expect(packed.file).toBe(wav);
  });

  it("keeps the original when the repack would not be smaller", async () => {
    // Two samples: a FLAC header alone is larger than the PCM, so the encoder refuses.
    const wav = new File([new Uint8Array(48)], "tick.wav", { type: "audio/wav" });
    const packed = await packForUpload(wav, async () => fakeBuffer([Float32Array.from([0.1, -0.2])]));
    expect(packed.how).toBe("kept");
  });
});

describe("saying how big something is", () => {
  it("reads as a sentence rather than a byte count", () => {
    expect(size(512)).toBe("512 B");
    expect(size(4096)).toBe("4 KB");
    expect(size(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(size(MAX_UPLOAD)).toBe("50.0 MB");
  });
});
