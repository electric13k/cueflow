import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Music } from "lucide-react";
import Backdrop from "./Backdrop";
import Nav from "./Nav";

/** Every page links to every other one; a multipage site with a dead end is just a page. */
const links = [
  { to: "/", label: "Home" },
  { to: "/features", label: "Features" },
  { to: "/tutorial", label: "Tutorial" },
  { to: "/contact", label: "Contact" },
  { to: "/terms", label: "Terms" },
  { to: "/privacy", label: "Privacy" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 py-8">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 text-sm text-muted sm:px-6 lg:px-8">
        <span className="flex items-center gap-2"><Music size={14} /> CueFloww</span>
        <span className="flex flex-wrap items-center gap-4">
          {links.map(l => <Link key={l.to} to={l.to} className="hover:text-foreground">{l.label}</Link>)}
          <Link to="/studio" className="font-semibold text-accent">Open Studio →</Link>
        </span>
      </div>
    </footer>
  );
}

/** Section heading + body used across the legal pages. */
export function Section({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-7 scroll-mt-20">
      <h3 className="text-base font-bold">{title}</h3>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

export default function Page({ children, width = "max-w-7xl" }: { children: ReactNode; width?: string }) {
  return (
    <div className="relative min-h-screen">
      <Backdrop />
      <Nav />
      <main className={`mx-auto ${width} px-4 py-12 sm:px-6 lg:px-8`}>{children}</main>
      <SiteFooter />
    </div>
  );
}
