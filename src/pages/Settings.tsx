import { useEffect, useState } from "react";
import { Button, Switch } from "../ui";
import { Keyboard, Palette, RotateCcw } from "lucide-react";
import Shell from "../components/Shell";
import KeybindRow from "../components/KeybindRow";
import { clashes, defaultBinds, keyActions, loadBinds, saveBinds, type Action } from "../lib/keys";
import { useStudioTheme } from "../lib/theme";
import { emptyDoc, loadScript, saveScript, type ScriptDoc } from "../lib/script";

export default function Settings() {
  const [binds, setBinds] = useState<Record<Action, string>>(loadBinds);
  // The same setting the Studio and the show manager toggle, read through the same hook: this
  // switch and those buttons are one value, and flipping either moves the other. It used to call
  // applyTheme, which now writes the scope onto <html> and would take the whole app dark -- and §14
  // says there is no page-wide dark left to take.
  const [theme, setTheme] = useStudioTheme();
  const [doc, setDoc] = useState<ScriptDoc>(() => (typeof localStorage === "undefined" ? emptyDoc() : loadScript()));
  const bad = clashes(binds);

  useEffect(() => { saveBinds(binds); }, [binds]);

  return (
    <Shell width="max-w-3xl">
      <p className="text-[11px] font-semibold uppercase tracking-[.3em] text-accent">Settings</p>
      <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">How it behaves</h1>
      <p className="mt-2 text-sm text-muted">These stay on this device. They are not tied to your account, so a borrowed laptop keeps its own.</p>

      <section className="glass mt-8 p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-xl font-black tracking-tight"><Keyboard size={18} className="text-accent" />Keybinds</h2>
        <p className="mt-2 text-sm text-muted">
          Click a key box, then press a key. Arrows step every cue; WASD drives whatever is on the stage,
          so slides move without touching the sound underneath.
        </p>
        <div className="mt-5 space-y-2">
          {keyActions.map(a => (
            <KeybindRow key={a.id} label={a.label} value={binds[a.id]} clash={bad.has(a.id)}
              onSet={k => setBinds(b => ({ ...b, [a.id]: k }))} />
          ))}
        </div>
        <Button className="mt-4" size="sm" variant="flat" startContent={<RotateCcw size={14} />} onPress={() => setBinds(defaultBinds)}>Reset to defaults</Button>
      </section>

      <section className="glass mt-6 p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-xl font-black tracking-tight"><Palette size={18} className="text-accent" />Look</h2>
        <div className="mt-4 space-y-4">
          <div>
            <Switch isSelected={theme === "dark"} onValueChange={v => setTheme(v ? "dark" : "light")}>Dark control screen</Switch>
            <p className="mt-1 text-xs text-muted">
              The Studio and the show manager only, and only on this device. The rest of the app stays
              beige, nobody else in the show sees it, and what the audience sees is black either way.
            </p>
          </div>
          <label className="block">
            <span className="text-sm">Warn this far before a script cue word</span>
            <span className="mt-1 flex items-center gap-3">
              <input type="range" min={80} max={800} step={20} value={doc.lookahead}
                onChange={e => { const next = { ...doc, lookahead: Number(e.target.value) }; setDoc(next); saveScript(next); }} />
              <span className="text-sm tabular-nums text-muted">{doc.lookahead}px</span>
            </span>
          </label>
        </div>
      </section>
    </Shell>
  );
}
