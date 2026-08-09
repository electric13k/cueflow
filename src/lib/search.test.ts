import { describe, expect, it } from "vitest";
import { comparator, filterBy, importance, matcher, search, type Facets } from "./search";

const DAY = 86_400_000;
const now = Date.parse("2026-08-09T12:00:00Z");
const ago = (days: number) => new Date(now - days * DAY).toISOString();

type Thing = { name: string; kind: string; at: string; uses?: number; pinned?: boolean };
const facet = (t: Thing): Facets => ({ text: [t.name], kind: t.kind, updatedAt: t.at, uses: t.uses, pinned: t.pinned });
const thing = (name: string, extra: Partial<Thing> = {}): Thing =>
  ({ name, kind: "audio", at: ago(1), ...extra });
const names = (list: Thing[]) => list.map(t => t.name);

describe("matcher", () => {
  const items = [thing("Act 2 — reprise"), thing("Café door slam"), thing("Thunder")];

  it("wants every word, in any order", () => {
    expect(names(items.filter(matcher("2 act", facet)))).toEqual(["Act 2 — reprise"]);
    expect(items.filter(matcher("act thunder", facet))).toEqual([]);
  });

  it("ignores case and accents, so nobody has to type the é", () => {
    expect(names(items.filter(matcher("CAFE", facet)))).toEqual(["Café door slam"]);
  });

  it("matches everything when nothing has been typed", () => {
    expect(items.filter(matcher("   ", facet))).toHaveLength(3);
  });
});

describe("filterBy", () => {
  const items = [thing("a"), thing("b", { kind: "image" }), thing("c", { pinned: true, at: ago(40) })];

  it("narrows by kind, and an empty kind list means every kind", () => {
    expect(names(items.filter(filterBy({ kind: ["image"] }, facet)))).toEqual(["b"]);
    expect(items.filter(filterBy({ kind: [] }, facet))).toHaveLength(3);
  });

  it("narrows by pin state in both directions", () => {
    expect(names(items.filter(filterBy({ pinned: true }, facet)))).toEqual(["c"]);
    expect(names(items.filter(filterBy({ pinned: false }, facet)))).toEqual(["a", "b"]);
  });

  it("narrows by age", () => {
    expect(names(items.filter(filterBy({ since: now - 7 * DAY }, facet)))).toEqual(["a", "b"]);
  });
});

describe("importance", () => {
  const score = (f: Partial<Facets>) => importance({ text: [], ...f }, now);

  // The whole point of the ranking: the thing you touched last is often not the thing you are
  // working on.
  it("puts a well-used older item above a fresher one nobody opens", () => {
    expect(score({ updatedAt: ago(3), uses: 20 })).toBeGreaterThan(score({ updatedAt: ago(1), uses: 1 }));
  });

  it("still prefers the fresher of two equally used items", () => {
    expect(score({ updatedAt: ago(1), uses: 5 })).toBeGreaterThan(score({ updatedAt: ago(9), uses: 5 }));
  });

  it("saturates usage, so one runaway item cannot own the list", () => {
    const twenty = score({ updatedAt: ago(1), uses: 20 });
    expect(score({ updatedAt: ago(1), uses: 500 }) - twenty).toBeLessThan(0.01);
  });

  it("a pin outranks anything unpinned, however fresh and however used", () => {
    expect(score({ updatedAt: ago(400), pinned: true })).toBeGreaterThan(score({ updatedAt: ago(0), uses: 1e6 }));
  });

  it("treats a thing with no timestamp as old, not as brand new", () => {
    expect(score({})).toBeLessThan(score({ updatedAt: ago(7) }));
  });
});

describe("search", () => {
  const items = [
    thing("Storm", { at: ago(1), uses: 1 }),
    thing("Storm door", { at: ago(3), uses: 20 }),
    thing("Curtain up", { kind: "image", at: ago(2), uses: 30, pinned: true }),
  ];

  it("filters, then searches, then ranks, in one call", () => {
    expect(names(search(items, facet, { query: "storm", now })))
      .toEqual(["Storm door", "Storm"]);
    expect(names(search(items, facet, { filter: { kind: ["image"] }, now }))).toEqual(["Curtain up"]);
  });

  it("importance is the default order and puts the pin first", () => {
    expect(names(search(items, facet, { now }))[0]).toBe("Curtain up");
  });

  it("offers the plain orders too", () => {
    expect(names(search(items, facet, { sort: "recent", now }))).toEqual(["Storm", "Curtain up", "Storm door"]);
    expect(names(search(items, facet, { sort: "oldest", now }))).toEqual(["Storm door", "Curtain up", "Storm"]);
    expect(names(search(items, facet, { sort: "name", now }))).toEqual(["Curtain up", "Storm", "Storm door"]);
  });

  it("leaves the caller's array alone", () => {
    const before = names(items);
    search(items, facet, { sort: "name", now });
    expect(names(items)).toEqual(before);
  });

  it("comparator is the same order a page can sort with itself", () => {
    expect(names([...items].sort(comparator("name", facet, now)))).toEqual(["Curtain up", "Storm", "Storm door"]);
  });
});
