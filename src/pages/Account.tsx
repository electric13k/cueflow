import { useEffect, useState } from "react";
import { Button, Input } from "../ui";
import { AtSign, Download, KeyRound, LogOut, UserRound } from "lucide-react";
import Shell from "../components/Shell";
import { toast } from "../lib/toast";
import { onAuth, signOut } from "../lib/store";
import { buildBackup, saveBackup } from "../lib/backup";
import { ACCOUNT_DAYS, myNotice, type Notice } from "../lib/retention";
import { changePassword, getProfile, saveProfile, sendPasswordReset, usernameFree, usernameProblem, type Profile } from "../lib/account";

export default function Account() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
  const [display, setDisplay] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [exporting, setExporting] = useState("");

  const load = () => void getProfile().then(p => {
    setProfile(p); setReady(true);
    setName(p?.username ?? ""); setDisplay(p?.displayName ?? "");
  });
  // Reload on sign-in/out too: this page is reachable from the password-reset email, which lands
  // here already authenticated.
  useEffect(() => onAuth(() => load()), []);
  // The warning email points people here, so this page has to be able to show what it warned about.
  useEffect(() => { void myNotice().then(setNotice); }, [profile?.email]);

  const exportAll = async () => {
    setExporting("Gathering your rows");
    try {
      const { blob, missing } = await buildBackup((done, total) => setExporting(`Fetching file ${done} of ${total}`));
      saveBackup(blob);
      toast("Your export is downloading",
        missing.length ? `${missing.length} file${missing.length === 1 ? "" : "s"} could not be fetched and are listed by name in the zip's JSON.` : "Everything you own, as one zip.",
        missing.length ? "warn" : "success");
    } catch (e) { toast("Export failed", (e as Error).message, "warn"); }
    finally { setExporting(""); }
  };

  const saveName = async () => {
    const problem = usernameProblem(name);
    if (problem) return setNote(problem);
    setBusy(true); setNote("");
    try {
      if (name.toLowerCase() !== (profile?.username ?? "").toLowerCase() && !(await usernameFree(name))) {
        setNote("That username is already taken.");
        return;
      }
      await saveProfile({ username: name, displayName: display });
      toast("Profile saved", `You are @${name}.`, "success");
      load();
    } catch (e) { setNote((e as Error).message); }
    finally { setBusy(false); }
  };

  const savePassword = async () => {
    if (pw !== pw2) return setNote("Those two passwords are not the same.");
    setBusy(true); setNote("");
    try { await changePassword(pw); setPw(""); setPw2(""); toast("Password changed", "Use the new one next time you sign in.", "success"); }
    catch (e) { setNote((e as Error).message); }
    finally { setBusy(false); }
  };

  if (!ready) return <Shell width="max-w-2xl"><p className="text-muted">Checking your account…</p></Shell>;

  if (!profile) return (
    <Shell width="max-w-2xl">
      <h1 className="text-3xl font-black tracking-tight">Your account</h1>
      <p className="mt-3 text-muted">You are not signed in. Open the Studio and sign in there, an account is optional, and CueFlow works without one.</p>
      <Button className="mt-6" href="/studio" color="primary">Open the Studio</Button>
    </Shell>
  );

  return (
    <Shell width="max-w-2xl">
      <p className="text-[11px] font-semibold uppercase tracking-[.3em] text-accent">Account</p>
      <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{profile.username ? `@${profile.username}` : "Your account"}</h1>
      <p className="mt-2 text-sm text-muted">{profile.email}</p>

      {note && <p className="mt-4 rounded-xl border border-live/40 bg-live/10 px-4 py-2 text-sm">{note}</p>}

      <section className="glass mt-8 space-y-4 p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-xl font-black tracking-tight"><UserRound size={18} className="text-accent" />Profile</h2>
        <p className="text-sm text-muted">
          Your username is how people add you to a project. It is the only part of your account anyone
          else can look up, your email address is never shown to them.
        </p>
        <Input label="Username" value={name} onValueChange={v => setName(v.trim())} placeholder="stage_left" />
        <Input label="Display name" value={display} onValueChange={setDisplay} placeholder="Sam on sound" />
        <Button color="primary" isLoading={busy} startContent={<AtSign size={16} />} onPress={saveName}>Save profile</Button>
      </section>

      <section className="glass mt-6 space-y-4 p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-xl font-black tracking-tight"><KeyRound size={18} className="text-accent" />Password</h2>
        <Input type="password" label="New password" value={pw} onValueChange={setPw} autoComplete="new-password" />
        <Input type="password" label="New password again" value={pw2} onValueChange={setPw2} autoComplete="new-password" />
        <div className="flex flex-wrap gap-2">
          <Button color="primary" isLoading={busy} isDisabled={!pw} onPress={savePassword}>Change password</Button>
          <Button variant="light" onPress={() => { void sendPasswordReset(profile.email); toast("Check your email", "If that address has an account, a reset link is on its way.", "info"); }}>
            Email me a reset link
          </Button>
        </div>
      </section>

      <section className="glass mt-6 space-y-4 p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-xl font-black tracking-tight"><Download size={18} className="text-accent" />Your data</h2>
        {notice ? (
          <p className="rounded-xl border border-live/40 bg-live/10 px-4 py-3 text-sm">
            This account has been idle, so it is scheduled for deletion on{" "}
            <strong>{new Date(notice.deadline).toLocaleDateString()}</strong>. Using CueFlow at all cancels that,
            you are doing it right now by reading this.
          </p>
        ) : (
          <p className="text-sm text-muted">
            An account that goes unopened for {ACCOUNT_DAYS} days is deleted, with one email a month beforehand.
            Anything uploaded without an account goes after 30 days. Opening CueFlow resets the clock.
          </p>
        )}
        <p className="text-sm text-muted">
          The export is one zip: your files under their own names, and your projects, sequences, shows and
          scripts as plain JSON that opens without CueFlow.
        </p>
        <Button color="primary" isLoading={!!exporting} startContent={<Download size={16} />} onPress={() => void exportAll()}>
          {exporting || "Download everything as a zip"}
        </Button>
      </section>

      <section className="glass mt-6 p-6 sm:p-8">
        <h2 className="text-xl font-black tracking-tight">Signing out</h2>
        <p className="mt-2 text-sm text-muted">Your library stays on this device. Sign back in to pull down anything saved from another one.</p>
        <Button className="mt-4" variant="bordered" startContent={<LogOut size={16} />} onPress={() => void signOut().then(load)}>Sign out</Button>
      </section>
    </Shell>
  );
}
