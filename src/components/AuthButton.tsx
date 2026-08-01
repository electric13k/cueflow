import { useEffect, useState } from "react";
import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, useDisclosure } from "@heroui/react";
import { LogIn, LogOut, User } from "lucide-react";
import { onAuth, signIn, signOut, signUp } from "../lib/store";

// Sign-in lives in the nav so the whole app shares one session. On sign-in, Studio's listener hydrates cloud data.
export default function AuthButton() {
  const [email, setEmail] = useState<string | null>(null);
  const modal = useDisclosure();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [form, setForm] = useState({ email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => onAuth(setEmail), []);

  const submit = async () => {
    setBusy(true); setNote("");
    try {
      if (mode === "up") { await signUp(form.email, form.password); setNote("Account created — you're signed in. (Check your inbox if confirmation is required.)"); }
      else await signIn(form.email, form.password);
      modal.onClose();
    } catch (e) { setNote((e as Error).message); } finally { setBusy(false); }
  };

  if (email) return (
    <Button size="sm" variant="light" startContent={<LogOut size={15} />} onPress={() => void signOut()} title={email}>
      <span className="max-w-[10rem] truncate">{email}</span>
    </Button>
  );
  return (
    <>
      <Button size="sm" color="primary" variant="flat" startContent={<LogIn size={15} />} onPress={modal.onOpen}>Sign in</Button>
      <Modal isOpen={modal.isOpen} onOpenChange={modal.onOpenChange} placement="center" backdrop="blur">
        <ModalContent>{onClose => (<>
          <ModalHeader className="flex items-center gap-2"><User size={18} className="text-primary" />{mode === "in" ? "Sign in" : "Create account"}</ModalHeader>
          <ModalBody>
            <p className="text-sm text-default-500">Saves your sounds and sequences to your account so they follow you across devices.</p>
            <Input type="email" label="Email" autoComplete="email" value={form.email} onValueChange={v => setForm(f => ({ ...f, email: v }))} />
            <Input type="password" label="Password" autoComplete={mode === "in" ? "current-password" : "new-password"} value={form.password} onValueChange={v => setForm(f => ({ ...f, password: v }))} onKeyDown={e => e.key === "Enter" && submit()} />
            {note && <p className="text-xs text-warning">{note}</p>}
            <button className="self-start text-xs text-primary" onClick={() => { setMode(m => m === "in" ? "up" : "in"); setNote(""); }}>
              {mode === "in" ? "No account? Create one" : "Have an account? Sign in"}
            </button>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onClose}>Cancel</Button>
            <Button color="primary" isLoading={busy} onPress={submit}>{mode === "in" ? "Sign in" : "Sign up"}</Button>
          </ModalFooter>
        </>)}</ModalContent>
      </Modal>
    </>
  );
}
