import { useEffect, useState } from "react";
import { Check, UserPlus, UserRound, X } from "lucide-react";
import { Button, Input } from "../ui";
import { acceptFriend, askFriend, friendLabel, friendsAvailable, listFriends, removeFriend, type Friend } from "../lib/friends";
import { toast } from "../lib/toast";

/**
 * The people you work with, so adding a collaborator is picking a name rather than spelling one.
 *
 * It grants nothing on its own. A friendship is a shortcut and a memory; every actual permission
 * still comes from a project role or a show key, which is the only place they have ever come from.
 */
export default function FriendsPanel() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);

  const load = () => listFriends().then(setFriends).catch(() => undefined);

  useEffect(() => {
    void friendsAvailable().then(async yes => {
      setReady(yes);
      if (yes) await load();
    });
  }, []);

  const ask = async () => {
    setBusy(true);
    try {
      await askFriend(who);
      setWho("");
      await load();
      toast("Asked", "They will see it next time they open their account.", "success");
    } catch (e) { toast("Could not ask", (e as Error).message, "warn"); }
    finally { setBusy(false); }
  };

  const act = async (run: Promise<void>, said: string) => {
    try { await run; await load(); toast(said, "", "success"); }
    catch (e) { toast("That did not work", (e as Error).message, "warn"); }
  };

  // The table arrives with migration 0002. Until it is applied there is nothing useful to draw, and
  // an empty list would read as "you have no friends" rather than "this is not switched on yet".
  if (ready === false) return null;

  const incoming = friends.filter(f => f.incoming);
  const waiting = friends.filter(f => !f.accepted && !f.incoming);
  const settled = friends.filter(f => f.accepted);

  return (
    <section className="glass mt-6 space-y-4 p-6 sm:p-8">
      <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight"><UserRound size={18} className="text-accent" aria-hidden />People you work with</h2>
      <p className="text-body text-muted">
        A list of usernames, so inviting someone to a project is picking a name instead of spelling it
        again. Being on it gives nobody access to anything: that still comes from a project role or a
        show key.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <Input label="Their username" value={who} onValueChange={setWho} placeholder="sam"
            onKeyDown={e => { if (e.key === "Enter" && who.trim()) void ask(); }} />
        </div>
        <Button color="primary" isDisabled={!who.trim() || busy} isLoading={busy}
          startContent={<UserPlus size={16} aria-hidden />} onPress={() => void ask()}>Ask</Button>
      </div>

      {incoming.length > 0 && (
        <div>
          <h3 className="label-cap text-armed">Asked you</h3>
          <ul className="mt-2 space-y-2">
            {incoming.map(friend => (
              <li key={friend.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface/50 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-body font-semibold">{friendLabel(friend)}</span>
                <Button size="sm" color="primary" startContent={<Check size={14} aria-hidden />}
                  onPress={() => void act(acceptFriend(friend.id), "Added")}>Accept</Button>
                <Button size="sm" variant="light" startContent={<X size={14} aria-hidden />}
                  onPress={() => void act(removeFriend(friend.id), "Declined")}>No thanks</Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="label-cap text-muted">Your list</h3>
        {settled.length === 0 && waiting.length === 0
          ? <p className="mt-2 text-body text-muted">Nobody yet. Ask by username above.</p>
          : (
            <ul className="mt-2 space-y-2">
              {settled.map(friend => (
                <li key={friend.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface/50 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-body font-semibold">{friendLabel(friend)}</span>
                  {friend.username && <span className="text-label text-muted">@{friend.username}</span>}
                  <Button size="sm" variant="light" color="danger" onPress={() => void act(removeFriend(friend.id), "Removed")}>Remove</Button>
                </li>
              ))}
              {waiting.map(friend => (
                <li key={friend.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-muted">
                  <span className="min-w-0 flex-1 truncate text-body">{friendLabel(friend)}</span>
                  <span className="text-label">Waiting for them</span>
                  <Button size="sm" variant="light" onPress={() => void act(removeFriend(friend.id), "Withdrawn")}>Withdraw</Button>
                </li>
              ))}
            </ul>
          )}
      </div>
    </section>
  );
}
