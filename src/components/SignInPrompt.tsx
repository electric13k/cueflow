import { useEffect, useState } from "react";
import { Button } from "../ui";
import { AnimatePresence, motion } from "framer-motion";
import { CloudUpload, X } from "lucide-react";
import { onAuth } from "../lib/store";
import { CONSENT_COOKIE, getCookie } from "../lib/cookies";

const KEY = "cueflow:signin-prompt";

/**
 * Sign-in nudge, same shape as the cookie banner: sits at the bottom, dismisses for good, and never
 * shows on the projected audience window. The Sign in button fires an event the nav's AuthButton
 * listens for, so there is only ever one auth modal in the app.
 */
export default function SignInPrompt() {
  const [email, setEmail] = useState<string | null>("pending"); // "pending" until auth answers
  const [dismissed, setDismissed] = useState(!!localStorage.getItem(KEY));
  const [consented, setConsented] = useState(!!getCookie(CONSENT_COOKIE));

  useEffect(() => onAuth(setEmail), []);
  useEffect(() => {
    const again = () => setConsented(!!getCookie(CONSENT_COOKIE));
    window.addEventListener("cueflow:consent", again);
    return () => window.removeEventListener("cueflow:consent", again);
  }, []);

  // Waits its turn behind the cookie banner: both sit bottom-centre, so two at once is one on top
  // of the other.
  const show = email === null && !dismissed && consented && location.pathname !== "/audience";
  const close = () => { localStorage.setItem(KEY, "dismissed"); setDismissed(true); };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: 120, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 120, opacity: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 28 }}
          className="glass fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-3xl flex-col items-start gap-3 p-4 sm:flex-row sm:items-center"
          role="dialog" aria-label="Sign in to sync"
        >
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent/15 text-accent"><CloudUpload size={18} /></div>
          <p className="flex-1 text-sm text-muted">
            <b className="text-foreground">Sign in to sync your progress across devices.</b>{" "}
            Right now your sounds and sequences live in this browser only. Clear it and they are gone.
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="light" onPress={close}>Not now</Button>
            <Button size="sm" color="primary" onPress={() => { close(); window.dispatchEvent(new Event("cueflow:signin")); }}>Sign in</Button>
            <button onClick={close} aria-label="Dismiss" className="text-muted hover:text-foreground"><X size={16} /></button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
