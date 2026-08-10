import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { onToast, type Toast } from "../lib/toast";

const icons = { info: Info, success: CircleCheck, warn: CircleAlert };
const tones = { info: "text-accent", success: "text-success", warn: "text-warning" };

export default function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  const drop = (id: number) => setItems(list => list.filter(t => t.id !== id));

  useEffect(() => onToast(t => {
    setItems(list => [...list, t]);
    setTimeout(() => drop(t.id), 7000);
  }), []);

  // Never surface on the projected audience window, it must stay pure black.
  if (location.pathname === "/audience") return null;
  return (
    /**
     * Under the bar, not across it. The bar is sticky at the top of every page, so a toast pinned at
     * a hardcoded 12px landed on the logo and the sign-in button on every route: that is the
     * "misaligned throughout the site" report. `--toast-top` is the bar's own height plus the notch,
     * declared once in styles.css, so the two cannot drift apart again.
     */
    <div
      style={{ top: "var(--toast-top)" }}
      className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-3">
      <AnimatePresence>
        {items.map(t => {
          const Icon = icons[t.tone ?? "info"];
          return (
            <motion.div
              key={t.id} layout
              initial={{ y: -24, opacity: 0, scale: .96 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -16, opacity: 0, scale: .96 }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              className="glass pointer-events-auto flex w-full max-w-md items-start gap-3 p-4"
              role="status"
            >
              {/* Everything on the row is 24px tall and starts on the same line: the icon is centred
                  in the title's own line box rather than nudged by a magic half-rem, and the close
                  button is a 24px square instead of a 15px glyph floating beside a taller heading. */}
              <Icon size={20} className={`mt-0.5 shrink-0 ${tones[t.tone ?? "info"]}`} />
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold leading-6">{t.title}</p>
                {t.body && <p className="mt-1 text-sm leading-6 text-muted">{t.body}</p>}
              </div>
              <button onClick={() => drop(t.id)} aria-label="Dismiss"
                className="-my-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-white/10 hover:text-foreground"><X size={17} /></button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
