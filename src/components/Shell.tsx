import { useState } from "react";
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
 * Marketing pages keep the plain `Page` — an advert does not need a file tree.
 */
export default function Shell({ children, width = "" }: { children: React.ReactNode; width?: string }) {
  const [open, setOpen] = useState(false);
  // ponytail: collapse hides the panel outright. An icon rail is the upgrade if anyone misses it.
  const [collapsed, setCollapsed] = useState(() => local.get("sidebar:collapsed", false));
  const collapse = (v: boolean) => { setCollapsed(v); local.set("sidebar:collapsed", v); };

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
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button aria-label="Close menu" className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-72 overflow-y-auto border-r border-white/10 bg-background">
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
