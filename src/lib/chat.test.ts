import { beforeEach, describe, expect, it, vi } from "vitest";
import { CAP, clearChat, loadChat, logChat, merge, onChat, type ChatLine } from "./chat";

const line = (id: string, text = id): ChatLine => ({ id, at: "2026-01-01T00:00:00.000Z", from: "host", text, kind: "message" });

describe("show chat history", () => {
  beforeEach(() => localStorage.clear());

  it("does not log the same line twice, whichever window logged it first", () => {
    const once = [line("a")];
    expect(merge(once, line("a"))).toBe(once);
    expect(merge(once, line("b")).map(l => l.id)).toEqual(["a", "b"]);
  });

  it("keeps the newest lines and drops the rest rather than growing without end", () => {
    let history: ChatLine[] = [];
    for (let i = 0; i < CAP + 10; i++) history = merge(history, line(`l${i}`));
    expect(history).toHaveLength(CAP);
    expect(history[0].id).toBe("l10");
  });

  it("keeps one show's history out of another's", () => {
    logChat("s1", { from: "host", text: "standby", kind: "message" });
    logChat("s2", { from: "sound", text: "ready", kind: "message" });
    expect(loadChat("s1").map(l => l.text)).toEqual(["standby"]);
    expect(loadChat("s2").map(l => l.text)).toEqual(["ready"]);
  });

  it("tells whoever is watching that show, and stops when they leave", () => {
    const saw = vi.fn();
    const off = onChat(saw);
    logChat("s1", { from: "host", text: "go", kind: "message" });
    expect(saw).toHaveBeenCalledWith("s1");
    off();
    logChat("s1", { from: "host", text: "again", kind: "message" });
    expect(saw).toHaveBeenCalledTimes(1);
  });

  it("ignores a line with no show and a line with no words", () => {
    logChat("", { from: "host", text: "nowhere", kind: "message" });
    logChat("s1", { from: "host", text: "", kind: "message" });
    expect(loadChat("")).toEqual([]);
    expect(loadChat("s1")).toEqual([]);
  });

  it("clears one show without touching the other", () => {
    logChat("s1", { from: "host", text: "one", kind: "message" });
    logChat("s2", { from: "host", text: "two", kind: "message" });
    clearChat("s1");
    expect(loadChat("s1")).toEqual([]);
    expect(loadChat("s2")).toHaveLength(1);
  });
});
