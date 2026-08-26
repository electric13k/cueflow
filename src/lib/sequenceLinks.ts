import type { SequenceItem } from "../types";

/** Each cue has at most one partner; linking a new pair clears any old partner on either side. */
export const linkSequenceItems = (items: SequenceItem[], aId: string, bId: string): SequenceItem[] =>
  items.map(item => {
    if (item.id === aId) return { ...item, link: bId };
    if (item.id === bId) return { ...item, link: aId };
    return item.link === aId || item.link === bId ? { ...item, link: undefined } : item;
  });

/** Removing either side removes the link from both cues. */
export const unlinkSequenceItem = (items: SequenceItem[], id: string): SequenceItem[] =>
  items.map(item => item.id === id || item.link === id ? { ...item, link: undefined } : item);
