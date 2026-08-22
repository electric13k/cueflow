import { useEffect, useState } from "react";
import { Button, Switch } from "../ui";
import { Bell, Cookie, GraduationCap, Keyboard, LayoutGrid, Palette, RotateCcw } from "lucide-react";
import Shell from "../components/Shell";
import { startTour } from "../components/Tour";
import KeybindRow from "../components/KeybindRow";
import { clashes, defaultBinds, keyActions, loadBinds, saveBinds, type Action } from "../lib/keys";
import { useStudioTheme } from "../lib/theme";
import { useLayout } from "../lib/layout";
import { emptyDoc, loadScript, saveScript, type ScriptDoc } from "../lib/script";
import { loadAlertScope, saveAlertScope, type AlertScope } from "../lib/alerts";
import { getConsent, saveConsent, type ConsentState } from "../lib/cookies";
import { loadDemo } from "../lib/demo";

export default function Settings() {
  const [binds, setBinds] = useState<Record<Action, string>>(loadBinds);
  // The same device setting is shared by the Studio, the show manager, and the rest of the app.
  // Keeping one source of truth also themes portal-rendered menus and dialogs.
  const [theme, setTheme] = useStudioTheme();
  const [layout, setLayout] = useLayout();
  const [doc, setDoc] = useState<ScriptDoc>(() => (typeof localStorage === "undefined" ? emptyDoc() : loadScript()));
  const [alertScope, setAlertScope] = useState<AlertScope>(() => loadAlertScope());
  const [consent, setConsent] = useState<ConsentState>(() => getConsent());
  const bad = clashes(binds);

  useEffect(() => {
    const syncConsent = () => setConsent(getConsent());
    window.addEventListener("cueflow:consent", syncConsent);
    return () => window.removeEventListener("cueflow:consent", syncConsent);
  }, []);

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
            <Switch isSelected={theme === "dark"} onValueChange={v => setTheme(v ? "dark" : "light")}>Dark mode</Switch>
            <p className="mt-1 text-xs text-muted">
              This device only. It covers the app chrome and working surfaces, nobody else in the show
              sees it, and what the audience sees is black either way.
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

      <section className="glass mt-6 p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-xl font-black tracking-tight"><Bell size={18} className="text-accent" />Alerts</h2>
        <p className="mt-2 text-sm text-muted">Choose where script cue warnings appear. The audience view is never covered by operator alerts.</p>
        <div className="mt-4">
          <Choice label="Alert surface" value={alertScope} onChange={scope => { setAlertScope(scope); saveAlertScope(scope); }}
            options={[
              { id: "script", label: "Script only", note: "Keep the red and yellow edge treatments inside the script reader or script window." },
              { id: "operator", label: "Operator surface", note: "Cover the Cueflow control surface while leaving the audience view untouched." },
            ]} />
        </div>
      </section>

      <section className="glass mt-6 p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-xl font-black tracking-tight"><Cookie size={18} className="text-accent" />Cookies and analytics</h2>
        <p className="mt-2 text-sm text-muted">Necessary storage keeps Cueflow working. Optional analytics is off unless you choose to allow it, and you can change this choice later.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Switch isSelected={consent.analytics === "accepted"} onValueChange={allowed => { const next = { analytics: allowed ? "accepted" : "declined" } as ConsentState; setConsent(next); saveConsent(next); }}>
            Allow optional analytics
          </Switch>
          <span className="text-xs text-muted">Current choice: {consent.analytics === "accepted" ? "allowed" : consent.analytics === "declined" ? "only necessary" : "not chosen"}</span>
        </div>
        <p className="mt-3 text-xs text-muted">Analytics is intended for aggregated route, feature, performance, and error signals. It does not need script contents, media files, passwords, access tokens, or private project data.</p>
        <p className="mt-3 text-xs text-muted"><a href={`${import.meta.env.BASE_URL}cookies`} className="text-accent underline-offset-2 hover:underline">Read the Cookies policy</a></p>
      </section>

      <section className="glass mt-6 p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-xl font-black tracking-tight"><LayoutGrid size={18} className="text-accent" />Layout</h2>
        <p className="mt-2 text-sm text-muted">A phone and a desk are not asking the same question, so they get one setting each.</p>
        <div className="mt-5 space-y-6">
          <Choice label="On a computer" value={layout.pane} onChange={pane => setLayout({ pane })}
            options={[
              { id: "panel", label: "Panel", note: "The workspace list on the left, the page kept to a readable width." },
              { id: "wide", label: "Wide", note: "The list stays and the width cap comes off, for a cue board on a big monitor." },
              { id: "focus", label: "Focus", note: "No panel. The Menu button still opens it when you want it." },
            ]} />
          <Choice label="On a phone" value={layout.density} onChange={density => setLayout({ density })}
            options={[
              { id: "comfy", label: "Comfy", note: "One card per row, every label on show." },
              { id: "compact", label: "Compact", note: "Two cards per row. More of the deck at once, smaller titles." },
            ]} />
        </div>
      </section>

      <section className="glass mt-6 p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-xl font-black tracking-tight"><GraduationCap size={18} className="text-accent" />Tutorial</h2>
        <p className="mt-2 text-sm text-muted">
          It walks you through building a deck and firing a cue, on a board it fills with demo sounds, pictures
          and a script. That material is cleared when you reach the end, and nothing you made yourself goes with it.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button className="min-h-11" size="sm" variant="flat" startContent={<GraduationCap size={14} />}
            onPress={startTour}>Run the tutorial again</Button>
          <Button className="min-h-11" size="sm" variant="bordered" startContent={<RotateCcw size={14} />}
            onPress={() => { loadDemo(); window.location.reload(); }}>Restore demo resources</Button>
        </div>
      </section>
    </Shell>
  );
}

/** A segmented control. Radios in a row, because the choice is small enough to show whole. */
function Choice<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { id: T; label: string; note: string }[];
  onChange: (id: T) => void;
}) {
  return (
    <div>
      <p className="text-sm font-semibold">{label}</p>
      {/* min-h-11 is 44px: this is a control someone sets on the device it describes. */}
      <div role="radiogroup" aria-label={label} className="mt-2 flex flex-wrap gap-1.5">
        {options.map(o => (
          <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}
            className={`min-h-11 rounded-md border px-4 text-sm transition-colors ${
              value === o.id ? "border-accent bg-accent/12 font-semibold text-foreground" : "border-white/15 text-muted hover:text-foreground"}`}>
            {o.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">{options.find(o => o.id === value)?.note}</p>
    </div>
  );
}
