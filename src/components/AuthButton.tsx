import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, useDisclosure } from "../ui";
import { LogIn, LogOut, User } from "lucide-react";
import GoogleMark from "./GoogleMark";
import { onAuth, signIn, signInWith, signOut, signUp } from "../lib/store";
import { toast } from "../lib/toast";

// Sign-in lives in the nav so the whole app shares one session. On sign-in, Studio's listener hydrates cloud data.
export default function AuthButton() {
  const [email, setEmail] = useState<string | null>(null);
  const modal = useDisclosure();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [form, setForm] = useState({ email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const navigate = useNavigate();

  useEffect(() => onAuth(setEmail), []);
  // The sign-in banner asks for the modal rather than owning a second copy of it.
  useEffect(() => {
    const open = () => modal.onOpen();
    window.addEventListener("cueflow:signin", open);
    return () => window.removeEventListener("cueflow:signin", open);
  }, [modal]);

  const submit = async () => {
    setBusy(true); setNote("");
    try {
      if (mode === "up") {
        await signUp(form.email, form.password);
        toast("Check your email", `We sent a confirmation link to ${form.email}. Click it to finish setting up your account, you can keep working here in the meantime.`, "success");
      } else {
        await signIn(form.email, form.password);
        toast("Signed in", "Your sounds and sequences now sync to this account.", "success");
        navigate("/workspace", { replace: true });
      }
      modal.onClose();
    } catch (e) { setNote((e as Error).message); } finally { setBusy(false); }
  };

  if (email) return (
    <Button size="sm" variant="light" isIconOnly className="sm:w-auto sm:px-3" startContent={<LogOut size={15} />} onPress={() => void signOut()} title={`Sign out ${email}`} aria-label={`Sign out ${email}`}>
      <span className="sr-only sm:not-sr-only sm:max-w-[10rem] sm:truncate">{email}</span>
    </Button>
  );
  return (
    <>
      <Button size="sm" color="primary" variant="flat" startContent={<LogIn size={15} />} onPress={modal.onOpen}>Sign in</Button>
      <Modal isOpen={modal.isOpen} onOpenChange={modal.onOpenChange} placement="center" backdrop="blur">
        <ModalContent>{onClose => (<>
          <ModalHeader className="flex items-center gap-2"><User size={18} className="text-accent" />{mode === "in" ? "Sign in" : "Create account"}</ModalHeader>
          <ModalBody>
            <p className="text-sm text-muted">Saves your sounds and sequences to your account so they follow you across devices.</p>
            <Button variant="bordered" startContent={<GoogleMark />} className="font-medium"
              onPress={() => void signInWith("google").catch(e => setNote((e as Error).message))}>
              Continue with Google
            </Button>
            <p className="text-xs text-muted">
              Already have a password account? Sign in with it, then add Google from your account page.
              Signing in with Google first makes a second, separate account.
            </p>
            <p className="text-center font-mono text-[10px] uppercase tracking-[.3em] text-muted">or</p>
            <Input
              type={mode === "up" ? "email" : "text"}
              label={mode === "up" ? "Email" : "Email or username"}
              autoComplete={mode === "up" ? "email" : "username"}
              value={form.email} onValueChange={v => setForm(f => ({ ...f, email: v }))} />
            <Input type="password" label="Password" autoComplete={mode === "in" ? "current-password" : "new-password"} value={form.password} onValueChange={v => setForm(f => ({ ...f, password: v }))} onKeyDown={e => e.key === "Enter" && submit()} />
            {note && <p className="text-xs text-warning">{note}</p>}
            <button className="self-start text-xs text-accent" onClick={() => { setMode(m => m === "in" ? "up" : "in"); setNote(""); }}>
              {mode === "in" ? "No account? Create one" : "Have an account? Sign in"}
            </button>
            {mode === "up" && (
              <p className="text-xs text-muted">
                By creating an account you agree to the{" "}
                <a href={`${import.meta.env.BASE_URL}legal#terms`} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">Terms</a> and{" "}
                <a href={`${import.meta.env.BASE_URL}legal#privacy`} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">Privacy Policy</a>.
              </p>
            )}
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
