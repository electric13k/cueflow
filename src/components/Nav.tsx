import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button, Tooltip } from "../ui";
import { Github, Moon, Music, Sun } from "lucide-react";
import AuthButton from "./AuthButton";
import { applyTheme, getTheme } from "../lib/theme";

export default function Nav() {
  const { pathname } = useLocation();
  const [theme, setTheme] = useState(getTheme);
  const flip = () => { const next = theme === "dark" ? "light" : "dark"; applyTheme(next); setTheme(next); };
  const link = (to: string) => ({ variant: pathname === to ? "flat" : "light", color: pathname === to ? "primary" : "default" } as const);
  return (
    <nav className="sticky top-0 z-30 border-b border-white/10 bg-background/60 backdrop-blur-2xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-accent text-accent-foreground"><Music size={17} /></div>
          <span className="font-display text-xl font-bold tracking-tight">CueFloww</span>
        </Link>
        <div className="flex min-w-0 items-center gap-0.5 sm:gap-1">
          <Button href="/" size="sm" {...link("/")}>Home</Button>
          <Button href="/workspace" size="sm" {...link("/workspace")}>Workspace</Button>
          <Button href="/studio" size="sm" {...link("/studio")}>Studio</Button>
          <Button href="/features" size="sm" {...link("/features")} className="hidden md:inline-flex">Features</Button>
          <Button href="/tutorial" size="sm" {...link("/tutorial")} className="hidden sm:inline-flex">Tutorial</Button>
          <Button href="/contact" size="sm" {...link("/contact")} className="hidden lg:inline-flex">Contact</Button>
          <Tooltip content={theme === "dark" ? "Switch to light" : "Switch to dark"}>
            <Button size="sm" variant="light" isIconOnly aria-label="Toggle colour theme" onPress={flip}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</Button>
          </Tooltip>
          <AuthButton />
          {/* Repo link is a nicety, drop it before the nav starts wrapping on phones. */}
          <Button as="a" href="https://github.com/electric13k/cueflow" target="_blank" size="sm" variant="light" isIconOnly aria-label="GitHub" className="hidden sm:inline-flex"><Github size={17} /></Button>
        </div>
      </div>
    </nav>
  );
}
