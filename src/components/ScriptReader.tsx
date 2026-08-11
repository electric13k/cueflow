import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Tooltip } from "../ui";
import { Bell, ChevronDown, ChevronUp, FileUp, Minus, Pause, Play, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { send } from "../lib/bus";
import { cueAlert, emptyDoc, findInScript, keywordsOf, markKeywords, parseScript, saveScript, type Armed, type Cue, type ScriptDoc } from "../lib/script";

/** Where on screen the line you are reading sits. Not the very top: you need to see what is coming. */
const READ_LINE = .38;

/** `00:00:00`, the way a stage manager writes it. */
const clock = (ms: number) => new Date(Math.max(0, ms)).toISOString().slice(11, 19);

export function AlertFlash({ level }: { level: "warn" | "hit" | null }) {
  if (!level) return null;
  return <div aria-hidden className={`pointer-events-none fixed inset-0 z-50 ${level === "hit" ? "flash-hit" : "flash-warn"}`} />;
}

/**
 * The script, with the paper thrown away but the shape kept. Keywords you name are marked in the
 * text, and as the reading line approaches one the screen flashes -- amber a little before it
 * arrives, red when it does. Never a sound: this is for someone standing in the dark next to an
 * audience.
 *
 * It also runs as a teleprompter: start it and the text creeps upward at a speed you set, with a
 * clock counting the run. Scroll position still drives the alerts, whether the scrolling is yours
 * or the timer's, so there is only ever one source of truth for where the reading line is.
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
  const [colour, setColour] = useState(() => localStorage.getItem("cueflow:scriptColour") || "");
  const [speed, setSpeed] = useState(() => Number(localStorage.getItem("cueflow:scriptSpeed")) || 60);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState<"warn" | "hit" | null>(null);
  const [message, setMessage] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const fired = useRef<Armed>({ warn: new Set(), hit: new Set() });
  const accrued = useRef(0);

  const marked = useMemo(() => markKeywords(doc.html, doc.cues), [doc.html, doc.cues]);
  const found = useMemo(() => findInScript(marked.html, query), [marked.html, query]);
  useEffect(() => { localStorage.setItem("cueflow:scriptSize", String(size)); }, [size]);
  useEffect(() => { localStorage.setItem("cueflow:scriptSpeed", String(speed)); }, [speed]);
  useEffect(() => { localStorage.setItem("cueflow:scriptColour", colour); }, [colour]);
  // A changed script or cue list makes every past alert irrelevant.
  useEffect(() => { fired.current = { warn: new Set(), hit: new Set() }; }, [marked.html]);
  useEffect(() => { setAt(0); }, [query]);

  const raise = (level: "warn" | "hit", cue: Cue) => {
    const text = cue.message || (level === "warn" ? `${keywordsOf(cue)[0] ?? "Cue"} coming up` : `${keywordsOf(cue)[0] ?? "Cue"} now`);
    setMessage(text);
    setFlash(level);
    setTimeout(() => setFlash(null), level === "hit" ? 1600 : 1100);
    onAlert?.(level, text, cue.id);
  };

  // Scroll position drives the alerts: whether the scrolling came from a hand or from the timer
  // below, there is one place that knows where the reading line is. `cueAlert` also re-arms a cue
  // the scroll has put back in front of the line, so scrolling up by hand is as good as rewinding.
  const check = () => {
    const box = scroller.current;
    if (!box) return;
    const line = box.getBoundingClientRect().top + box.clientHeight * READ_LINE;
    for (const mark of box.querySelectorAll<HTMLElement>("mark[data-hit]")) {
      const cue = doc.cues.find(c => c.id === mark.dataset.cue);
      if (!cue) continue;
      const ahead = mark.getBoundingClientRect().top - line;
      const level = cueAlert(ahead, doc.lookahead, mark.dataset.hit!, fired.current);
      if (level) raise(level, cue);
    }
  };

  /**
   * Auto-scroll. `requestAnimationFrame` on purpose: this one is motion, and motion in a tab
   * nobody is looking at is motion nobody needs. Distance is taken from the frame's own timestamp,
   * not counted in frames, so a dropped frame costs no ground. The position is accumulated
   * separately because a fraction of a pixel per frame would otherwise round away to a standstill.
   */
  useEffect(() => {
    const box = scroller.current;
    if (!playing || !box) return;
    let position = box.scrollTop;
    let last = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      // A hand on the scrollbar wins: take its position and carry on from there.
      if (Math.abs(box.scrollTop - position) > 2) position = box.scrollTop;
      position += speed * (now - last) / 1000;
      last = now;
      box.scrollTop = position;
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 1) return setPlaying(false);
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, speed]);

  /**
   * The clock. `setInterval` and wall time rather than the scroll loop above: a run has to keep
   * its own length even while the reader is a popup behind another window, where no frame fires.
   */
  useEffect(() => {
    if (!playing) return;
    const from = Date.now();
    const id = setInterval(() => setElapsed(accrued.current + Date.now() - from), 200);
    return () => { clearInterval(id); accrued.current += Date.now() - from; setElapsed(accrued.current); };
  }, [playing]);

  const rewind = () => {
    setPlaying(false);
    accrued.current = 0;
    setElapsed(0);
    if (scroller.current) scroller.current.scrollTop = 0;
    // Back to the top means back to the top: the cues ahead have not happened yet.
    fired.current = { warn: new Set(), hit: new Set() };
  };

  // Stepping through the finds. Also runs when the marked-up HTML changes, because replacing the
  // markup drops the scroll position and the match the operator was looking at with it.
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    for (const el of box.querySelectorAll(".find-hit.current")) el.classList.remove("current");
    const hit = box.querySelector<HTMLElement>(`[data-find="${at}"]`);
    if (!hit) return;
    hit.classList.add("current");
    hit.scrollIntoView({ block: "center" });
  }, [found.html, at]);

  const step = (d: number) => setAt(a => (found.hits ? (a + d + found.hits) % found.hits : 0));

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
        // A phone gets rows that line up rather than a desktop toolbar left to wrap where it likes:
        // the file button takes the full width, and the three settings below it share it evenly.
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <label className="flex">
            <input type="file" accept=".docx,.pdf,.txt,.md,.rtf" className="sr-only"
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void load(f); }} />
            <span className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface/60 px-3 text-sm font-medium hover:border-accent sm:h-9 sm:w-auto sm:justify-start">
              <FileUp size={15} />{busy ? "Reading…" : doc.name || "Open a script"}
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Tooltip content="Smaller text"><Button size="sm" variant="flat" isIconOnly onPress={() => setSize(s => Math.max(12, s - 2))}><Minus size={14} /></Button></Tooltip>
            <span className="w-10 text-center text-xs tabular-nums text-muted">{size}px</span>
            <Tooltip content="Bigger text"><Button size="sm" variant="flat" isIconOnly onPress={() => setSize(s => Math.min(48, s + 2))}><Plus size={14} /></Button></Tooltip>
            <label className="inline-flex items-center gap-1 text-xs text-muted">
              Colour
              <input type="color" aria-label="Text colour" value={colour || "#d8cfc4"} onChange={e => setColour(e.target.value)}
                className="h-8 w-9 cursor-pointer rounded-lg border border-border bg-transparent p-0.5" />
            </label>
            {colour && <Button size="sm" variant="light" onPress={() => setColour("")}>Theme colour</Button>}
            <Button size="sm" variant="flat" startContent={<Bell size={14} />} onPress={addCue}>Alert word</Button>
            {marked.hits > 0 && <span className="text-xs text-muted">{marked.hits} marked</span>}
          </div>
        </div>
      )}

      {/* Transport and search. Both stay put whether or not the script can be edited here: reading
          it is the one thing every role does. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" color="primary" variant={playing ? "solid" : "flat"}
          startContent={playing ? <Pause size={14} /> : <Play size={14} />} onPress={() => setPlaying(p => !p)}>
          {playing ? "Stop" : "Start"}
        </Button>
        <Tooltip content="Back to the top, clock to zero">
          <Button size="sm" variant="flat" isIconOnly aria-label="Rewind" onPress={rewind}><RotateCcw size={14} /></Button>
        </Tooltip>
        <span className="tabular-nums text-sm font-semibold" aria-label="Elapsed">{clock(elapsed)}</span>
        <label className="flex items-center gap-2 text-xs text-muted">
          Speed
          <input type="range" min={10} max={300} step={5} value={speed} onChange={e => setSpeed(Number(e.target.value))} />
          <span className="w-16 tabular-nums">{speed} px/s</span>
        </label>

        {/* Full width on a phone, so the two step arrows sit against the field instead of being
            flung to the far edge by `ml-auto` once the row has wrapped. */}
        <div className="flex w-full items-center gap-1 sm:ml-auto sm:w-auto">
          <Search size={14} className="text-muted" />
          <Input className="min-w-0 flex-1 sm:w-44 sm:flex-none" size="sm" placeholder="Find in script" value={query} onValueChange={setQuery}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); } }} />
          <span className="w-14 text-center text-xs tabular-nums text-muted">
            {found.hits ? `${at + 1}/${found.hits}` : query.trim() ? "none" : ""}
          </span>
          <Button size="sm" variant="light" isIconOnly aria-label="Previous match" onPress={() => step(-1)}><ChevronUp size={14} /></Button>
          <Button size="sm" variant="light" isIconOnly aria-label="Next match" onPress={() => step(1)}><ChevronDown size={14} /></Button>
        </div>
      </div>

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
        {/* Safe by construction: every path into `doc.html` goes through `clean`, an allowlist of
            tags and of attributes by name -- six layout properties, four align values, the classes
            the importer itself emits -- and it runs again on load. The only things added after that
            are <mark> and <span class="find-hit">, both built here. */}
        <div ref={scroller} onScroll={check}
          className="script-prose h-full overflow-y-auto rounded-2xl border border-border bg-surface/30 px-5 py-4"
          style={{ fontSize: size, color: colour || undefined }}
          dangerouslySetInnerHTML={{ __html: found.html || "<p>Open a Word or PDF script. The text comes across with the shape the writer gave it; the page it was printed on does not.</p>" }} />
      </div>

      {message && <p className="text-center text-sm font-semibold text-muted">{message}</p>}
    </div>
  );
}

export { emptyDoc };
