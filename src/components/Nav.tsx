import { Link, useLocation } from "react-router-dom";
import { Button } from "../ui";
import { Github } from "lucide-react";
import LogoMark from "./LogoMark";
import DarkToggle from "./DarkToggle";
import AuthButton from "./AuthButton";
import { useSignedIn } from "./RequireAuth";

/**
 * Logo, Home, Features, one working destination, the account control, GitHub.
 *
 * The bar is for arriving; the sidebar is for working. It carries exactly one working destination,
 * and which one that is depends on who is looking: signed out it is the **Studio**, because that is
 * the whole app a visitor is entitled to, and signed in it is the **Workspace**. Inside the Shell it
 * carries neither, because the sidebar already owns them.
 *
 * That rule supersedes the old "exactly seven items" one (plan.md §3.3): a fixed count could not
 * survive an item that appears for some people and not others, and it left Nav and Shell
 * contradicting each other in the code.
 *
 * The public pages share the same persisted theme as the working interface, so visitors can choose
 * a comfortable reading mode without leaving the page.
 */
export default function Nav({ inShell }: { inShell?: boolean }) {
  const { pathname } = useLocation();
  const signedIn = useSignedIn();
  // Pending reads as signed out: the Studio is a live link for everyone, so the worst case is a
  // label that settles a beat later, not a link that goes nowhere.
  const work = signedIn ? { to: "/workspace", label: "Workspace" } : { to: "/studio", label: "Studio" };
  const link = (to: string) => ({ variant: pathname === to ? "flat" : "light", color: pathname === to ? "primary" : "default" } as const);
  return (
    <nav className="sticky top-0 z-30 border-b border-white/10 bg-background/60 backdrop-blur-2xl">
      {/* The bar's height is `--nav-h` rather than whatever the tallest control happens to make it,
          because the toaster and the drawer are fixed elements outside this tree that have to clear
          it. Padding stays for the notch: viewport-fit=cover puts the status bar inside the page. */}
      <div style={{ minHeight: "calc(var(--nav-h) + var(--safe-t))", paddingTop: "var(--safe-t)" }}
        className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-2">
          <LogoMark size={44} />
          <span className="font-display text-xl font-bold tracking-tight">CueFlow</span>
        </Link>
        <div className="flex min-w-0 items-center gap-0.5 sm:gap-1">
          <Button href="/" size="sm" {...link("/")}>Home</Button>
          <Button href="/features" size="sm" {...link("/features")} className="hidden sm:inline-flex">Features</Button>
          {/* Inside the Shell the sidebar already owns this, so the bar does not repeat it. */}
          {!inShell && <Button data-tour="nav-work" href={work.to} size="sm" {...link(work.to)}>{work.label}</Button>}
          <DarkToggle className="inline-flex" />
          <AuthButton />
          {/* Repo link is a nicety, drop it before the nav starts wrapping on phones. */}
          <Button as="a" href="https://github.com/electric13k/cueflow" target="_blank" size="sm" variant="light" isIconOnly aria-label="GitHub" className="hidden sm:inline-flex"><Github size={17} /></Button>
        </div>
      </div>
    </nav>
  );
}
