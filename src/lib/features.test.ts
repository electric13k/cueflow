import { describe, expect, it } from "vitest";
import { addToCollection, buildProjectExport, loadFeatures, makeTemplate, recordHistory, redoSequences, toggleFavorite, undoSequences } from "./features";
import type { Sequence, Track } from "../types";

const sequence = (name = "Act One"): Sequence => ({ id: "seq-1", name, createdAt: "2026-01-01T00:00:00.000Z", items: [] });
const track: Track = { id: "track-1", title: "Door", url: "https://example.com/door.mp3", createdAt: "2026-01-01T00:00:00.000Z", effects: { speed: 1, volume: .9, gain: 1, reverb: 0, fadeIn: 0, fadeOut: 0, distortion: 0, reverse: false } };

describe("feature state", () => {
  it("toggles favorites and adds collection membership", () => {
    const base = loadFeatures("feature-test");
    const favorite = toggleFavorite(base, track.id);
    const collected = addToCollection(favorite, "Act One", track.id);
    expect(collected.favorites).toEqual([track.id]);
    expect(collected.collections["Act One"]).toEqual([track.id]);
  });

  it("undoes and redoes sequence snapshots", () => {
    const before = [sequence()];
    const after = [{ ...before[0], name: "Act Two" }];
    const withHistory = recordHistory(loadFeatures("history-test"), before, after, "Rename sequence");
    const undone = undoSequences(withHistory, after);
    expect(undone?.sequences[0].name).toBe("Act One");
    const redone = undone && redoSequences(undone.state, undone.sequences);
    expect(redone?.sequences[0].name).toBe("Act Two");
  });

  it("creates a detached template and a portable JSON blob", async () => {
    const template = makeTemplate("Warmup", sequence());
    expect(template.sequence.id).not.toBe("seq-1");
    const blob = buildProjectExport("project-1", [track], [sequence()], loadFeatures("export-test"));
    const payload = JSON.parse(await blob.text());
    expect(payload.format).toBe("cueflow-project");
    expect(payload.tracks).toHaveLength(1);
    expect(payload.sequences).toHaveLength(1);
  });
});
