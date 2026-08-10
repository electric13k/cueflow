import { local } from "./store";

/**
 * How a linked pair of cues runs. `SequenceItem.link` says *which* cue goes with which; this says
 * *how*, and it lives beside the sequence rather than inside it.
 *
 * ponytail: kept on the device, the same shape and for the same reason as showLinks. The ceiling is
 * that a second device does not see the setting and falls back to "together"; the upgrade is two
 * columns on the sequence item, at which point this module becomes its cache.
 */
export type LinkMode = "together" | "crossfade";
export type CueLink = { mode: LinkMode; overlap: number };
export type CueLinkMap = Record<string, CueLink>;

/** Seconds. Long enough to hear the two records sit on top of each other, short enough to be a cue. */
export const DEFAULT_OVERLAP = 4;
export const MAX_OVERLAP = 30;
export const defaultCueLink = (): CueLink => ({ mode: "together", overlap: DEFAULT_OVERLAP });

/** Either cue has to find the same setting, so the key cannot depend on which one was clicked. */
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export const cueLinkOf = (map: CueLinkMap, a: string, b: string): CueLink => map[pairKey(a, b)] ?? defaultCueLink();

export const withCueLink = (map: CueLinkMap, a: string, b: string, patch: Partial<CueLink>): CueLinkMap =>
  ({ ...map, [pairKey(a, b)]: { ...cueLinkOf(map, a, b), ...patch } });

/** Unlinking drops the setting, or the next pairing of those two cues inherits it. */
export const withoutCueLink = (map: CueLinkMap, a: string, b: string): CueLinkMap => {
  const k = pairKey(a, b);
  if (!(k in map)) return map;
  const next = { ...map };
  delete next[k];
  return next;
};

/**
 * A crossfade cannot outlast either record on the deck. A length of 0 means "not measured yet",
 * which must not clamp the setting down to nothing before the file has loaded.
 */
export const clampOverlap = (want: number, ...lengths: number[]) => {
  const known = lengths.filter(l => l > 0);
  return Math.max(0, Math.min(want, MAX_OVERLAP, ...known));
};

/** How far into the outgoing clip the incoming one starts. */
export const incomingStart = (outgoingLength: number, overlap: number) =>
  Math.max(0, outgoingLength - clampOverlap(overlap, outgoingLength));

/**
 * Equal-power crossfade: `t` is seconds since the incoming clip started, and the two gains are the
 * quarter-circle pair, not a straight line. Two unrelated records summed linearly lose about 3 dB
 * in the middle of the fade, and that dip is the hole you hear when a fade is done badly; sin and
 * cos keep out² + in² at 1 the whole way across.
 */
export const fadeGains = (t: number, overlap: number) => {
  if (overlap <= 0) return { out: 0, in: 1 };
  const x = Math.max(0, Math.min(1, t / overlap));
  return { out: Math.cos((x * Math.PI) / 2), in: Math.sin((x * Math.PI) / 2) };
};

const key = (project: string | null) => (project ? `cuelinks:${project}` : "cuelinks");
export const loadCueLinks = (project: string | null): CueLinkMap => local.get<CueLinkMap>(key(project), {});
export const saveCueLinks = (project: string | null, map: CueLinkMap) => local.set(key(project), map);
