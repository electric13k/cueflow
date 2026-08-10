import { describe, expect, it } from "vitest";
import { ACCOUNT_DAYS, daysLeft, dueDeletion, dueNotice, guestExpired } from "./retention";

const DAY = 86_400_000;
const now = new Date("2026-08-10T12:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * DAY);

describe("daysLeft", () => {
  it("counts down from a year of quiet", () => {
    expect(daysLeft(ago(0), now)).toBe(ACCOUNT_DAYS);
    expect(daysLeft(ago(365), now)).toBe(0);
    expect(daysLeft(ago(400), now)).toBeLessThan(0);
  });
});

describe("dueNotice", () => {
  it("fires only inside the last month, and never after the deadline", () => {
    expect(dueNotice(ago(300), now)).toBe(false);
    expect(dueNotice(ago(340), now)).toBe(true);
    expect(dueNotice(ago(364), now)).toBe(true);
    expect(dueNotice(ago(366), now)).toBe(false);
  });
});

describe("dueDeletion", () => {
  const notice = (deadlineDaysFromNow: number) => ({
    sentAt: ago(30).toISOString(),
    deadline: new Date(now.getTime() + deadlineDaysFromNow * DAY).toISOString(),
  });

  it("refuses to delete an account that was never warned", () => {
    expect(dueDeletion(ago(400), null, now)).toBe(false);
  });
  it("waits for the deadline even when the year is up", () => {
    expect(dueDeletion(ago(370), notice(5), now)).toBe(false);
  });
  it("deletes once the year is up and the notice deadline has passed", () => {
    expect(dueDeletion(ago(370), notice(-1), now)).toBe(true);
  });
  it("leaves an active account alone whatever the notice says", () => {
    expect(dueDeletion(ago(2), notice(-1), now)).toBe(false);
  });
});

describe("guestExpired", () => {
  it("keeps a guest upload for thirty days and no longer", () => {
    expect(guestExpired(ago(29), now)).toBe(false);
    expect(guestExpired(ago(30), now)).toBe(true);
  });
});
