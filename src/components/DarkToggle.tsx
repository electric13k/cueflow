import type { ReactNode } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "../ui";
import { themeClass, useStudioTheme } from "../lib/theme";

/**
 * The dark switch for a working surface, and the wrapper it switches.
 *
 * Dark is not a mode any more: it is a class on a container, so what darkens is the desk you are
 * working at and nothing else. Every role gets the button, host or not, because the person on
 * followspot is standing in the same blackout the host is.
 *
 * Two things it deliberately does not reach. The page around it, because §14 made beige the app's
 * only global look. And the stage: `[data-stage]` is a literal black in the stylesheet at a
 * specificity no scope competes with, so no wrapper above it can brighten what the room sees.
 */
export default function DarkToggle({ className = "" }: { className?: string }) {
  const [theme, set] = useStudioTheme();
  const dark = theme === "dark";
  return (
    <Button isIconOnly size="sm" variant="light" className={className}
      aria-label={dark ? "Light control screen" : "Dark control screen"}
      title={dark ? "Back to the light control screen" : "Dark control screen, this device only"}
      onPress={() => set(dark ? "light" : "dark")}>
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </Button>
  );
}

/**
 * The surface the toggle acts on. It has to paint `bg-background` itself: the tokens inherit, so a
 * scope that only re-declared them would put pale dark-theme text on the beige page behind it.
 */
export function WorkSurface({ className = "", children }: { className?: string; children: ReactNode }) {
  const [theme] = useStudioTheme();
  return <div className={`${themeClass(theme)} bg-background text-foreground ${className}`}>{children}</div>;
}
