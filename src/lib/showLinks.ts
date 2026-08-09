import { local } from "./store";

/**
 * Which sequences, and whether the script, a show carries.
 *
 * `shows.sequence_id` holds one sequence and the project screen lets you drop several onto one show,
 * so the first one dropped becomes the show's own deck and the rest are recorded here.
 *
 * ponytail: kept on the device, next to the rest of the project's local state. The ceiling is that a
 * second device does not see the extra ones; the upgrade is a `show_sequences` table carrying the
 * same RLS as `shows`, at which point this module becomes its cache.
 */
export type ShowLinks = { seqs: string[]; script: boolean };
export type LinkMap = Record<string, ShowLinks>;

const blank = (): ShowLinks => ({ seqs: [], script: false });
export const linksOf = (map: LinkMap, showId: string): ShowLinks => map[showId] ?? blank();

/** Several sequences go into one show; dropping the same one twice is still one sequence. */
export const withSequence = (map: LinkMap, showId: string, seqId: string): LinkMap => {
  const links = linksOf(map, showId);
  if (links.seqs.includes(seqId)) return map;
  return { ...map, [showId]: { ...links, seqs: [...links.seqs, seqId] } };
};

export const withScript = (map: LinkMap, showId: string): LinkMap =>
  ({ ...map, [showId]: { ...linksOf(map, showId), script: true } });

/** A deleted show must not leave its links behind to be counted against the next one. */
export const withoutShow = (map: LinkMap, showId: string): LinkMap => {
  if (!(showId in map)) return map;
  const next = { ...map };
  delete next[showId];
  return next;
};

const key = (project: string | null) => (project ? `showlinks:${project}` : "showlinks");
export const loadLinks = (project: string | null): LinkMap => local.get<LinkMap>(key(project), {});
export const saveLinks = (project: string | null, map: LinkMap) => local.set(key(project), map);
