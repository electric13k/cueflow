import { describe, expect, it } from "vitest";
import { addSlide, indexOf, moveSlide, newDeck, patchSlide, removeSlide, setMaster, slideName } from "./deck";

/** The document model: what the editor renders and what the export walks. No canvas involved. */
describe("deck document", () => {
  it("starts as one slide over one master", () => {
    const d = newDeck();
    expect(d.slides).toHaveLength(1);
    expect(d.master.align).toBe("left");
  });

  it("inserts after the slide you are on, not at the end", () => {
    const d = addSlide(addSlide(newDeck()), 0, "title");
    expect(d.slides).toHaveLength(3);
    expect(d.slides[1].layout).toBe("title");
    expect(new Set(d.slides.map(s => s.id)).size).toBe(3);
  });

  it("reorders without losing or duplicating a slide", () => {
    const d = addSlide(addSlide(newDeck()));
    const ids = d.slides.map(s => s.id);
    const m = moveSlide(d, 2, 0);
    expect(m.slides.map(s => s.id)).toEqual([ids[2], ids[0], ids[1]]);
    expect(d.slides.map(s => s.id)).toEqual(ids); // the original document is untouched
  });

  it("keeps the last slide, because a deck with none exports nothing", () => {
    const one = newDeck();
    expect(removeSlide(one, one.slides[0].id)).toBe(one);
    const two = addSlide(one);
    expect(removeSlide(two, two.slides[0].id).slides.map(s => s.id)).toEqual([two.slides[1].id]);
  });

  it("patches one slide and leaves its neighbours alone", () => {
    const d = addSlide(newDeck());
    const p = patchSlide(d, d.slides[1].id, { title: "Act two", image: "blob:x" });
    expect(p.slides[1].title).toBe("Act two");
    expect(p.slides[0]).toBe(d.slides[0]);
    expect(indexOf(p, d.slides[1].id)).toBe(1);
  });

  it("theme is a master, so one change restyles every slide", () => {
    const d = setMaster(addSlide(newDeck()), { bg: "#000000", bullets: false });
    expect(d.master.bg).toBe("#000000");
    expect(d.master.bullets).toBe(false);
    expect(d.slides.some(s => "bg" in s)).toBe(false); // nothing overrides it per slide
  });

  it("names an untitled slide by its position", () => {
    const base = newDeck();
    const d = patchSlide(base, base.slides[0].id, { title: "  " });
    expect(slideName(d.slides[0], 0)).toBe("Slide 1");
    expect(slideName({ ...d.slides[0], title: " Cue sheet " }, 3)).toBe("Cue sheet");
  });
});
