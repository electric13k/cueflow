/**
 * Search, sort and filter for the four places that have a search box: library, sequences, shows and
 * scripts. One module, because four hand-rolled filters drift into four different ideas of what
 * "matches" means, and the Workspace has to rank all four kinds against each other in one list.
 *
 * Nothing here touches Supabase or React. Give it an array and a `facet` that says what each item
 * is, get an array back.
 */

/** What any searchable thing has to be able to say about itself. Only `text` is really required. */
export type Facets = {
  /** Everything the query is matched against: title, label, filename, tags. Nulls are skipped. */
  text: (string | null | undefined)[];
  /** "audio", "image", "sequence", "show", "script" ... whatever the filter chips offer. */
  kind?: string;
  /** ISO string or epoch ms. `updatedAt` wins over `createdAt` when both are present. */
  updatedAt?: string | number | null;
  createdAt?: string | number | null;
  /** How many times it has been opened or fired. Absent counts as zero. */
  uses?: number;
  pinned?: boolean;
};
export type Facet<T> = (item: T) => Facets;

/** Case and accent insensitive, so "cafe" finds "Café" and nobody has to know why it did not. */
export const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const time = (v: string | number | null | undefined) => {
  if (v == null) return 0;
  const t = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(t) ? t : 0;
};
const stamp = (f: Facets) => Math.max(time(f.updatedAt), time(f.createdAt));
const haystack = (f: Facets) => norm(f.text.filter(Boolean).join(" "));

/**
 * Every word in the query has to appear somewhere in the item, in any order. Substring rather than
 * prefix: cue names are full of numbers and punctuation, and "act 2" should find "Act 2, reprise".
 * An empty query matches everything, so a search box that has not been typed in hides nothing.
 */
const words = (query: string) => norm(query).split(/\s+/).filter(Boolean);
const hit = (f: Facets, terms: string[]) => {
  if (!terms.length) return true;
  const hay = haystack(f);
  return terms.every(word => hay.includes(word));
};

export function matcher<T>(query: string, facet: Facet<T>): (item: T) => boolean {
  const terms = words(query);
  if (!terms.length) return () => true;
  return item => hit(facet(item), terms);
}

export type Filter = {
  /** Empty or absent means every kind. */
  kind?: string[];
  pinned?: boolean;
  /** Epoch ms; keeps only what changed at or after it. */
  since?: number;
};

const keep = (f: Facets, filter: Filter) => {
  if (filter.kind?.length && !filter.kind.includes(f.kind ?? "")) return false;
  if (filter.pinned != null && Boolean(f.pinned) !== filter.pinned) return false;
  if (filter.since != null && stamp(f) < filter.since) return false;
  return true;
};

export function filterBy<T>(filter: Filter, facet: Facet<T>): (item: T) => boolean {
  return item => keep(facet(item), filter);
}

/** Half-life of the recency term, in days. Three days is about one rehearsal cycle. */
export const HALF_LIFE_DAYS = 3;
/** A pin is not a tie-break, it is an instruction, so it outranks the whole 0..1 blend below. */
export const PIN_BONUS = 2;

/**
 * Importance, not recency. The Workspace mixes sequences, editor sessions, library items, shows and
 * scripts into one list, and the thing you touched last is often not the thing you are working on:
 * a sound imported once and never fired outranks nothing, and a sequence you have run twenty times
 * this week is still the subject of the show three days later.
 *
 * So the score blends three signals:
 *   recency  0.55  exponential decay, half-life three days. Fresh matters, but it halves fast.
 *   usage    0.45  log-scaled and saturating at twenty opens, so a single run counts for a lot more
 *                  than the twenty-first does and one runaway item cannot own the whole list.
 *   pinned  +2.00  flat, above the 0..1 ceiling of the other two, because a pin is explicit.
 * Nothing with a timestamp is ever scored zero, and an item with no timestamp at all is treated as
 * thirty days old rather than as brand new.
 */
export function importance(f: Facets, now = Date.now()): number {
  const at = stamp(f);
  const days = at ? Math.max(0, (now - at) / 86_400_000) : 30;
  const recency = Math.pow(0.5, days / HALF_LIFE_DAYS);
  const usage = Math.min(1, Math.log1p(Math.max(0, f.uses ?? 0)) / Math.log1p(20));
  return (f.pinned ? PIN_BONUS : 0) + 0.55 * recency + 0.45 * usage;
}

export type SortKey = "importance" | "recent" | "oldest" | "name" | "kind";

/** The comparator set. Every one of them is total, so the sort is stable across browsers. */
export const comparators: Record<SortKey, (a: Facets, b: Facets, now: number) => number> = {
  importance: (a, b, now) => importance(b, now) - importance(a, now),
  recent: (a, b) => stamp(b) - stamp(a),
  oldest: (a, b) => stamp(a) - stamp(b),
  name: (a, b) => haystack(a).localeCompare(haystack(b)),
  kind: (a, b) => (a.kind ?? "").localeCompare(b.kind ?? "") || haystack(a).localeCompare(haystack(b)),
};

export function comparator<T>(key: SortKey, facet: Facet<T>, now = Date.now()) {
  const cmp = comparators[key];
  return (a: T, b: T) => cmp(facet(a), facet(b), now);
}

export type Options = { query?: string; filter?: Filter; sort?: SortKey; now?: number };

/**
 * The one call a page makes. Facets are computed once per item rather than once per comparison,
 * which is the difference between a library of two thousand sounds sorting instantly and not.
 */
export function search<T>(items: T[], facet: Facet<T>, options: Options = {}): T[] {
  const { query = "", filter = {}, sort = "importance", now = Date.now() } = options;
  const terms = words(query);
  const cmp = comparators[sort];
  return items
    .map(item => ({ item, f: facet(item) }))
    .filter(({ f }) => keep(f, filter) && hit(f, terms))
    .sort((a, b) => cmp(a.f, b.f, now))
    .map(({ item }) => item);
}
