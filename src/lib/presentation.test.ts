import { describe, expect, it } from "vitest";
import { kindFromFile } from "./media";
import { slideLabels, slidesFromPptx } from "./presentation";

function indexedPptx(names: string[]) {
  const enc = new TextEncoder();
  const nameBytes = names.map(name => enc.encode(name));
  const size = names.reduce((total, bytes) => total + 46 + bytes.length, 0) + 22;
  const bytes = new Uint8Array(size);
  const data = new DataView(bytes.buffer);
  let at = 0;
  names.forEach((_, index) => {
    const name = nameBytes[index];
    data.setUint32(at, 0x02014b50, true);
    data.setUint16(at + 28, name.length, true);
    bytes.set(name, at + 46);
    at += 46 + name.length;
  });
  data.setUint32(at, 0x06054b50, true);
  data.setUint16(at + 10, names.length, true);
  data.setUint32(at + 16, 0, true);
  return new File([bytes], "show.pptx", { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}

describe("presentation metadata", () => {
  it("creates a stable one-based slide label list", () => {
    expect(slideLabels(3)).toEqual([
      { index: 0, label: "Slide 1" },
      { index: 1, label: "Slide 2" },
      { index: 2, label: "Slide 3" },
    ]);
  });

  it("reads slide entries from a PPTX central directory in numeric order", async () => {
    const slides = await slidesFromPptx(indexedPptx([
      "ppt/slides/slide10.xml", "ppt/slides/slide2.xml", "ppt/slideMasters/slideMaster1.xml", "ppt/slides/slide1.xml",
    ]));
    expect(slides).toEqual([
      { index: 0, label: "Slide 1" },
      { index: 1, label: "Slide 2" },
      { index: 2, label: "Slide 3" },
    ]);
  });

  it("classifies PPTX uploads as presentation tracks", () => {
    expect(kindFromFile(new File([], "cue-deck.pptx", { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }))).toBe("embed");
  });
});
