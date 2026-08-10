import { GRID_CLASS, GRID_STYLE, cellStyle, type RecentKind } from "./recents";

/**
 * A skeleton rather than a spinner, everywhere a list or a grid is on its way. A spinner says
 * "wait"; a skeleton says how much is coming and where on the screen it will land, so the page
 * stops moving under the cursor the moment the real thing arrives.
 *
 * `motion-reduce` stops the shimmer for anyone who has asked the OS for less movement: a pulsing
 * block is decoration, and decoration is exactly what that setting is about.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`block animate-pulse rounded-md bg-foreground/10 motion-reduce:animate-none ${className}`} />;
}

/** One tile placeholder, on the same span as the real tile of that kind, so nothing shifts. */
function TileSkeleton({ kind }: { kind: RecentKind }) {
  return (
    <li style={cellStyle(kind)} className="rounded-lg bg-surface/25 p-3 ring-1 ring-inset ring-border/40">
      <Skeleton className="h-2.5 w-12" />
      <Skeleton className="mt-2.5 h-3.5 w-4/5" />
      <Skeleton className="mt-2 h-2.5 w-1/2" />
    </li>
  );
}

/**
 * The Recents grid before it has anything in it. The shapes are the real shapes: a sequence twice
 * an audio tile, a deck twice as wide again, so the skeleton is the layout rather than a picture
 * of one.
 */
export function RecentsSkeleton({ groups = 2 }: { groups?: number }) {
  const kinds: RecentKind[][] = [
    ["sequence", "audio", "audio", "deck", "audio"],
    ["audio", "image", "audio", "sequence", "audio", "audio"],
    ["show", "audio", "image"],
  ];
  return (
    <div role="status" aria-label="Loading your recent work" className="space-y-8">
      {kinds.slice(0, groups).map((row, g) => (
        <section key={g}>
          <Skeleton className="h-3 w-28" />
          <Skeleton className="mt-2 h-2.5 w-44" />
          <ul className={`mt-3 ${GRID_CLASS}`} style={GRID_STYLE}>
            {row.map((kind, i) => <TileSkeleton key={i} kind={kind} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * The plain-list version, for a panel that loads rows rather than tiles. Same idea, one dimension.
 */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ul role="status" aria-label="Loading" className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 rounded-lg bg-surface/25 px-3 py-2.5 ring-1 ring-inset ring-border/40">
          <Skeleton className="h-4 w-4 shrink-0 rounded-full" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-2.5 w-12 shrink-0" />
        </li>
      ))}
    </ul>
  );
}
