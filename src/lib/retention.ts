import { supabase } from "./store";

/**
 * How long an idle library survives, and when its owner hears about it.
 *
 * Guests get 30 days because nothing about a guest upload is recoverable: no account, no address,
 * no way to warn anyone. Accounts get a year, and a warning a month before the year is up, because
 * a production runs on a season and a company that stages one show a year is a normal customer.
 *
 * The clock is INACTIVITY, not age. Opening CueFlow resets it, which is the second thing the notice
 * tells you: sign in again and nothing happens.
 */
export const GUEST_DAYS = 30;
export const ACCOUNT_DAYS = 365;
export const NOTICE_DAYS = 30;

const DAY = 86_400_000;

export type Notice = { sentAt: string; deadline: string };

/** Days from `from` until an idle account is deleted. Negative means the deadline has passed. */
export const daysLeft = (lastSeen: string | Date, from: Date = new Date()) =>
  Math.ceil((new Date(lastSeen).getTime() + ACCOUNT_DAYS * DAY - from.getTime()) / DAY);

/** True once an account is inside the last month, which is when the one notice goes out. */
export const dueNotice = (lastSeen: string | Date, from: Date = new Date()) => {
  const left = daysLeft(lastSeen, from);
  return left <= NOTICE_DAYS && left > 0;
};

/** True when the account is past its deadline and the notice has had its full month to land. */
export const dueDeletion = (lastSeen: string | Date, notice: Notice | null, from: Date = new Date()) =>
  daysLeft(lastSeen, from) <= 0 && !!notice && from.getTime() >= new Date(notice.deadline).getTime();

/** A guest upload has no owner to warn, so age alone decides. */
export const guestExpired = (uploadedAt: string | Date, from: Date = new Date()) =>
  from.getTime() - new Date(uploadedAt).getTime() >= GUEST_DAYS * DAY;

/**
 * Resets the clock. Called once when a signed-in session starts: one write per app load, not per
 * action, because the resolution that matters here is a day and a busy show would otherwise write
 * this a hundred times an evening.
 */
export async function touchLastSeen() {
  if (!supabase) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.rpc("touch_last_seen");
}

/** The pending notice for the signed-in account, if one has gone out and they have not been back. */
export async function myNotice(): Promise<Notice | null> {
  if (!supabase) return null;
  const { data } = await supabase.from("retention_notices").select("sent_at,deadline").maybeSingle();
  return data ? { sentAt: data.sent_at, deadline: data.deadline } : null;
}
