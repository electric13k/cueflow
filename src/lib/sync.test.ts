import { beforeEach, describe, expect, it, vi } from "vitest";
import { describeSync, onSyncState, setSyncState, syncState } from "./sync";

/** Every test starts from a known state: the module holds one value for the whole process. */
beforeEach(() => setSyncState("off"));

describe("sync state", () => {
  it("starts local, because an account is optional", () => {
    expect(syncState()).toBe("off");
  });

  it("gives a subscriber the current state at once, not just the next change", () => {
    setSyncState("down");
    const saw = vi.fn();
    onSyncState(saw);
    expect(saw).toHaveBeenCalledWith("down");
  });

  it("does not re-announce a state it is already in", () => {
    const saw = vi.fn();
    const off = onSyncState(saw);
    saw.mockClear();
    // watchCloud reports the same failure on every retry, and the backoff runs to 30s.
    setSyncState("down");
    setSyncState("down");
    setSyncState("down");
    expect(saw).toHaveBeenCalledTimes(1);
    off();
  });

  it("stops talking to a subscriber that unsubscribed", () => {
    const saw = vi.fn();
    onSyncState(saw)();
    saw.mockClear();
    setSyncState("live");
    expect(saw).not.toHaveBeenCalled();
  });

  it("keeps all three states distinct and says something different for each", () => {
    const wording = (["off", "live", "down"] as const).map(s => describeSync(s));
    expect(new Set(wording.map(w => w.label)).size).toBe(3);
    expect(new Set(wording.map(w => w.detail)).size).toBe(3);
  });

  /**
   * The bug this module exists for: a signed-in operator whose cloud was switched off was told to
   * sign in. "down" must never be worded as an invitation to sign in.
   */
  it("does not blame the operator's sign-in when the cloud is the thing that is down", () => {
    expect(describeSync("down").detail.toLowerCase()).not.toContain("sign in");
    expect(describeSync("off").detail.toLowerCase()).toContain("sign in");
  });
});
