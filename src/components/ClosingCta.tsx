import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../ui";

/**
 * The band at the foot of a marketing page: a line, and the one way in.
 *
 * It was written out three times -- Home, Features and Tutorial -- in three slightly different
 * spellings, which is three places to fix a wording change and three chances for one of them to
 * drift. The eyebrow, the heading and anything extra beside the button are the only parts that ever
 * actually differed.
 */
export default function ClosingCta({ eyebrow, title, note, children, cta = "Open the Studio", href = "/studio" }: {
  eyebrow?: string;
  title: string;
  note?: string;
  /** Extra controls that sit beside the main button, as the tutorial's "show the tips again" does. */
  children?: ReactNode;
  cta?: string;
  href?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-70px" }} transition={{ duration: .55, ease: [.16, 1, .3, 1] }}
      className="glass mt-16 flex flex-wrap items-center justify-between gap-5 p-8 sm:p-10">
      <div>
        {eyebrow && <p className="font-mono text-[11px] uppercase tracking-[.3em] text-brass">{eyebrow}</p>}
        <h2 className={`text-3xl font-bold sm:text-4xl ${eyebrow ? "mt-3" : ""}`}>{title}</h2>
        {note && <p className="mt-2 text-muted">{note}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        <Button href={href} color="primary" size="lg" endContent={<ArrowRight size={18} aria-hidden />} className="cue-ribbon-hitbox font-semibold">{cta}</Button>
      </div>
    </motion.div>
  );
}
