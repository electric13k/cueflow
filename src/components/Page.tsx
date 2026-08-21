import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import Backdrop from "./Backdrop";
import LogoMark from "./LogoMark";
import Nav from "./Nav";
import { useSignedIn } from "./RequireAuth";

/**
 * Every page links to every other one; a multipage site with a dead end is just a page. `mine` marks
 * the ones an account owns: those routes do not render without a session (plan.md §8), so listing
 * them to a signed-out visitor would be a link that quietly bounces.
 */
const links = [
  { to: "/", label: "Home" },
  { to: "/features", label: "Features" },
  { to: "/tutorial", label: "Tutorial" },
  { to: "/contact", label: "Contact" },
  { to: "/projects", label: "Projects", mine: true },
  { to: "/show", label: "Join a show", mine: true },
  { to: "/credits", label: "Credits" },
  { to: "/settings", label: "Settings" },
  { to: "/account", label: "Account", mine: true },
  { to: "/terms", label: "Terms" },
  { to: "/privacy", label: "Privacy" },
];

export function SiteFooter() {
  const signedIn = useSignedIn();
  const shown = signedIn ? links : links.filter(l => !l.mine);
  return (
    <footer className="border-t border-white/10 py-8">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 text-sm text-muted sm:px-6 lg:px-8">
        <span className="flex items-center gap-2"><LogoMark size={24} /> CueFlow</span>
        <span className="flex flex-wrap items-center gap-4">
          {/* min-h-6 so a footer link clears the 24px minimum tap target on a phone; at 20px they failed it. */}
          {shown.map(l => <Link key={l.to} to={l.to} className="link-rule inline-flex min-h-6 items-center hover:text-foreground">{l.label}</Link>)}
          <Link to="/studio" className="link-rule inline-flex min-h-6 items-center font-semibold text-accent">Open Studio →</Link>
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
      {/* Marketing only: `Page` is what the public pages wear and `Shell` is what the working ones
          wear, so this never appears over a cue board. Sits directly under the bar, which is why it
          reads off the same --nav-h the bar sizes itself from. */}
      <div aria-hidden className="scroll-progress fixed inset-x-0 z-40 h-[2px] origin-left bg-accent"
        style={{ top: "calc(var(--nav-h) + var(--safe-t))" }} />
      <motion.main
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
        className={`mx-auto ${width} px-4 py-12 sm:px-6 lg:px-8`}
      >{children}</motion.main>
      <SiteFooter />
    </div>
  );
}
