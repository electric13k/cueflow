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

  // Never surface on the projected audience window — it must stay pure black.
  if (location.pathname === "/audience") return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-3">
      <AnimatePresence>
        {items.map(t => {
          const Icon = icons[t.tone ?? "info"];
          return (
            <motion.div
              key={t.id} layout
              initial={{ y: -24, opacity: 0, scale: .96 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -16, opacity: 0, scale: .96 }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              className="glass pointer-events-auto flex w-full max-w-md items-start gap-3 p-3.5"
              role="status"
            >
              <Icon size={18} className={`mt-0.5 shrink-0 ${tones[t.tone ?? "info"]}`} />
              <div className="flex-1">
                <p className="text-sm font-semibold">{t.title}</p>
                {t.body && <p className="mt-0.5 text-xs text-muted">{t.body}</p>}
              </div>
              <button onClick={() => drop(t.id)} aria-label="Dismiss" className="shrink-0 text-muted hover:text-foreground"><X size={15} /></button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
