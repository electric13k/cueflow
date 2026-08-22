import { useEffect, useState } from "react";
import { Button } from "../ui";
import { AnimatePresence, motion } from "framer-motion";
import { Cookie } from "lucide-react";
import { getConsent, saveConsent, type ConsentState } from "../lib/cookies";

// Necessary storage keeps CueFlow usable. Optional analytics is off until the user explicitly opts in.
export default function CookieConsent() {
  const [, setConsent] = useState<ConsentState>(() => ({ analytics: "unset", performance: "accepted" }));
  const [show, setShow] = useState(false);

  useEffect(() => {
    const sync = () => {
      const next = getConsent();
      setConsent(next);
      setShow(location.pathname !== "/audience" && next.analytics === "unset");
    };
    sync();
    window.addEventListener("cueflow:consent", sync);
    return () => window.removeEventListener("cueflow:consent", sync);
  }, []);

  const choose = (analytics: "accepted" | "declined") => {
    saveConsent({ analytics, performance: "accepted" });
    setShow(false);
  };

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
            CueFlow uses necessary local storage and performance caching to keep your work, preferences, sign-in, and loading experience working. Optional analytics is off by default. If enabled, it helps us understand which screens need improvement and can be turned off later in Settings.{" "}
            <a href={`${import.meta.env.BASE_URL}cookies`} className="text-accent underline-offset-2 hover:underline">Cookies</a>{" "}
            and <a href={`${import.meta.env.BASE_URL}privacy`} className="text-accent underline-offset-2 hover:underline">Privacy Policy</a>.
          </p>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="light" onPress={() => choose("declined")}>Only necessary</Button>
            <Button size="sm" color="primary" onPress={() => choose("accepted")}>Allow analytics</Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export { getConsent, saveConsent };
