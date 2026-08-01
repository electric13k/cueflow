import { describe, expect, it } from "vitest";
import { clueLessSequence, initialTracks } from "./cues";
describe("Clue-less cues", () => {
  it("creates the 18 script cues with every track resolved", () => {
    const tracks = initialTracks(); const sequence = clueLessSequence(tracks);
    expect(sequence.items).toHaveLength(18);
    expect(sequence.items.every(item => tracks.some(track => track.id === item.trackId))).toBe(true);
  });
});
