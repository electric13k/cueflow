import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

export default function CurtainTransition({ open, label = "Show starting" }: { open: boolean; label?: string }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          aria-label={label}
          role="status"
          className="curtain-transition pointer-events-none fixed inset-0 z-[100] overflow-hidden"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.18 : 1.15, delay: reduced ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          <motion.div
            aria-hidden
            className="curtain-panel curtain-panel-left absolute inset-y-0 left-0 w-1/2 origin-left"
            initial={{ x: 0 }}
            animate={{ x: reduced ? "-100%" : "-94%" }}
            exit={{ x: "-100%" }}
            transition={{ duration: reduced ? 0.14 : 0.92, delay: reduced ? 0 : 0.08, ease: [0.16, 1, 0.3, 1] }}
          />
          <motion.div
            aria-hidden
            className="curtain-panel curtain-panel-right absolute inset-y-0 right-0 w-1/2 origin-right"
            initial={{ x: 0 }}
            animate={{ x: reduced ? "100%" : "94%" }}
            exit={{ x: "100%" }}
            transition={{ duration: reduced ? 0.14 : 0.92, delay: reduced ? 0 : 0.08, ease: [0.16, 1, 0.3, 1] }}
          />
          <motion.span
            aria-hidden
            className="curtain-seam absolute left-1/2 top-0 h-full w-px -translate-x-1/2"
            initial={{ opacity: 1, scaleY: 1 }}
            animate={{ opacity: 0, scaleY: 0.72 }}
            transition={{ duration: reduced ? 0.12 : 0.48, delay: reduced ? 0 : 0.16, ease: "easeOut" }}
          />
          <span className="sr-only">{label}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
