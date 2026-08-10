import { useEffect, useState } from "react";
import { Button } from "../ui";
import { AnimatePresence, motion } from "framer-motion";
import { Cookie } from "lucide-react";
import { CONSENT_COOKIE, getCookie, setCookie } from "../lib/cookies";

// Consent banner. CueFlow's storage (localStorage for your sounds/sequences, Supabase auth cookies) is
// functional, so it always works; this records the user's acknowledgement and hides once chosen.
export default function CookieConsent() {
  const [show, setShow] = useState(false);
  // Never surface on the projected audience window, it must stay pure black.
  useEffect(() => { setShow(location.pathname !== "/audience" && !getCookie(CONSENT_COOKIE)); }, []);
  // The sign-in nudge queues behind this one and waits for the event rather than a reload.
  const choose = (v: "accepted" | "declined") => { setCookie(CONSENT_COOKIE, v); setShow(false); window.dispatchEvent(new Event("cueflow:consent")); };
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: 120, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 120, opacity: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 28 }}
          className="glass fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-3xl flex-col items-start gap-3 p-4 sm:flex-row sm:items-center"
          role="dialog" aria-label="Cookie consent"
        >
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent/15 text-accent"><Cookie size={18} /></div>
          <p className="flex-1 text-sm text-muted">
            CueFlow uses cookies and local storage to keep your sounds, sequences and preferences on this device, and to keep you signed in. No ads, no third-party tracking.{" "}
            <a href={`${import.meta.env.BASE_URL}legal#privacy`} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">Privacy Policy</a>
            {" · "}
            <a href={`${import.meta.env.BASE_URL}legal#terms`} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">Terms</a>
          </p>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="light" onPress={() => choose("declined")}>Decline</Button>
            <Button size="sm" color="primary" onPress={() => choose("accepted")}>Accept</Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
