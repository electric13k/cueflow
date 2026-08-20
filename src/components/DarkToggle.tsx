import type { ReactNode } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "../ui";
import { themeClass, useStudioTheme } from "../lib/theme";

/**
 * The dark switch for the working interface. The same device setting is shared by the Studio, the
 * show manager, Settings, and the document root so portal content follows it too.
 *
 * The stage remains structural: `[data-stage]` is a literal black in the stylesheet at a specificity
 * no theme scope competes with, so the audience output stays black in either app theme.
 */
export default function DarkToggle({ className = "" }: { className?: string }) {
  const [theme, set] = useStudioTheme();
  const dark = theme === "dark";
  return (
    <Button isIconOnly size="sm" variant="light" className={className}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      onPress={() => set(dark ? "light" : "dark")}>
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </Button>
  );
}

/**
 * The working surface still paints `bg-background` itself so nested wrappers remain correct when
 * a surface is rendered inside the globally themed document.
 */
export function WorkSurface({ className = "", children }: { className?: string; children: ReactNode }) {
  const [theme] = useStudioTheme();
  return <div className={`${themeClass(theme)} bg-background text-foreground ${className}`}>{children}</div>;
}
