import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autoSave, debounce, onSyncStatus, serialize, statusOf, syncStatus } from "./autosync";
import { persist } from "./store";

// The write itself is store.persist, which is already serialized, upserting and dedupe-on-merge.
// What is under test here is the trigger and the status, not a second copy of that engine.
vi.mock("./store", () => ({ persist: vi.fn(async () => ({ cloud: true, ok: true })) }));
const saves = vi.mocked(persist);

beforeEach(() => { vi.useFakeTimers(); saves.mockClear(); });
afterEach(() => { vi.useRealTimers(); });

describe("status", () => {
  it("is four words, and a device-only save is still a save", () => {
    expect(statusOf({ cloud: true, ok: true })).toBe("saved");
    expect(statusOf({ cloud: false, ok: true, reason: "Sign in to save to your account." })).toBe("saved");
    expect(statusOf({ cloud: true, ok: false, reason: "network" })).toBe("offline");
  });

  it("hands a new subscriber the current value straight away", () => {
    const seen: string[] = [];
    const off = onSyncStatus(s => seen.push(s));
    expect(seen).toEqual([syncStatus()]);
    off();
  });
});

describe("autoSave", () => {
  it("folds a burst of edits into one write", async () => {
    autoSave([], [], null);
    autoSave([], [], null);
    autoSave([], [], null);
    expect(saves).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(saves).toHaveBeenCalledTimes(1);
    expect(syncStatus()).toBe("saved");
  });

  it("reports a rejected write instead of throwing at the page", async () => {
    saves.mockRejectedValueOnce(new Error("no network"));
    autoSave([], [], null);
    await vi.advanceTimersByTimeAsync(500);
    expect(syncStatus()).toBe("offline");
  });
});

describe("debounce", () => {
  it("keeps separate keys apart", () => {
    const a = vi.fn(), b = vi.fn();
    debounce("a", 10, a); debounce("a", 10, a); debounce("b", 10, b);
    vi.advanceTimersByTime(10);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe("serialize", () => {
  it("never lets two jobs on one key overlap", async () => {
    vi.useRealTimers();
    let live = 0, most = 0;
    const job = () => serialize("k", async () => {
      most = Math.max(most, ++live);
      await new Promise(r => setTimeout(r, 5));
      live--;
      return "done";
    });
    const first = job();
    await new Promise(r => setTimeout(r, 1)); // the first one is running by now
    const second = job();
    expect(await Promise.all([first, second])).toEqual(["done", "done"]);
    expect(most).toBe(1);
  });

  // Only the newest state is worth writing: two saves asked for while one is in flight collapse to
  // the last one, and the superseded call resolves rather than running a stale write.
  it("drops a queued job the moment a newer one arrives", async () => {
    vi.useRealTimers();
    const ran: string[] = [];
    const job = (name: string) => serialize("k2", async () => { ran.push(name); return name; });
    const results = await Promise.all([job("first"), job("second"), job("third")]);
    expect(ran).toEqual(["third"]);
    expect(results).toEqual([undefined, undefined, "third"]);
  });
});
