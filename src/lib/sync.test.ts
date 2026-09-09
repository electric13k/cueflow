import { beforeEach, describe, expect, it, vi } from "vitest";
import { describeSync, onSyncState, setSyncAccount, setSyncChannel, syncState } from "./sync";

/** Every test starts from a known state: the module holds one value for the whole process. */
beforeEach(() => { setSyncAccount(false); setSyncChannel(false); });

describe("sync state", () => {
  it("starts local, because an account is optional", () => {
    expect(syncState()).toBe("off");
  });

  it("stays local for a signed-out visitor even once the socket is up", () => {
    // The realtime channel subscribes whether or not anyone is signed in. Reporting that as
    // "Synced" told a visitor with no account that work was travelling somewhere.
    setSyncChannel(true);
    expect(syncState()).toBe("off");
  });

  it("is not syncing when there is an account but no channel", () => {
    setSyncAccount(true);
    expect(syncState()).toBe("down");
  });

  it("is synced only with both an account and a channel", () => {
    setSyncAccount(true);
    setSyncChannel(true);
    expect(syncState()).toBe("live");
  });

  it("gives the same answer whichever fact arrives first", () => {
    setSyncChannel(true);
    setSyncAccount(true);
    const chanFirst = syncState();
    setSyncAccount(false);
    setSyncChannel(false);
    setSyncAccount(true);
    setSyncChannel(true);
    expect(syncState()).toBe(chanFirst);
  });

  it("gives a subscriber the current state at once, not just the next change", () => {
    setSyncAccount(true);
    const saw = vi.fn();
    onSyncState(saw);
    expect(saw).toHaveBeenCalledWith("down");
  });

  it("does not re-announce a state it is already in", () => {
    setSyncAccount(true);
    const saw = vi.fn();
    const off = onSyncState(saw);
    saw.mockClear();
    // watchCloud reports the same failure on every retry, and the backoff runs to 30s.
    setSyncChannel(false);
    setSyncChannel(false);
    setSyncChannel(false);
    expect(saw).not.toHaveBeenCalled();
    off();
  });

  it("stops talking to a subscriber that unsubscribed", () => {
    const saw = vi.fn();
    onSyncState(saw)();
    saw.mockClear();
    setSyncAccount(true);
    setSyncChannel(true);
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
