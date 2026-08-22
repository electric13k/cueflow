import { useEffect, useState } from "react";
import ScriptReader, { AlertFlash } from "../components/ScriptReader";
import Shell from "../components/Shell";
import { listen, send } from "../lib/bus";
import { emptyDoc, loadScript, type ScriptDoc } from "../lib/script";
import { loadAlertScope, type AlertScope } from "../lib/alerts";

/**
 * The script on its own. Opened from the Studio (popup or new tab) it wears no chrome, someone
 * reading this is reading it, not browsing. Reached by a link from the workspace it wears the
 * Shell, because a route with no way out is a dead end.
 *
 * It talks to the Studio over the same BroadcastChannel the audience window uses, so an alert raised
 * here flashes the control screen as well, and one raised there flashes here.
 */
export default function Script() {
  const [doc, setDoc] = useState<ScriptDoc>(() => (typeof localStorage === "undefined" ? emptyDoc() : loadScript()));
  const [flash, setFlash] = useState<"warn" | "hit" | null>(null);
  const [note, setNote] = useState("");
  const [alertScope, setAlertScope] = useState<AlertScope>(() => loadAlertScope());

  useEffect(() => {
    const syncScope = () => setAlertScope(loadAlertScope());
    window.addEventListener("cueflow:alert-scope", syncScope);
    return () => window.removeEventListener("cueflow:alert-scope", syncScope);
  }, []);

  useEffect(() => listen(msg => {
    if (msg.type === "script") setDoc(loadScript());
    if (msg.type === "alert") {
      setNote(msg.message);
      setFlash(msg.level);
      setTimeout(() => setFlash(null), msg.level === "hit" ? 1600 : 1100);
    }
  }), []);

  // window.open sets an opener; a <Link> from the workspace does not. That is the whole test.
  const bare = typeof window !== "undefined" && window.opener !== null;

  const body = (
    <div className={bare ? "relative flex h-screen flex-col gap-3 bg-background p-4 text-foreground" : "relative flex h-[78vh] flex-col gap-3"}>
      {alertScope === "script" && <AlertFlash level={flash} scope="script" />}
      <div className="flex items-baseline gap-3">
        <h1 className="text-lg font-black tracking-tight">{doc.name || "Script"}</h1>
        <span className="text-xs text-muted">{note}</span>
      </div>
      <div className="min-h-0 flex-1">
        <ScriptReader doc={doc} setDoc={setDoc} alertScope={alertScope} onAlert={(level, message, cue) => send({ type: "alert", level, message, cue })} />
      </div>
    </div>
  );

  return bare ? body : <Shell>{body}</Shell>;
}
