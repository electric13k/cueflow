import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Tooltip } from "../ui";
import { Bell, FileUp, Minus, Plus, Trash2 } from "lucide-react";
import { send } from "../lib/bus";
import { emptyDoc, keywordsOf, markKeywords, parseScript, saveScript, type Cue, type ScriptDoc } from "../lib/script";

/** Where on screen the line you are reading sits. Not the very top: you need to see what is coming. */
const READ_LINE = .38;

export function AlertFlash({ level }: { level: "warn" | "hit" | null }) {
  if (!level) return null;
  return <div aria-hidden className={`pointer-events-none fixed inset-0 z-50 ${level === "hit" ? "flash-hit" : "flash-warn"}`} />;
}

/**
 * The script, with the paper thrown away. Keywords you name are marked in the text, and as the
 * reading line approaches one the screen flashes -- amber a little before it arrives, red when it
 * does. Never a sound: this is for someone standing in the dark next to an audience.
 *
 * `onAlert` lets the host window flash too, so the operator sees it on the control screen whether or
 * not the reader is the window they are looking at.
 */
export default function ScriptReader({ doc, setDoc, onAlert, editable = true }: {
  doc: ScriptDoc;
  setDoc: (d: ScriptDoc) => void;
  onAlert?: (level: "warn" | "hit", message: string, cue: string) => void;
  editable?: boolean;
}) {
  const [size, setSize] = useState(() => Number(localStorage.getItem("cueflow:scriptSize")) || 18);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState<"warn" | "hit" | null>(null);
  const [message, setMessage] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const fired = useRef<{ warn: Set<string>; hit: Set<string> }>({ warn: new Set(), hit: new Set() });

  const marked = useMemo(() => markKeywords(doc.html, doc.cues), [doc.html, doc.cues]);
  useEffect(() => { localStorage.setItem("cueflow:scriptSize", String(size)); }, [size]);
  // A changed script or cue list makes every past alert irrelevant.
  useEffect(() => { fired.current = { warn: new Set(), hit: new Set() }; }, [marked.html]);

  const raise = (level: "warn" | "hit", cue: Cue) => {
    const text = cue.message || (level === "warn" ? `${keywordsOf(cue)[0] ?? "Cue"} coming up` : `${keywordsOf(cue)[0] ?? "Cue"} now`);
    setMessage(text);
    setFlash(level);
    setTimeout(() => setFlash(null), level === "hit" ? 1600 : 1100);
    onAlert?.(level, text, cue.id);
  };

  // Scroll position drives everything: no timers, no playback, nothing to fall out of sync with.
  const check = () => {
    const box = scroller.current;
    if (!box) return;
    const line = box.getBoundingClientRect().top + box.clientHeight * READ_LINE;
    for (const mark of box.querySelectorAll<HTMLElement>("mark[data-hit]")) {
      const id = mark.dataset.hit!;
      const cue = doc.cues.find(c => c.id === mark.dataset.cue);
      if (!cue) continue;
      const top = mark.getBoundingClientRect().top;
      const ahead = top - line;
      if (ahead <= 0 && !fired.current.hit.has(id)) { fired.current.hit.add(id); fired.current.warn.add(id); raise("hit", cue); }
      else if (ahead > 0 && ahead <= doc.lookahead && !fired.current.warn.has(id)) { fired.current.warn.add(id); raise("warn", cue); }
    }
  };

  const load = async (file: File) => {
    setBusy(true); setError("");
    try {
      const html = await parseScript(file);
      if (!html.trim()) throw new Error("No text could be read out of that file.");
      const next = { ...doc, name: file.name, html };
      saveScript(next); setDoc(next); send({ type: "script" });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const setCues = (cues: Cue[]) => { const next = { ...doc, cues }; try { saveScript(next); setDoc(next); send({ type: "script" }); } catch (e) { setError((e as Error).message); } };
  const addCue = () => setCues([...doc.cues, { id: crypto.randomUUID(), words: "", message: "" }]);
  const editCue = (id: string, patch: Partial<Cue>) => setCues(doc.cues.map(c => (c.id === id ? { ...c, ...patch } : c)));

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <AlertFlash level={flash} />

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex">
            <input type="file" accept=".docx,.pdf,.txt,.md,.rtf" className="sr-only"
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void load(f); }} />
            <span className="inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-surface/60 px-3 text-sm font-medium hover:border-accent">
              <FileUp size={15} />{busy ? "Reading…" : doc.name || "Open a script"}
            </span>
          </label>
          <Tooltip content="Smaller text"><Button size="sm" variant="flat" isIconOnly onPress={() => setSize(s => Math.max(12, s - 2))}><Minus size={14} /></Button></Tooltip>
          <span className="w-10 text-center text-xs tabular-nums text-muted">{size}px</span>
          <Tooltip content="Bigger text"><Button size="sm" variant="flat" isIconOnly onPress={() => setSize(s => Math.min(48, s + 2))}><Plus size={14} /></Button></Tooltip>
          <Button size="sm" variant="flat" startContent={<Bell size={14} />} onPress={addCue}>Alert word</Button>
          {marked.hits > 0 && <span className="text-xs text-muted">{marked.hits} marked</span>}
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      {editable && doc.cues.length > 0 && (
        <div className="space-y-2">
          {doc.cues.map(c => (
            <div key={c.id} className="flex flex-wrap items-center gap-2">
              <Input className="min-w-40 flex-1" size="sm" placeholder="Words, comma separated" value={c.words} onValueChange={v => editCue(c.id, { words: v })} />
              <Input className="min-w-40 flex-1" size="sm" placeholder="Message to flash (optional)" value={c.message} onValueChange={v => editCue(c.id, { message: v })} />
              <Button size="sm" variant="light" isIconOnly onPress={() => setCues(doc.cues.filter(x => x.id !== c.id))}><Trash2 size={14} /></Button>
            </div>
          ))}
          <label className="flex items-center gap-2 text-xs text-muted">
            Warn this far ahead
            <input type="range" min={80} max={800} step={20} value={doc.lookahead}
              onChange={e => { const next = { ...doc, lookahead: Number(e.target.value) }; saveScript(next); setDoc(next); }} />
            <span className="tabular-nums">{doc.lookahead}px</span>
          </label>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {/* The reading line. Faint on purpose: a guide, not furniture. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10 border-t border-accent/25" style={{ top: `${READ_LINE * 100}%` }} />
        {/* Safe by construction: every path into `doc.html` goes through `clean`, an allowlist that
            keeps formatting tags and strips every attribute, and it runs again on load. The only
            thing markKeywords adds is <mark>. */}
        <div ref={scroller} onScroll={check}
          className="script-prose h-full overflow-y-auto rounded-2xl border border-border bg-surface/30 px-5 py-4"
          style={{ fontSize: size }}
          dangerouslySetInnerHTML={{ __html: marked.html || "<p>Open a Word or PDF script. The text comes across with its formatting; the page it was printed on does not.</p>" }} />
      </div>

      {message && <p className="text-center text-sm font-semibold text-muted">{message}</p>}
    </div>
  );
}

export { emptyDoc };
