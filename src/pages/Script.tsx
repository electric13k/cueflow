import { useEffect, useState } from "react";
import ScriptReader, { AlertFlash } from "../components/ScriptReader";
import { listen, send } from "../lib/bus";
import { emptyDoc, loadScript, type ScriptDoc } from "../lib/script";

/**
 * The script on its own, for the popup and the new-tab modes. Deliberately not wrapped in the site
 * chrome: someone reading this is reading it, not browsing.
 *
 * It talks to the Studio over the same BroadcastChannel the audience window uses, so an alert raised
 * here flashes the control screen as well, and one raised there flashes here.
 */
export default function Script() {
  const [doc, setDoc] = useState<ScriptDoc>(() => (typeof localStorage === "undefined" ? emptyDoc() : loadScript()));
  const [flash, setFlash] = useState<"warn" | "hit" | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => listen(msg => {
    if (msg.type === "script") setDoc(loadScript());
    if (msg.type === "alert") {
      setNote(msg.message);
      setFlash(msg.level);
      setTimeout(() => setFlash(null), msg.level === "hit" ? 1600 : 1100);
    }
  }), []);

  return (
    <div className="flex h-screen flex-col gap-3 bg-background p-4 text-foreground">
      <AlertFlash level={flash} />
      <div className="flex items-baseline gap-3">
        <h1 className="text-lg font-black tracking-tight">{doc.name || "Script"}</h1>
        <span className="text-xs text-muted">{note}</span>
      </div>
      <div className="min-h-0 flex-1">
        <ScriptReader doc={doc} setDoc={setDoc} onAlert={(level, message, cue) => send({ type: "alert", level, message, cue })} />
      </div>
    </div>
  );
}
