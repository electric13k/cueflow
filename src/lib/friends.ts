import { supabase } from "./store";

/**
 * The people you work with.
 *
 * Adding a collaborator means typing a username, and the same handful of usernames get typed over
 * and over -- a company works with the same crew for a season. This is that list, and nothing more:
 * it grants no access to anything on its own, it only saves the typing and the spelling mistakes.
 *
 * One row per pair, ordered by who asked, so the relationship cannot exist in one direction only.
 * The table arrives with migration 0002; until that is applied every call here returns empty rather
 * than throwing, so a build running against an older database simply does not show the feature.
 */

export type Friend = {
  /** The friendship row, which is what accept and remove act on. */
  id: string;
  userId: string;
  username: string | null;
  displayName: string | null;
  accepted: boolean;
  /** True when they asked you, so the list can offer Accept rather than "waiting for them". */
  incoming: boolean;
};

const need = () => { if (!supabase) throw new Error("Cloud is not configured for this build."); return supabase; };

/** 42P01 is "relation does not exist": the migration has not been applied to this database yet. */
const missingTable = (error: { code?: string } | null) => error?.code === "42P01";

let available: boolean | null = null;
export async function friendsAvailable(): Promise<boolean> {
  if (available !== null) return available;
  if (!supabase) return (available = false);
  const { error } = await supabase.from("friendships").select("id").limit(1);
  available = !missingTable(error);
  return available;
}

export async function listFriends(): Promise<Friend[]> {
  if (!supabase) return [];
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("friendships")
    .select("id,requester,addressee,accepted")
    .or(`requester.eq.${user.id},addressee.eq.${user.id}`);
  if (error) {
    if (missingTable(error)) { available = false; return []; }
    throw new Error(error.message);
  }
  const rows = data ?? [];
  const others = rows.map(row => (row.requester === user.id ? row.addressee : row.requester));
  if (!others.length) return [];
  // Names come from `profiles` at read time, never copied here, so somebody renaming themselves is
  // reflected everywhere at once instead of leaving a stale copy in every list that mentioned them.
  const { data: people } = await supabase.from("profiles").select("id,username,display_name").in("id", others);
  return rows.map(row => {
    const userId = row.requester === user.id ? row.addressee : row.requester;
    const profile = people?.find(p => p.id === userId);
    return {
      id: row.id,
      userId,
      username: profile?.username ?? null,
      displayName: profile?.display_name ?? null,
      accepted: row.accepted,
      incoming: row.addressee === user.id && !row.accepted,
    };
  });
}

/**
 * Ask somebody, by username.
 *
 * Username only, deliberately. `profiles` has no email column on purpose -- being findable by name
 * is the point, being enumerable by address is not -- so this cannot become a way of testing which
 * addresses have accounts.
 */
export async function askFriend(username: string): Promise<void> {
  const client = need();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error("Sign in first.");
  const name = username.trim();
  const { data: found } = await client.from("profiles").select("id").ilike("username", name).maybeSingle();
  if (!found) throw new Error("No one here goes by that name.");
  if (found.id === user.id) throw new Error("That is you.");
  const { error } = await client.from("friendships").insert({ requester: user.id, addressee: found.id });
  // 23505 is the unique index: the pair already exists, in one direction or the other.
  if (error) throw new Error(error.code === "23505" ? "You have already asked them." : error.message);
}

export async function acceptFriend(id: string): Promise<void> {
  const { error } = await need().from("friendships").update({ accepted: true }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Withdrawing a request and removing a friend are the same act, from either side. */
export async function removeFriend(id: string): Promise<void> {
  const { error } = await need().from("friendships").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** How a friend should be written on screen: their own name if they set one, else their handle. */
export const friendLabel = (friend: Friend) => friend.displayName?.trim() || friend.username || "Someone";
