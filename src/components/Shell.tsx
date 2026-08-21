import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import Backdrop from "./Backdrop";
import Nav from "./Nav";
import Sidebar from "./Sidebar";
import { SiteFooter } from "./Page";
import { Button } from "../ui";
import { useLayout } from "../lib/layout";

/**
 * The chrome every working page wears: hierarchy down the left, the site footer underneath so no
 * route is a dead end. On a phone the sidebar is a drawer, not a squeeze.
 *
 * Marketing pages keep the plain `Page`, an advert does not need a file tree.
 */
/** px of horizontal travel that counts as a swipe rather than a fidget. */
const SWIPE = 56;

/**
 * Swipe, as three handlers and no listener bookkeeping.
 *
 * `src/lib/dragList.ts` has to add a non-passive `touchmove` and call preventDefault, because it
 * lifts a row out of a list the browser has already started scrolling and `touch-action` cannot
 * revoke a scroll already granted. Nothing here is mid-scroll, so the gesture is claimed the cheap
 * way instead: `touch-action: pan-y` on the two elements below says a vertical drag is still the
 * page's and a horizontal one is ours, which is the whole contract. Without it the browser keeps
 * both and the drawer never opens.
 *
 * Pointer capture on the way down, because the finger leaves a 24px edge strip long before it lifts
 * and `pointerup` would otherwise be delivered to whatever it landed on.
 */
function useSwipe(onSwipe: (dx: number) => void) {
  const from = useRef<{ x: number; y: number } | null>(null);
  return {
    style: { touchAction: "pan-y" as const },
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") return; // a mouse has the button, it does not need the gesture
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* already released */ }
      from.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: React.PointerEvent) => {
      const start = from.current;
      from.current = null;
      if (!start) return;
      const dx = e.clientX - start.x;
      // A diagonal is someone scrolling with a wobble. Only a mostly horizontal travel counts.
      if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(e.clientY - start.y) * 1.5) onSwipe(dx);
    },
    onPointerCancel: () => { from.current = null; },
  };
}

export default function Shell({ children, width = "" }: { children: React.ReactNode; width?: string }) {
  const [open, setOpen] = useState(false);
  // The panel button is a shortcut into the same setting Settings offers, not a second one: it
  // toggles between the two states someone reaches for mid-work and leaves `wide` to the picker.
  const [{ pane }, setLayout] = useLayout();
  const collapsed = pane === "focus";
  const fromEdge = useSwipe(dx => { if (dx > 0) setOpen(true); });
  const onDrawer = useSwipe(dx => { if (dx < 0) setOpen(false); });

  return (
    // data-app marks a working screen. The stylesheet reads it to switch off the pointer-tracked
    // highlight on panels: decoration belongs on the pages that are selling the thing, not on the
    // one somebody is running a show from.
    <div data-app className="relative min-h-screen">
      <Backdrop />
      <Nav inShell />
      <motion.div layout className={`mx-auto flex gap-6 px-4 sm:px-6 lg:px-8 ${pane === "wide" ? "max-w-none" : "max-w-7xl"}`}>
        <AnimatePresence initial={false} mode="popLayout">
          {!collapsed && (
            <motion.aside
              key="desktop-sidebar"
              data-cue-menu="desktop-sidebar"
              layout="position"
              initial={{ opacity: 0, x: -14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -14 }}
              transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
              className="sticky top-20 hidden h-[calc(100vh-6rem)] w-60 shrink-0 lg:block"
            >
              {/* The scroll lives on the inner element: the panel's bevel and highlight are absolutely
                  positioned, and in a scroll container those scroll away with the content. */}
              <div className="glass h-full overflow-hidden"><div className="h-full overflow-y-auto"><Sidebar /></div></div>
            </motion.aside>
          )}
        </AnimatePresence>
        {/* Swipe in from the left edge, the gesture every phone already teaches for a drawer. It is a
            shortcut and never the only way in: the Menu button below does the same thing, and a
            24px strip is narrow enough that nothing under it loses its own taps. */}
        {!open && <div aria-hidden className="fixed inset-y-0 left-0 z-20 w-6 lg:hidden" {...fromEdge} />}
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="mobile-drawer"
              className="fixed inset-0 z-40 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            >
              <motion.button
                aria-label="Close menu"
                data-cue-menu="scrim"
                className="absolute inset-0 bg-black/60"
                onClick={() => setOpen(false)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              />
              <motion.aside
                {...onDrawer}
                data-cue-menu="drawer"
                id="workspace-menu"
                aria-label="Workspace menu"
                style={{ ...onDrawer.style, paddingTop: "var(--safe-t)", paddingBottom: "var(--safe-b)" }}
                initial={{ opacity: 0, x: -24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.26, ease: [0.23, 1, 0.32, 1] }}
                className="absolute inset-y-0 left-0 w-72 overflow-y-auto border-r border-white/10 bg-background shadow-2xl shadow-black/30"
              >
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ delay: 0.08, duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                >
                  <div className="flex justify-end p-2"><Button isIconOnly size="sm" variant="light" aria-label="Close" onPress={() => setOpen(false)}><X size={16} /></Button></div>
                  <Sidebar onNavigate={() => setOpen(false)} />
                </motion.div>
              </motion.aside>
            </motion.div>
          )}
        </AnimatePresence>
        <motion.main
          layout="position"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
          className={`min-w-0 flex-1 py-8 ${width}`}
        >
          <div className="mb-4 flex items-center gap-2">
            {/* min-h-11 on a phone: at `size="sm"` this was a 36px target, under the 44px minimum,
                and it is the only way to the rest of the app on a small screen. */}
            <Button className="min-h-11 lg:hidden" size="sm" variant="bordered" startContent={<Menu size={15} />} aria-expanded={open} aria-controls="workspace-menu" onPress={() => setOpen(true)}>Menu</Button>
            <Button className="hidden lg:inline-flex" size="sm" variant="light" isIconOnly
              aria-label={collapsed ? "Show sidebar" : "Hide sidebar"} onPress={() => setLayout({ pane: collapsed ? "panel" : "focus" })}>
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </Button>
          </div>
          {children}
        </motion.main>
      </motion.div>
      <SiteFooter />
    </div>
  );
}
