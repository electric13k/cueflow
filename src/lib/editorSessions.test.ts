import { describe, expect, it } from "vitest";
import { mergeSession, type EditorSession } from "./editorSessions";

const session = (updatedAt: string, state: EditorSession["state"], id?: string): EditorSession =>
  ({ id, itemId: "t1", kind: "image", projectId: null, state, updatedAt });
const step = (id: string) => ({ id, label: id });

/**
 * Two copies of one session meet whenever an item is opened: the cached copy this device holds and
 * whatever the account has. Neither side is allowed to win outright.
 */
describe("mergeSession", () => {
  it("takes whichever side exists when only one does", () => {
    const only = session("2026-08-09T10:00:00Z", { crop: 1 });
    expect(mergeSession(only, null)).toBe(only);
    expect(mergeSession(null, only)).toBe(only);
    expect(mergeSession(null, null)).toBeNull();
  });

  it("newer wins per field, and the older copy still contributes what the newer never set", () => {
    const merged = mergeSession(
      session("2026-08-09T10:00:00Z", { crop: "old", trimIn: 3 }),
      session("2026-08-09T11:00:00Z", { crop: "new" }),
    );
    expect(merged?.state).toEqual({ crop: "new", trimIn: 3 });
    expect(merged?.updatedAt).toBe("2026-08-09T11:00:00Z");
  });

  it("reads the same either way round, because argument order is not a rule", () => {
    const a = session("2026-08-09T10:00:00Z", { crop: "old" });
    const b = session("2026-08-09T11:00:00Z", { crop: "new" });
    expect(mergeSession(a, b)).toEqual(mergeSession(b, a));
  });

  // Undo is a log, not a value. Taking the newer one wholesale would delete a step the other device
  // appended, which is exactly the work someone would most notice losing.
  it("unions the undo history, older steps first", () => {
    const merged = mergeSession(
      session("2026-08-09T10:00:00Z", { undo: [step("a"), step("b")] }),
      session("2026-08-09T11:00:00Z", { undo: [step("c")] }),
    );
    expect(merged?.state.undo?.map(u => u.id)).toEqual(["a", "b", "c"]);
  });

  it("never lets one step appear twice, however many times it arrives", () => {
    const merged = mergeSession(
      session("2026-08-09T10:00:00Z", { undo: [step("a"), step("b")] }),
      session("2026-08-09T11:00:00Z", { undo: [step("b"), step("a"), step("c")] }),
    );
    expect(merged?.state.undo?.map(u => u.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps the row id when the newer copy is a local one that has never been saved", () => {
    const merged = mergeSession(
      session("2026-08-09T10:00:00Z", {}, "row-1"),
      session("2026-08-09T11:00:00Z", {}),
    );
    expect(merged?.id).toBe("row-1");
  });

  it("leaves both inputs untouched", () => {
    const mine = session("2026-08-09T10:00:00Z", { undo: [step("a")] });
    const theirs = session("2026-08-09T11:00:00Z", { undo: [step("b")] });
    mergeSession(mine, theirs);
    expect(mine.state.undo?.map(u => u.id)).toEqual(["a"]);
    expect(theirs.state.undo?.map(u => u.id)).toEqual(["b"]);
  });
});
