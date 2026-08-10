import { useRef, useState } from "react";
import { Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import Backdrop from "./Backdrop";
import Nav from "./Nav";
import Sidebar from "./Sidebar";
import { SiteFooter } from "./Page";
import { Button } from "../ui";
import { local } from "../lib/store";

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
  // ponytail: collapse hides the panel outright. An icon rail is the upgrade if anyone misses it.
  const [collapsed, setCollapsed] = useState(() => local.get("sidebar:collapsed", false));
  const collapse = (v: boolean) => { setCollapsed(v); local.set("sidebar:collapsed", v); };
  const fromEdge = useSwipe(dx => { if (dx > 0) setOpen(true); });
  const onDrawer = useSwipe(dx => { if (dx < 0) setOpen(false); });

  return (
    <div className="relative min-h-screen">
      <Backdrop />
      <Nav inShell />
      <div className="mx-auto flex max-w-7xl gap-6 px-4 sm:px-6 lg:px-8">
        {!collapsed && (
          <aside className="sticky top-20 hidden h-[calc(100vh-6rem)] w-60 shrink-0 lg:block">
            {/* The scroll lives on the inner element: the panel's bevel and highlight are absolutely
                positioned, and in a scroll container those scroll away with the content. */}
            <div className="glass h-full overflow-hidden"><div className="h-full overflow-y-auto"><Sidebar /></div></div>
          </aside>
        )}
        {/* Swipe in from the left edge, the gesture every phone already teaches for a drawer. It is a
            shortcut and never the only way in: the Menu button below does the same thing, and a
            24px strip is narrow enough that nothing under it loses its own taps. */}
        {!open && <div aria-hidden className="fixed inset-y-0 left-0 z-20 w-6 lg:hidden" {...fromEdge} />}
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button aria-label="Close menu" className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
            <div {...onDrawer}
              style={{ ...onDrawer.style, paddingTop: "var(--safe-t)", paddingBottom: "var(--safe-b)" }}
              className="absolute inset-y-0 left-0 w-72 overflow-y-auto border-r border-white/10 bg-background">
              <div className="flex justify-end p-2"><Button isIconOnly size="sm" variant="light" aria-label="Close" onPress={() => setOpen(false)}><X size={16} /></Button></div>
              <Sidebar onNavigate={() => setOpen(false)} />
            </div>
          </div>
        )}
        <main className={`min-w-0 flex-1 py-8 ${width}`}>
          <div className="mb-4 flex items-center gap-2">
            <Button className="lg:hidden" size="sm" variant="bordered" startContent={<Menu size={15} />} onPress={() => setOpen(true)}>Menu</Button>
            <Button className="hidden lg:inline-flex" size="sm" variant="light" isIconOnly
              aria-label={collapsed ? "Show sidebar" : "Hide sidebar"} onPress={() => collapse(!collapsed)}>
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </Button>
          </div>
          {children}
        </main>
      </div>
      <SiteFooter />
    </div>
  );
}
