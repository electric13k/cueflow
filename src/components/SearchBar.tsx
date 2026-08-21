import { Search } from "lucide-react";
import { Input, Select } from "../ui";
import type { SortKey } from "../lib/search";

/**
 * One search box, one sort and one row of filter chips, for the places that have all three. It only
 * collects the query, the sort key and the kinds: the matching itself is `lib/search`, so the
 * library and the sequences cannot drift into two ideas of what a match is.
 */
const SORTS: { id: SortKey; label: string }[] = [
  { id: "importance", label: "Most useful" },
  { id: "recent", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "name", label: "Name" },
  { id: "kind", label: "Kind" },
];

export default function SearchBar({ query, setQuery, sort, setSort, kinds = [], kind, setKind, placeholder = "Search" }: {
  query: string; setQuery: (v: string) => void;
  sort: SortKey; setSort: (v: SortKey) => void;
  /** The chips on offer. Empty means this list has only one kind of thing in it, so no chips. */
  kinds?: string[];
  kind: string[]; setKind: (v: string[]) => void;
  placeholder?: string;
}) {
  const toggle = (k: string) => setKind(kind.includes(k) ? kind.filter(x => x !== k) : [...kind, k]);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="relative min-w-48 flex-1">
        <Search size={14} className="pointer-events-none absolute bottom-3 left-3 text-muted" aria-hidden />
        {/* The compat Input takes no startContent, so the icon is positioned over it. */}
        <Input className="[&_input]:pl-8" value={query} onValueChange={setQuery} placeholder={placeholder} />
      </div>
      <Select aria-label="Sort by" value={sort} onChange={v => setSort(v as SortKey)}
        options={SORTS.map(s => ({ value: s.id, label: s.label }))} size="sm" className="min-w-36" />
      {kinds.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {kinds.map(k => (
            <button key={k} type="button" onClick={() => toggle(k)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${kind.includes(k) ? "border-accent bg-accent/15 text-foreground" : "border-border bg-surface/50 text-muted hover:text-foreground"}`}>
              {k}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
