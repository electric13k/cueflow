import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button, Input, Slider, Switch, Tooltip } from "../ui";
import { Bell, Check, ChevronDown, ChevronUp, FileUp, ListPlus, Minus, MousePointer2, Pause, Pencil, Play, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import { send } from "../lib/bus";
import { clean, cueAlert, directionOf, emptyDoc, findInScript, keywordsOf, markKeywords, parseScript, saveScript, type Armed, type Cue, type ScriptDoc } from "../lib/script";
import type { AlertScope } from "../lib/alerts";

/** Where on screen the line you are reading sits. Not the very top: you need to see what is coming. */
const READ_LINE = .38;

/** `00:00:00`, the way a stage manager writes it. */
const clock = (ms: number) => new Date(Math.max(0, ms)).toISOString().slice(11, 19);

export function AlertFlash({ level, scope = "operator" }: { level: "warn" | "hit" | null; scope?: AlertScope }) {
  if (!level) return null;
  const local = scope === "script";
  return <div aria-hidden className={`pointer-events-none ${local ? "absolute inset-0 z-20 rounded-[inherit]" : "fixed inset-0 z-50"} ${level === "hit" ? "flash-hit" : "flash-warn"}`} />;
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
export default function ScriptReader({ doc, setDoc, onAlert, editable = true, alertScope = "script" }: {
  doc: ScriptDoc;
  setDoc: (d: ScriptDoc) => void;
  onAlert?: (level: "warn" | "hit", message: string, cue: string) => void;
  editable?: boolean;
  alertScope?: AlertScope;
}) {
  const [size, setSize] = useState(() => Number(localStorage.getItem("cueflow:scriptSize")) || 18);
  const [colour, setColour] = useState(() => localStorage.getItem("cueflow:scriptColour") || "");
  const [speed, setSpeed] = useState(() => Number(localStorage.getItem("cueflow:scriptSpeed")) || 60);
  const [yellowEnabled, setYellowEnabled] = useState(() => localStorage.getItem("cueflow:yellowAlerts") !== "0");
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState<"warn" | "hit" | null>(null);
  const [message, setMessage] = useState("");
  const [selectedPhrase, setSelectedPhrase] = useState("");
  const [editingText, setEditingText] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const [scan, setScan] = useState<{ top: number; start: number; travel: number; key: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const speedRef = useRef(speed);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  speedRef.current = speed;
  const fired = useRef<Armed>({ warn: new Set(), hit: new Set() });
  const accrued = useRef(0);
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanKey = useRef("");

  const marked = useMemo(() => markKeywords(doc.html, doc.cues), [doc.html, doc.cues]);
  const found = useMemo(() => findInScript(marked.html, query), [marked.html, query]);
  useEffect(() => { localStorage.setItem("cueflow:scriptSize", String(size)); }, [size]);
  useEffect(() => { localStorage.setItem("cueflow:scriptSpeed", String(speed)); }, [speed]);
  useEffect(() => { localStorage.setItem("cueflow:scriptColour", colour); }, [colour]);
  useEffect(() => { localStorage.setItem("cueflow:yellowAlerts", yellowEnabled ? "1" : "0"); }, [yellowEnabled]);
  // A changed script or cue list makes every past alert irrelevant.
  useEffect(() => { fired.current = { warn: new Set(), hit: new Set() }; }, [marked.html]);
  useEffect(() => { setAt(0); }, [query]);
  useEffect(() => {
    if (!editingText) return;
    scroller.current?.focus();
  }, [editingText]);
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  const raise = (level: "warn" | "hit", cue: Cue) => {
    const text = cue.message || (level === "warn" ? `${keywordsOf(cue)[0] ?? "Cue"} coming up` : `${keywordsOf(cue)[0] ?? "Cue"} now`);
    setMessage(text);
    setFlash(level);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), level === "hit" ? 1600 : 1100);
    onAlert?.(level, text, cue.id);
  };

  // Scroll position drives the alerts: whether the scrolling came from a hand or from the timer
  // below, there is one place that knows where the reading line is. `cueAlert` also re-arms a cue
  // the scroll has put back in front of the line, so scrolling up by hand is as good as rewinding.
  const check = () => {
    const box = scroller.current;
    if (!box) return;
    const line = box.getBoundingClientRect().top + box.clientHeight * READ_LINE;
    const groups = new Map<Element, HTMLElement[]>();
    for (const mark of box.querySelectorAll<HTMLElement>("mark[data-hit]")) {
      const block = mark.closest("p,li,h1,h2,h3,h4,h5,h6") ?? mark.parentElement ?? box;
      const list = groups.get(block) ?? [];
      list.push(mark);
      groups.set(block, list);
    }
    for (const marks of groups.values()) {
      const isMultiCueLine = new Set(marks.map(mark => mark.dataset.cue)).size > 1;
      const lineNearGuide = marks.some(mark => {
        const ahead = mark.getBoundingClientRect().top - line;
        return ahead <= doc.lookahead && ahead >= -48;
      });
      if (isMultiCueLine && lineNearGuide) scanLine(marks, marks.map(mark => mark.dataset.hit).join("|"));
      for (const mark of marks) {
        const cue = doc.cues.find(c => c.id === mark.dataset.cue);
        if (!cue) continue;
        const ahead = mark.getBoundingClientRect().top - line;
        const level = cueAlert(ahead, doc.lookahead, mark.dataset.hit!, fired.current, isMultiCueLine ? false : yellowEnabled && cue.warn !== false);
        if (level) raise(level, cue);
      }
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
      position += speedRef.current * (now - last) / 1000;
      last = now;
      box.scrollTop = position;
      // A short script can fit entirely in the viewport. It is not finished just because the
      // viewport starts at scrollTop 0, so only stop when there is real scrollable distance.
      const maxScroll = Math.max(0, box.scrollHeight - box.clientHeight);
      if (maxScroll > 1 && box.scrollTop >= maxScroll - 1) return setPlaying(false);
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing]);

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
    scanKey.current = "";
    setScan(null);
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

  const selectedFromWindow = () => window.getSelection()?.toString().trim().replace(/\s+/g, " ") || "";
  const selectNodes = (nodes: HTMLElement[]) => {
    if (!nodes.length) return;
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.setStart(nodes[0], 0);
    range.setEnd(nodes[nodes.length - 1], nodes[nodes.length - 1].childNodes.length);
    selection.removeAllRanges();
    selection.addRange(range);
  };
  const selectCurrentMatch = () => {
    const node = scroller.current?.querySelector<HTMLElement>(`[data-find="${at}"]`) ?? scroller.current?.querySelector<HTMLElement>(".find-hit.current");
    if (!node) return;
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  };
  const selectAllMatches = () => selectNodes([...scroller.current?.querySelectorAll<HTMLElement>(".find-hit") ?? []]);
  const addCueForText = (text: string, instances: "first" | "all" = "all") => {
    const words = text.trim().replace(/\s+/g, " ");
    if (!words) return;
    setCues([...doc.cues, { id: crypto.randomUUID(), words, message: "", match: "phrase", instances }]);
    setSelectedPhrase("");
    setContextMenu(null);
  };
  const addCue = () => addCueForText(selectedPhrase || query.trim(), "all");
  const addAllInstances = () => addCueForText(selectedPhrase || query.trim(), "all");
  const addSelectedCue = () => addCueForText(selectedPhrase || query.trim(), "first");
  const openSelectionMenu = (event: ReactMouseEvent) => {
    const text = selectedFromWindow();
    if (!text) return;
    event.preventDefault();
    setSelectedPhrase(text);
    setContextMenu({ x: Math.min(event.clientX, window.innerWidth - 220), y: Math.min(event.clientY, window.innerHeight - 120), text });
  };
  const scanLine = (marks: HTMLElement[], key: string) => {
    const box = scroller.current;
    if (!box || marks.length < 2 || scanKey.current === key) return;
    const frame = box.parentElement?.getBoundingClientRect() ?? box.getBoundingClientRect();
    const rects = marks.map(mark => mark.getBoundingClientRect());
    const rtl = directionOf(doc.html) === "rtl" || getComputedStyle(marks[0]).direction === "rtl";
    const left = rtl ? Math.max(...rects.map(rect => rect.right)) : Math.min(...rects.map(rect => rect.left));
    const right = rtl ? Math.min(...rects.map(rect => rect.left)) : Math.max(...rects.map(rect => rect.right));
    const start = left - frame.left;
    const travel = right - left;
    const top = Math.min(...rects.map(rect => rect.top)) - frame.top;
    scanKey.current = key;
    setScan({ top, start, travel, key });
    if (scanTimer.current) clearTimeout(scanTimer.current);
    scanTimer.current = setTimeout(() => { scanKey.current = ""; setScan(null); }, Math.min(2200, 700 + Math.abs(travel) * 1.5));
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
  const saveText = () => {
    const box = scroller.current;
    if (!box) return;
    const next = { ...doc, html: clean(box.innerHTML) };
    try { saveScript(next); setDoc(next); send({ type: "script" }); setEditingText(false); }
    catch (e) { setError((e as Error).message); }
  };
  const addBlankCue = () => setCues([...doc.cues, { id: crypto.randomUUID(), words: "", message: "" }]);
  const editCue = (id: string, patch: Partial<Cue>) => setCues(doc.cues.map(c => (c.id === id ? { ...c, ...patch } : c)));

  return (
    <div className="relative flex h-full min-h-0 flex-col gap-3">
      {alertScope === "script" && <AlertFlash level={flash} scope="script" />}

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
              {!editingText ? (
                <Button size="sm" variant="flat" startContent={<Pencil size={14} />} onPress={() => setEditingText(true)}>
                  Edit text
                </Button>
              ) : (
                <>
                  <Button size="sm" color="primary" startContent={<Check size={14} />} onPress={saveText}>Save text</Button>
                  <Button size="sm" variant="light" onPress={() => setEditingText(false)}>Cancel</Button>
                </>
              )}
          <div className="flex flex-wrap items-center gap-2">
            <Tooltip content="Smaller text"><Button size="sm" variant="flat" isIconOnly onPress={() => setSize(s => Math.max(12, s - 2))}><Minus size={14} /></Button></Tooltip>
            <span className="w-10 text-center text-xs tabular-nums text-muted">{size}px</span>
            <Tooltip content="Bigger text"><Button size="sm" variant="flat" isIconOnly onPress={() => setSize(s => Math.min(48, s + 2))}><Plus size={14} /></Button></Tooltip>
            <label className="inline-flex items-center gap-1 text-xs text-muted">
              Colour
              <input type="color" aria-label="Text colour" value={colour || "#d8cfc4"} onChange={e => setColour(e.target.value)}
                className="h-8 w-9 cursor-pointer rounded-lg border border-border bg-transparent p-0.5" />
            </label>
            {colour && <Button size="sm" variant="light" aria-label="Reset text colour" onPress={() => setColour("")}>Default colour</Button>}
            <Button size="sm" variant="flat" startContent={<Bell size={14} />} onPress={addBlankCue}>Alert word</Button>
            <Switch size="sm" isSelected={yellowEnabled} onValueChange={setYellowEnabled}>Yellow alerts</Switch>
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
          <input className="metal-range" aria-label="Script speed" type="range" min={10} max={300} step={5} value={speed} onChange={e => setSpeed(Number(e.target.value))} />
          <span className="w-16 tabular-nums">{speed} px/s</span>
        </label>

        {/* Full width on a phone, so the two step arrows sit against the field instead of being
            flung to the far edge by `ml-auto` once the row has wrapped. */}
        <div className="flex w-full items-center gap-1 sm:ml-auto sm:w-auto">
          <Search size={14} className="text-muted" />
          <Input className="min-w-0 flex-1 sm:w-44 sm:flex-none" size="sm" placeholder="Find in script" value={query} onValueChange={setQuery}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCueForText(selectedPhrase || query, "all"); } }} />
          <span className="w-14 text-center text-xs tabular-nums text-muted">
            {found.hits ? `${at + 1}/${found.hits}` : query.trim() ? "none" : ""}
          </span>
          <Button size="sm" variant="light" isIconOnly aria-label="Previous match" onPress={() => step(-1)}><ChevronUp size={14} /></Button>
          <Button size="sm" variant="light" isIconOnly aria-label="Next match" onPress={() => step(1)}><ChevronDown size={14} /></Button>
          <Button size="sm" variant="light" isIconOnly aria-label="Select current match" onPress={selectCurrentMatch}><MousePointer2 size={14} /></Button>
          <Button size="sm" variant="light" isIconOnly aria-label="Select all matches" onPress={selectAllMatches}><ListPlus size={14} /></Button>
          {query.trim() && <Button size="sm" variant="flat" startContent={<Bell size={14} />} onPress={addAllInstances}>Add all occurrences</Button>}
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {selectedPhrase && <p className="text-xs text-muted">Selected phrase: <b className="text-foreground">{selectedPhrase}</b>. Press Enter to assign it as a cue.</p>}

      {editable && doc.cues.length > 0 && (
        <div className="space-y-2">
          {doc.cues.map(c => (
            <div key={c.id} className="flex flex-wrap items-center gap-2">
              <Input className="min-w-40 flex-1" size="sm" placeholder="Words, comma separated" value={c.words} onValueChange={v => editCue(c.id, { words: v })} />
              <Input className="min-w-40 flex-1" size="sm" placeholder="Message to flash (optional)" value={c.message} onValueChange={v => editCue(c.id, { message: v })} />
              <Switch size="sm" isSelected={c.warn !== false} onValueChange={enabled => editCue(c.id, { warn: enabled })}>Yellow</Switch>
              <Button size="sm" variant="light" isIconOnly onPress={() => setCues(doc.cues.filter(x => x.id !== c.id))}><Trash2 size={14} /></Button>
            </div>
          ))}
          <div className="mt-4 max-w-xl rounded-2xl border border-border/70 bg-surface/35 px-4 py-3">
            <Slider
              label="Warn this far before a script cue word"
              aria-label="Warn this far before a script cue word"
              minValue={80}
              maxValue={800}
              step={20}
              value={doc.lookahead}
              getValue={n => `${Number(n)}px`}
              onChange={n => {
                const next = { ...doc, lookahead: Array.isArray(n) ? n[0] : n };
                saveScript(next);
                setDoc(next);
              }}
              className="script-lookahead-slider"
            />
          </div>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {/* The reading line. Faint on purpose: a guide, not furniture. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10 border-t border-accent/25" style={{ top: `${READ_LINE * 100}%` }} />
        {/* Safe by construction: every path into `doc.html` goes through `clean`, an allowlist of
            tags and of attributes by name -- six layout properties, four align values, the classes
            the importer itself emits -- and it runs again on load. The only things added after that
            are <mark> and <span class="find-hit">, both built here. */}
        <div ref={scroller} dir={directionOf(doc.html)} onScroll={check} onMouseUp={() => { if (!editingText) setSelectedPhrase(selectedFromWindow()); }} onContextMenu={editingText ? undefined : openSelectionMenu}
          className={`script-prose h-full overflow-y-auto rounded-2xl border border-border bg-surface/30 px-5 py-4 ${editingText ? "ring-2 ring-accent/40" : ""}`}
          style={{ fontSize: size, color: colour || undefined }}
          contentEditable={editingText}
          suppressContentEditableWarning
          spellCheck={false}
          onKeyDown={e => { if (editingText && e.key === "Escape") { e.preventDefault(); setEditingText(false); } if (editingText && (e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); saveText(); } }}
          dangerouslySetInnerHTML={{ __html: editingText ? (doc.html || "<p><br></p>") : (found.html || "<p>Open a Word or PDF script. The text comes across with the shape the writer gave it; the page it was printed on does not.</p>") }} />
        {scan && <motion.span aria-hidden key={scan.key} className="script-line-scan" style={{ top: scan.top, left: scan.start }} initial={{ opacity: 0, x: 0 }} animate={{ opacity: [0, 1, 1, 0], x: scan.travel }} transition={{ duration: Math.min(2.2, .7 + Math.abs(scan.travel) / 160), ease: "linear" }} />}
        {contextMenu && (
          <motion.div initial={{ opacity: 0, scale: .96, y: 5 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="absolute z-30 w-56 rounded-xl border border-border bg-surface p-2 shadow-glass" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" onClick={e => e.stopPropagation()}>
            <p className="truncate px-2 py-1 text-xs text-muted">{contextMenu.text}</p>
            <Button size="sm" variant="light" className="w-full justify-start" onPress={() => addCueForText(contextMenu.text, "first")}>Assign selected cue</Button>
            <Button size="sm" variant="light" className="w-full justify-start" onPress={() => addCueForText(contextMenu.text, "all")}>Assign all occurrences</Button>
            <Button size="sm" variant="light" className="w-full justify-start" onPress={() => setContextMenu(null)}><X size={14} />Close</Button>
          </motion.div>
        )}
      </div>

      <AnimatePresence mode="wait">
        {message && <motion.p key={message} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: .18 }} className="text-center text-sm font-semibold text-muted">{message}</motion.p>}
      </AnimatePresence>
    </div>
  );
}

export { emptyDoc };
