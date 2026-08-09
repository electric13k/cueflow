import { describe, expect, it } from "vitest";
import { clean, findInScript, keywordsOf, markKeywords, shapeParagraph, type Cue } from "./script";

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

// A script reads as a script because of its shape. These are the six properties that carry it,
// and the hostile input that must not ride in beside them.
describe("clean, formatting", () => {
  it("keeps the properties that make a script look like a script", () => {
    const html = `<p style="text-align:center;margin-left:2em;padding-left:1em;text-indent:-1em;font-style:italic;font-weight:700">LEAR</p>`;
    expect(clean(html)).toBe(`<p style="text-align: center; margin-left: 2em; padding-left: 1em; text-indent: -1em; font-style: italic; font-weight: 700">LEAR</p>`);
  });

  it("drops every property that is not on the list, keeping the ones that are", () => {
    expect(clean(`<p style="color:red;background:#fff;position:fixed;text-align:right">x</p>`))
      .toBe(`<p style="text-align: right">x</p>`);
  });

  it("drops an allowed property whose value tries to fetch, run or escape", () => {
    expect(clean(`<p style="margin-left:url(http://evil/x)">a</p>`)).toBe("<p>a</p>");
    expect(clean(`<p style="text-align:expression(alert(1))">b</p>`)).toBe("<p>b</p>");
    expect(clean(`<p style="font-weight:javascript:alert(1)">c</p>`)).toBe("<p>c</p>");
    expect(clean(`<p style="text-indent:\\75rl(x)">d</p>`)).toBe("<p>d</p>");
  });

  it("keeps align only when the value is one of the four it may be", () => {
    expect(clean(`<p align="CENTER">a</p>`)).toBe(`<p align="center">a</p>`);
    expect(clean(`<p align="javascript:alert(1)">b</p>`)).toBe("<p>b</p>");
  });

  it("keeps only the classes the importer itself emits", () => {
    expect(clean(`<p class="script-dialogue somebody-elses">a</p>`)).toBe(`<p class="script-dialogue">a</p>`);
    expect(clean(`<p class="glass">b</p>`)).toBe("<p>b</p>");
  });

  it("survives a second pass unchanged, because it is cleaned again on load", () => {
    const once = clean(`<p style="text-align:center" class="script-character">LEAR</p>`);
    expect(clean(once)).toBe(once);
  });
});

describe("shapeParagraph", () => {
  it("names a centred paragraph so the style map can class it", () => {
    expect(shapeParagraph({ type: "paragraph", alignment: "center" }).styleName).toBe("cue-center");
  });

  it("turns an indent in twips into a level, half an inch at a time", () => {
    expect(shapeParagraph({ type: "paragraph", indent: { start: "720" } }).styleName).toBe("cue-indent-1");
    expect(shapeParagraph({ type: "paragraph", indent: { start: "2880" } }).styleName).toBe("cue-indent-3");
    expect(shapeParagraph({ type: "paragraph", indent: { start: "100" } }).styleName).toBeUndefined();
  });

  it("never overwrites a style that already means something", () => {
    expect(shapeParagraph({ type: "paragraph", styleName: "Heading 1", alignment: "center" }).styleName).toBe("Heading 1");
    expect(shapeParagraph({ type: "paragraph", styleName: "Character", alignment: "center" }).styleName).toBe("Character");
  });
});

describe("findInScript", () => {
  it("numbers every match so the reader can step through them", () => {
    const { html, hits } = findInScript("<p>the door. the window. the door.</p>", "the door");
    expect(hits).toBe(2);
    expect([...html.matchAll(/data-find="(\d+)"/g)].map(m => m[1])).toEqual(["0", "1"]);
  });

  it("ignores case and matches mid-word, unlike a cue word", () => {
    expect(findInScript("<p>Blackout</p>", "ackou").hits).toBe(1);
  });

  it("treats the query as text, not as a pattern", () => {
    expect(findInScript("<p>a.b</p>", "a.b").hits).toBe(1);
    expect(findInScript("<p>axb</p>", "a.b").hits).toBe(0);
  });

  it("leaves the script exactly as it was when nothing is being searched for", () => {
    const html = "<p>nothing</p>";
    expect(findInScript(html, "  ")).toEqual({ html, hits: 0 });
  });

  it("cannot be tricked into matching markup", () => {
    expect(findInScript("<p>a p in prose</p>", "p").hits).toBe(2);
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
