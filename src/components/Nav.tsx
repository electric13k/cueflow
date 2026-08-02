import { Link, useLocation } from "react-router-dom";
import { Button } from "../ui";
import { Github, Music } from "lucide-react";
import AuthButton from "./AuthButton";

export default function Nav() {
  const { pathname } = useLocation();
  const link = (to: string) => ({ variant: pathname === to ? "flat" : "light", color: pathname === to ? "primary" : "default" } as const);
  return (
    <nav className="sticky top-0 z-30 border-b border-white/10 bg-background/60 backdrop-blur-2xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-accent text-accent-foreground shadow-md shadow-accent/30"><Music size={17} /></div>
          <span className="text-lg font-black tracking-tight">CueFlow</span>
        </Link>
        <div className="flex min-w-0 items-center gap-0.5 sm:gap-1">
          <Button href="/" size="sm" {...link("/")}>Home</Button>
          <Button href="/studio" size="sm" {...link("/studio")}>Studio</Button>
          <AuthButton />
          {/* Repo link is a nicety — drop it before the nav starts wrapping on phones. */}
          <Button as="a" href="https://github.com/electric13k/cueflow" target="_blank" size="sm" variant="light" isIconOnly aria-label="GitHub" className="hidden sm:inline-flex"><Github size={17} /></Button>
        </div>
      </div>
    </nav>
  );
}
