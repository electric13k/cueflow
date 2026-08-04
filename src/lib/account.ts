import { supabase } from "./store";

/**
 * Accounts and usernames.
 *
 * A username is how someone gets invited to collaborate, so it has to be unique and has to be
 * findable by a stranger -- but only the name. Email addresses are never exposed by these calls,
 * and the profiles table holds no email column at all.
 */
export type Profile = { id: string; email: string; username: string | null; displayName: string | null };

/** 3-20, letters/digits/underscore, starts with a letter. The same rule the database enforces. */
export const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/;
export function usernameProblem(name: string) {
  if (name.length < 3) return "At least 3 characters.";
  if (name.length > 20) return "At most 20 characters.";
  if (!/^[a-zA-Z]/.test(name)) return "Start with a letter.";
  if (!USERNAME_RE.test(name)) return "Letters, numbers and underscores only.";
  return "";
}

export async function getProfile(): Promise<Profile | null> {
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("username,display_name").eq("id", user.id).maybeSingle();
  return { id: user.id, email: user.email ?? "", username: data?.username ?? null, displayName: data?.display_name ?? null };
}

/** Free means "no row has it". A race between two people claiming the same name is caught by the
 *  unique index on save, which is why saveProfile translates that error rather than trusting this. */
export async function usernameFree(name: string) {
  if (!supabase) return true;
  const { data } = await supabase.from("profiles").select("id").ilike("username", name).maybeSingle();
  return !data;
}

export async function saveProfile(patch: { username?: string; displayName?: string }) {
  if (!supabase) throw new Error("Cloud is not configured for this build.");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in first.");
  const row: Record<string, unknown> = { id: user.id, updated_at: new Date().toISOString() };
  if (patch.username !== undefined) row.username = patch.username;
  if (patch.displayName !== undefined) row.display_name = patch.displayName;
  const { error } = await supabase.from("profiles").upsert(row);
  // 23505 is the unique violation: someone took the name between the check and the save.
  if (error) throw new Error(error.code === "23505" ? "That username is already taken." : error.message);
}

export async function changePassword(next: string) {
  if (!supabase) throw new Error("Cloud is not configured for this build.");
  if (next.length < 8) throw new Error("Use at least 8 characters.");
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) throw error;
}

/**
 * Sends the reset link. Always reports success, whether or not the address has an account: telling
 * a stranger which emails are registered here is an account-enumeration hole, and a real owner gets
 * the mail either way.
 */
export async function sendPasswordReset(email: string) {
  if (!supabase) throw new Error("Cloud is not configured for this build.");
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${import.meta.env.BASE_URL}account` });
}
