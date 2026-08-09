import { useState } from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";

export type Screen = { shot: string; alt: string; title: string; body: string; points: string[]; fit?: "cover" | "contain" };

const fade = (d = 0) => ({ initial: { opacity: 0, y: 22 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-80px" }, transition: { duration: .5, delay: d } });

/** Flip card: the screenshot on the front, what it does on the back. */
export default function ScreenCard({ shot, alt, title, body, points, fit = "cover", delay = 0 }: Screen & { delay?: number }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <motion.div {...fade(delay)} style={{ perspective: "1400px" }}>
      <button
        onClick={() => setFlipped(f => !f)}
        aria-label={`${title}, flip for details`}
        aria-pressed={flipped}
        className="group relative block h-[24rem] w-full text-left transition-transform duration-500 ease-out"
        style={{ transformStyle: "preserve-3d", transform: flipped ? "rotateY(180deg)" : "none" }}
      >
        <span className="glass glass-hover absolute inset-0 flex flex-col overflow-hidden p-2" style={{ backfaceVisibility: "hidden" }}>
          <img src={shot} alt={alt} loading="lazy" className={`min-h-0 flex-1 rounded-2xl bg-black/30 object-top ${fit === "contain" ? "object-contain" : "object-cover"}`} />
          <span className="flex items-center justify-between px-2 py-2 text-sm font-bold">
            {title}
            <span className="text-xs font-medium text-muted">Flip →</span>
          </span>
        </span>
        <span
          className="glass absolute inset-0 flex flex-col justify-center gap-3 border-accent/25 p-6"
          style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
        >
          <h3 className="text-xl font-black tracking-tight">{title}</h3>
          <p className="text-sm text-muted">{body}</p>
          <ul className="mt-1 space-y-2">
            {points.map(p => (
              <li key={p} className="flex gap-2 text-sm">
                <Check size={15} className="mt-0.5 shrink-0 text-accent" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
          <span className="mt-2 text-xs text-muted">← Flip back</span>
        </span>
      </button>
    </motion.div>
  );
}
