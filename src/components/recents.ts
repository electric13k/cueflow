/**
 * The shape of the Recents screen: what a row of it is, how big each tile is, which category it
 * falls in, and how far back the screen reaches. All of it is plain data and pure functions, so the
 * geometry that the sizes were asked in can be asserted in a test rather than eyeballed in a
 * browser, and so the tile, the skeleton and the page cannot drift into three different grids.
 *
 * Nothing here ranks anything. Ordering is `lib/search`'s importance blend, applied by the page
 * before the entries arrive.
 */
import type { CSSProperties } from "react";
import type { Kind } from "../types";

export type RecentKind = "session" | "sequence" | "audio" | "image" | "video" | "deck" | "show" | "script";

/** One cue as the hover preview shows it: the number the operator calls, and what it fires. */
export type RecentCue = { n: string; label: string; kind: Kind };

/** One tile. Whatever its preview needs is already on it, so hovering renders rather than fetches. */
export type RecentEntry = {
  id: string;
  kind: RecentKind;
  title: string;
  /** The small print: cue count, show key, what an unfinished edit is unfinished in. */
  note: string;
  href: string;
  at?: string | null;
  /** Picture, clip or embedded deck. Absent means this kind has nothing to show on hover. */
  src?: string;
  /** A sequence's cue list, precomputed so the preview is a pure render. */
  cues?: RecentCue[];
};

export type Span = { rows: number; cols: number };

/**
 * Tile sizes, in grid tracks, measured against the audio tile because that is the unit the sizes
 * were asked in: a sequence is twice an audio tile's height, a deck twice its width and two and a
 * half times its height. The row track is therefore half an audio tile, so 2.5x lands on a whole
 * number of tracks instead of between two.
 *
 * Everything else is one audio tile. Only three sizes were specified and inventing a fourth would
 * be inventing a hierarchy nobody asked for.
 */
export const SPAN: Record<RecentKind, Span> = {
  audio: { rows: 2, cols: 1 },
  image: { rows: 2, cols: 1 },
  video: { rows: 2, cols: 1 },
  session: { rows: 2, cols: 1 },
  show: { rows: 2, cols: 1 },
  script: { rows: 2, cols: 1 },
  sequence: { rows: 4, cols: 1 },
  deck: { rows: 5, cols: 2 },
};

/**
 * What a tile spanning `tracks` tracks actually measures. This is why the grid has no gap: a tile
 * spanning n tracks with a gap of g between them is `n*t + (n-1)*g`, and `4t + 3g` is only ever
 * twice `2t + g` when g is zero. The ratios were asked for literally, so the gutters move inside
 * the tile as padding and the tiles themselves sit edge to edge, separated by their own hairline.
 */
export const spanSize = (tracks: number, track: number, gap: number) => tracks * track + (tracks - 1) * gap;

/** Zero, and the comment above is the whole reason. Changing it breaks the asked ratios. */
export const GAP = 0;

/** Half an audio tile. Audio therefore stands 6.5rem, a sequence 13rem, a deck 16.25rem. */
export const ROW_TRACK = "3.25rem";

/**
 * Two columns at the smallest size and never fewer, because a deck spans two of them and a tile
 * wider than its grid is the one way this layout could overlap anything.
 */
export const GRID_CLASS = "grid grid-cols-2 gap-0 sm:grid-cols-4 xl:grid-cols-6";

/** `dense` backfills the holes a 4-track sequence leaves beside a 2-track sound. */
export const GRID_STYLE: CSSProperties = { gridAutoRows: ROW_TRACK, gridAutoFlow: "dense" };

export const cellStyle = (kind: RecentKind): CSSProperties => ({
  gridColumn: `span ${SPAN[kind].cols}`,
  gridRow: `span ${SPAN[kind].rows}`,
});

/**
 * The categories, in the order they are worth resuming. An unfinished edit is the strongest signal
 * on the screen: it is work you stopped in the middle of. A script is the weakest, because there is
 * one of it and it is never lost.
 */
export const CATEGORIES: { id: string; title: string; blurb: string; kinds: RecentKind[] }[] = [
  { id: "resume", title: "Unfinished edits", blurb: "Stopped mid edit, one click back in", kinds: ["session"] },
  { id: "sequences", title: "Sequences", blurb: "Cue lists you have been building", kinds: ["sequence"] },
  { id: "library", title: "Library", blurb: "Sound, pictures, clips and decks", kinds: ["audio", "image", "video", "deck"] },
  { id: "shows", title: "Shows", blurb: "Rooms with a key", kinds: ["show"] },
  { id: "scripts", title: "Script", blurb: "What the room is reading from", kinds: ["script"] },
];

export type RecentGroup = { id: string; title: string; blurb: string; items: RecentEntry[] };

/**
 * Split a ranked list into the categories above, keeping the order it arrived in inside each one.
 * Empty categories are dropped rather than shown empty: a heading over nothing is furniture.
 */
export function groupRecents(entries: RecentEntry[]): RecentGroup[] {
  return CATEGORIES
    .map(({ id, title, blurb, kinds }) => ({ id, title, blurb, items: entries.filter(e => kinds.includes(e.kind)) }))
    .filter(g => g.items.length > 0);
}

export const MONTH_DAYS = 30;
export const MONTH_MS = MONTH_DAYS * 86_400_000;

/**
 * Recents reaches back one month and no further. Anything older is still in the library, the
 * sequences tab and the shows grid; it is just not what "recent" means.
 *
 * A missing or unparseable timestamp is unknown rather than old, so it stays. A show created and
 * never run, and the project's one script, have no date to be old by, and dropping them would empty
 * a whole category on no evidence at all. The ranking already handles them fairly: `importance`
 * treats an undated item as thirty days back, so it sorts last rather than first.
 */
export function withinMonth(at: string | number | null | undefined, now = Date.now()): boolean {
  if (at == null) return true;
  const t = typeof at === "number" ? at : Date.parse(at);
  if (!Number.isFinite(t)) return true;
  return now - t <= MONTH_MS;
}
