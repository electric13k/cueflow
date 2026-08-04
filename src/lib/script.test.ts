import { describe, expect, it } from "vitest";
import { clean, keywordsOf, markKeywords, type Cue } from "./script";

const cue = (words: string, id = "c1"): Cue => ({ id, words, message: "" });
const marks = (html: string) => [...html.matchAll(/<mark[^>]*>(.*?)<\/mark>/g)].map(m => m[1]);

describe("clean", () => {
  it("keeps formatting tags and drops everything else", () => {
    expect(clean("<p>Enter <strong>LEAR</strong></p>")).toBe("<p>Enter <strong>LEAR</strong></p>");
  });

  it("unwraps a disallowed tag but keeps its text", () => {
    expect(clean("<p>safe<script>evil()</script></p>")).toBe("<p>safeevil()</p>");
  });

  it("strips attributes, including event handlers", () => {
    expect(clean(`<p onclick="evil()" style="color:red">hi</p>`)).toBe("<p>hi</p>");
  });
});

describe("markKeywords", () => {
  it("marks every occurrence in one text node, not just the first", () => {
    const { html, hits } = markKeywords("<p>LX 4 then later LX 4 again</p>", [cue("LX 4")]);
    expect(hits).toBe(2);
    expect(marks(html)).toEqual(["LX 4", "LX 4"]);
  });

  it("matches whatever the script capitalised and keeps the original casing", () => {
    expect(marks(markKeywords("<p>Blackout now</p>", [cue("BLACKOUT")]).html)).toEqual(["Blackout"]);
  });

  it("prefers the longer keyword when two start at the same place", () => {
    expect(marks(markKeywords("<p>call LX 4 here</p>", [cue("LX, LX 4")]).html)).toEqual(["LX 4"]);
  });

  it("tags each hit with the cue it belongs to", () => {
    const { html } = markKeywords("<p>lights then sound</p>", [cue("lights", "a"), cue("sound", "b")]);
    expect([...html.matchAll(/data-cue="(\w+)"/g)].map(m => m[1])).toEqual(["a", "b"]);
  });

  it("leaves the script alone when no cue words are set", () => {
    const html = "<p>nothing to find</p>";
    expect(markKeywords(html, [cue("")])).toEqual({ html, hits: 0 });
  });

  it("cannot be tricked into marking markup", () => {
    // "p" appears in every tag; only the body text may ever be touched.
    expect(marks(markKeywords("<p>a p in prose</p>", [cue("p")]).html)).toEqual(["p"]);
  });
});

describe("keywordsOf", () => {
  it("splits on commas and ignores blanks and case", () => {
    expect(keywordsOf(cue(" Lights , , LX 4 "))).toEqual(["lights", "lx 4"]);
  });
});
