import { useEffect, useState } from "react";
import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "../ui";
import { onAuth } from "../lib/store";
import { getProfile, saveProfile, usernameFree, usernameProblem } from "../lib/account";

/**
 * Asks once, the first time someone signs in without a username. It is how collaborators find each
 * other, so it cannot wait until the moment someone tries to invite you.
 *
 * Skippable: an account with no username still works for everything except being invited by name.
 */
export default function UsernamePrompt() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const check = (email: string | null) => {
      if (!email || localStorage.getItem("cueflow:tutorial-active") || localStorage.getItem("cueflow:usernameAsked")) {
        setOpen(false);
        return;
      }
      void getProfile().then(p => { if (p && !p.username) setOpen(true); });
    };
    const off = onAuth(check);
    const resume = () => {
      if (localStorage.getItem("cueflow:tutorial-active") || localStorage.getItem("cueflow:usernameAsked")) return;
      void getProfile().then(p => { if (p && !p.username) setOpen(true); });
    };
    window.addEventListener("cueflow:tutorial-finished", resume);
    return () => { off(); window.removeEventListener("cueflow:tutorial-finished", resume); };
  }, []);

  const dismiss = () => { localStorage.setItem("cueflow:usernameAsked", "1"); setOpen(false); };

  const claim = async () => {
    const problem = usernameProblem(name);
    if (problem) return setNote(problem);
    setBusy(true); setNote("");
    try {
      if (!(await usernameFree(name))) { setNote("That one is taken. Try another."); return; }
      await saveProfile({ username: name });
      dismiss();
    } catch (e) { setNote((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Modal isOpen={open} onOpenChange={v => { if (!v) dismiss(); }}>
      <ModalContent>
        <ModalHeader>Pick a username</ModalHeader>
        <ModalBody>
          <div className="space-y-3">
            <p className="text-sm text-muted">
              It is how someone adds you to a project. No two people can have the same one, and it is the
              only part of your account anyone else can look up.
            </p>
            <Input autoFocus label="Username" value={name} onValueChange={v => setName(v.trim())} placeholder="stage_left"
              onKeyDown={e => { if (e.key === "Enter") void claim(); }} />
            <p className="text-xs text-muted">3–20 characters. Letters, numbers and underscores, starting with a letter.</p>
            {note && <p className="text-sm text-live">{note}</p>}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={dismiss}>Later</Button>
          <Button color="primary" isLoading={busy} onPress={claim}>Claim it</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
