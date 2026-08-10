import { cueNumbers, kindOf, type Kind, type Sequence, type SequenceItem, type Track } from "../types";

/**
 * What a show is about to do, in the order it will do it.
 *
 * The manager has to answer two questions at a glance: what is next, and when does the thing after
 * that land. A show carries more than one sequence, so neither answer can be read off the open deck
 * alone -- they come from flattening every sequence the show carries into one running order and
 * putting a clock against it.
 */
export type PlannedCue = {
  id: string; label: string; number: string; kind: Kind;
  /** Which sequence it came from, and where it sits inside that sequence, so a cue can still be fired. */
  sequence: string; sequenceId: string; index: number;
  /** Seconds this cue is expected to hold, and seconds from the top of the running order. */
  length: number; offset: number;
};

/**
 * How long a cue holds the room. A sound knows its own length and playing it faster makes it
 * shorter; a slide holds until somebody calls the next cue, which is a decision nobody has made
 * yet, so it counts as nothing.
 *
 * ponytail: that makes every offset a floor on the running time rather than a schedule, and the
 * manager says so in as many words. The upgrade, if a rehearsal ever needs real numbers, is to
 * record the gaps on a live run and average them.
 */
export const lengthOf = (item: SequenceItem, track?: Track): number => {
  if (!track || kindOf(track) !== "audio") return 0;
  const speed = item.effects?.speed || 1;
  return Math.max(0, (track.duration ?? 0) / speed);
};

/** The sequences a show carries, in the order it carries them: its own deck first, then the rest. */
export function showSequences(sequences: Sequence[], deckId: string | null, carried: string[]): Sequence[] {
  const seen = new Set<string>();
  const out: Sequence[] = [];
  for (const id of [deckId, ...carried]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const seq = sequences.find(s => s.id === id);
    if (seq) out.push(seq);
  }
  return out;
}

/**
 * Every cue the show will call, in order, with where it lands on the clock. Numbering restarts per
 * sequence because that is what the deck broadcasts and what the room says out loud.
 */
export function planShow(seqs: Sequence[], tracks: Track[]): PlannedCue[] {
  const byId = new Map(tracks.map(t => [t.id, t]));
  const out: PlannedCue[] = [];
  let offset = 0;
  for (const seq of seqs) {
    const numbers = cueNumbers(seq.items.map(it => kindOf(byId.get(it.trackId) ?? { kind: "audio" })));
    seq.items.forEach((item, index) => {
      const track = byId.get(item.trackId);
      const length = lengthOf(item, track);
      out.push({
        id: item.id, label: item.label, number: numbers[index] ?? String(index + 1),
        kind: kindOf(track ?? { kind: "audio" }),
        sequence: seq.name, sequenceId: seq.id, index, length, offset,
      });
      offset += length;
    });
  }
  return out;
}

/** Where the deck is standing in that plan, or -1 when the armed sequence is not part of this show. */
export const liveAt = (plan: PlannedCue[], sequenceId: string, index: number) =>
  index < 0 ? -1 : plan.findIndex(c => c.sequenceId === sequenceId && c.index === index);

/** m:ss, and h:mm:ss once there is an hour to show. Anything unknown reads as 0:00, never as NaN. */
export function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const s = String(total % 60).padStart(2, "0");
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
