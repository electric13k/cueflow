import { useState } from "react";
import { keyLabel } from "../lib/keys";

/** Click the box, press a key, that is the bind. Escape backs out without changing anything. */
export default function KeybindRow({ label, value, clash, onSet }: {
  label: string; value: string; clash?: boolean; onSet: (k: string) => void;
}) {
  const [listening, setListening] = useState(false);
  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${clash ? "border-live/50 bg-live/10" : "border-white/10 bg-white/[.03]"}`}>
      <span className="text-sm">{label}{clash && <span className="ml-2 text-xs text-live">shared with another action</span>}</span>
      <button
        className={`min-w-24 rounded-lg border px-3 py-1.5 font-mono text-sm ${listening ? "border-accent bg-accent/15 text-accent" : "border-white/15 bg-white/5"}`}
        onClick={() => setListening(true)} onBlur={() => setListening(false)}
        onKeyDown={e => { if (!listening) return; e.preventDefault(); if (e.key === "Escape") return setListening(false); onSet(e.key); setListening(false); }}
      >{listening ? "Press a key…" : keyLabel(value)}</button>
    </div>
  );
}
