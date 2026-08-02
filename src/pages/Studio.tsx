import { ChangeEvent, useEffect, useRef, useState } from "react";
import { Button, Card, CardBody, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Slider, Spinner, Switch, Tab, Tabs, Tooltip, useDisclosure } from "../ui";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, ChevronUp, CircleHelp, ExternalLink, FastForward, Keyboard, ListMusic, Monitor, Music, Pause, Pencil, Play, Plus, Repeat, Rewind, RotateCcw, Search, SlidersHorizontal, Trash2, TriangleAlert, Upload, Volume2 } from "lucide-react";
import Backdrop from "../components/Backdrop";
import Nav from "../components/Nav";
import Onboarding from "../components/Onboarding";
import WaveformEditor from "../components/WaveformEditor";
import { AudioEngine, makeReversedFile } from "../lib/audio";
import { hydrateCloud, local, onAuth, persist, uploadTrack } from "../lib/store";
import { toastOnce } from "../lib/toast";
import { cloneEffects, defaultEffects, Effects, Sequence, SequenceItem, Track } from "../types";

const format = (s = 0) => Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00";
type Ctl = { key: keyof Effects; label: string; min: number; max: number; step: number; unit?: string };
const controls: Ctl[] = [
  { key: "speed", label: "Speed", min: .5, max: 2, step: .05, unit: "x" }, { key: "volume", label: "Volume", min: 0, max: 1, step: .01 },
  { key: "gain", label: "Gain", min: .1, max: 2, step: .05, unit: "x" }, { key: "reverb", label: "Reverb", min: 0, max: 1, step: .05 },
  { key: "fadeIn", label: "Fade in", min: 0, max: 8, step: .25, unit: "s" }, { key: "fadeOut", label: "Fade out", min: 0, max: 8, step: .25, unit: "s" },
  { key: "distortion", label: "Distortion", min: 0, max: 1, step: .05 },
];
type Session = { selectedId: string; sequenceId: string; cueIndex: number; tab: string };
const patch = (arr: Track[], id: string, p: Partial<Track>) => arr.map(t => t.id === id ? { ...t, ...p } : t);
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

// Configurable keybinds: arrows drive cues, other keys nudge live effects.
type Action = "nextCue" | "prevCue" | "playPause" | "volUp" | "volDown" | "speedUp" | "speedDown" | "reverbUp" | "reverbDown";
const keyActions: { id: Action; label: string; def: string }[] = [
  { id: "nextCue", label: "Next cue", def: "ArrowRight" }, { id: "prevCue", label: "Previous cue", def: "ArrowLeft" },
  { id: "playPause", label: "Play / pause", def: " " },
  { id: "volUp", label: "Volume +", def: "ArrowUp" }, { id: "volDown", label: "Volume −", def: "ArrowDown" },
  { id: "speedUp", label: "Speed +", def: "]" }, { id: "speedDown", label: "Speed −", def: "[" },
  { id: "reverbUp", label: "Reverb +", def: "r" }, { id: "reverbDown", label: "Reverb −", def: "e" },
];
const defaultBinds = Object.fromEntries(keyActions.map(a => [a.id, a.def])) as Record<Action, string>;
const keyLabel = (k: string) => k === " " ? "Space" : ({ ArrowRight: "→", ArrowLeft: "←", ArrowUp: "↑", ArrowDown: "↓" } as Record<string, string>)[k] ?? (k.length === 1 ? k.toUpperCase() : k);

export default function Studio() {
  const audio = useRef<HTMLAudioElement>(new Audio());
  const engine = useRef(new AudioEngine());
  const session = local.get<Session>("session", { selectedId: "", sequenceId: "", cueIndex: 0, tab: "library" });
  const [tracks, setTracks] = useState<Track[]>(() => local.get("tracks", []));
  const [sequences, setSequences] = useState<Sequence[]>(() => local.get("sequences", []));
  const [selectedId, setSelectedId] = useState<string>(session.selectedId || local.get<Track[]>("tracks", [])[0]?.id || "");
  const [selectedIds, setSelectedIds] = useState<string[]>([]); // multi-select for editor + add-to-sequence
  const [loop, setLoop] = useState(false);
  const [loopSeq, setLoopSeq] = useState(false);
  const [binds, setBinds] = useState<Record<Action, string>>(() => local.get("keybinds", defaultBinds));
  const keybindsModal = useDisclosure();
  const guideModal = useDisclosure();
  const [signedIn, setSignedIn] = useState(false);
  const [sequenceId, setSequenceId] = useState<string>(session.sequenceId);
  const [cueIndex, setCueIndex] = useState(session.cueIndex);
  const [tab, setTab] = useState(session.tab);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [busy, setBusy] = useState(false);
  const renameModal = useDisclosure();
  const [draft, setDraft] = useState<{ kind: "track" | "sequence"; id: string; value: string }>({ kind: "track", id: "", value: "" });

  const selected = tracks.find(t => t.id === selectedId) ?? tracks[0];
  const selectedSequence = sequences.find(s => s.id === sequenceId);
  useEffect(() => { audio.current.loop = loop; }, [loop]);

  useEffect(() => { void persist(tracks, sequences); }, [tracks, sequences]);
  useEffect(() => { local.set("session", { selectedId, sequenceId, cueIndex, tab } satisfies Session); }, [selectedId, sequenceId, cueIndex, tab]);
  useEffect(() => { local.set("keybinds", binds); }, [binds]);
  const data = useRef({ tracks, sequences }); data.current = { tracks, sequences };
  const mergeCloud = () => hydrateCloud().then(cloud => { if (!cloud) return; setTracks(o => [...o, ...cloud.tracks.filter(t => !o.some(e => e.id === t.id))]); setSequences(o => [...o, ...cloud.sequences.filter(s => !o.some(e => e.id === s.id))]); });
  useEffect(() => { void mergeCloud(); }, []);
  // On sign-in: pull the account's saved data and push whatever is currently local up to it.
  useEffect(() => onAuth(email => { setSignedIn(!!email); if (!email) return; void mergeCloud().then(() => persist(data.current.tracks, data.current.sequences)); }), []);
  // Once there is something worth losing, mention syncing — once ever, not every visit.
  useEffect(() => {
    if (!signedIn && tracks.length) toastOnce("sync-nudge", "Sign in to sync your progress", "Your sounds and sequences live in this browser only. Signing in saves them to your account so they follow you across devices.");
  }, [tracks.length, signedIn]);
  useEffect(() => {
    const a = audio.current; a.crossOrigin = "anonymous";
    const tick = () => { setTime(a.currentTime); const fade = selected?.effects.fadeOut ?? 0; if (fade && Number.isFinite(a.duration) && a.duration - a.currentTime <= fade) a.volume = Math.max(0, selected!.effects.volume * (a.duration - a.currentTime) / fade); };
    const meta = () => setDuration(Number.isFinite(a.duration) ? a.duration : 0);
    const ended = () => setPlaying(false);
    a.addEventListener("timeupdate", tick); a.addEventListener("loadedmetadata", meta); a.addEventListener("durationchange", meta); a.addEventListener("ended", ended);
    return () => { a.removeEventListener("timeupdate", tick); a.removeEventListener("loadedmetadata", meta); a.removeEventListener("durationchange", meta); a.removeEventListener("ended", ended); };
  }, [selected]);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement; if (["INPUT", "TEXTAREA"].includes(el.tagName) || el.isContentEditable) return;
      const action = (Object.keys(binds) as Action[]).find(a => binds[a] === e.key); if (!action) return;
      if ((action === "nextCue" || action === "prevCue") && !selectedSequence) return;
      if (["volUp", "volDown", "speedUp", "speedDown", "reverbUp", "reverbDown"].includes(action) && !selected) return;
      e.preventDefault();
      switch (action) {
        case "nextCue": return advance(1);
        case "prevCue": return advance(-1);
        case "playPause": return toggle();
        case "volUp": return nudge("volume", .05, 0, 1);
        case "volDown": return nudge("volume", -.05, 0, 1);
        case "speedUp": return nudge("speed", .05, .5, 2);
        case "speedDown": return nudge("speed", -.05, .5, 2);
        case "reverbUp": return nudge("reverb", .05, 0, 1);
        case "reverbDown": return nudge("reverb", -.05, 0, 1);
      }
    };
    window.addEventListener("keydown", keys); return () => window.removeEventListener("keydown", keys);
  });

  const updateEffects = (fx: Effects) => { if (!selected) return; setTracks(all => patch(all, selected.id, { effects: fx })); engine.current.apply(audio.current, fx); };
  const play = async (track = selected, fx = selected?.effects) => {
    if (!track || !fx) return;
    if (audio.current.src !== new URL(track.url, location.href).href) { audio.current.src = track.url; audio.current.currentTime = 0; setTime(0); setDuration(0); }
    try { await engine.current.play(audio.current, fx); setPlaying(true); } catch { setPlaying(false); }
  };
  const toggle = () => { if (playing) { audio.current.pause(); setPlaying(false); } else void play(); };
  // Soundboard: click a card to play it now (and make it the active/editor track).
  const playTrack = (track: Track) => { if (track.id === selectedId && playing) { audio.current.pause(); setPlaying(false); return; } setSelectedId(track.id); void play(track, track.effects); };
  const toggleSelect = (id: string) => setSelectedIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  const jump = (s: number) => { audio.current.currentTime = Math.max(0, Math.min(audio.current.duration || 0, audio.current.currentTime + s)); };
  const seek = (v: number) => { audio.current.currentTime = v; setTime(v); };
  const playCue = (i: number) => { if (!selectedSequence) return; const item = selectedSequence.items[i]; if (!item) return; const track = tracks.find(t => t.id === item.trackId); setCueIndex(i); if (track) void play(track, item.effects); };
  const advance = (dir: 1 | -1) => { if (!selectedSequence) return; const n = selectedSequence.items.length; if (!n) return; const i = loopSeq ? (cueIndex + dir + n) % n : clamp(cueIndex + dir, 0, n - 1); playCue(i); };
  const nudge = (key: keyof Effects, delta: number, min: number, max: number) => { if (!selected) return; updateEffects({ ...selected.effects, [key]: clamp(Number(selected.effects[key]) + delta, min, max) }); };
  const startSequence = (audience: boolean) => { if (!selectedSequence?.items.length) return; if (audience) openAudience(); setTab("sequence"); playCue(0); };

  // Optimistic: the track appears instantly with a local object URL, then swaps to the cloud URL once uploaded.
  const addFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])].filter(f => f.type.startsWith("audio/")); e.target.value = "";
    if (!files.length) return;
    const created: Track[] = files.map(f => ({ id: crypto.randomUUID(), title: f.name.replace(/\.[^.]+$/, ""), url: URL.createObjectURL(f), effects: defaultEffects(), createdAt: new Date().toISOString(), pending: true }));
    setTracks(o => [...created, ...o]); setSelectedId(created[0].id);
    created.forEach((t, i) => uploadTrack(files[i])
      .then(url => { setTracks(o => patch(o, t.id, { url, pending: false })); URL.revokeObjectURL(t.url); })
      .catch(() => setTracks(o => patch(o, t.id, { pending: false, error: true }))));
  };
  // Import a sound by URL — re-hosts Myinstants sounds through the serverless proxy so they play through the effects graph.
  const importSound = (title: string, src: string) => {
    const id = crypto.randomUUID();
    setTracks(o => [{ id, title, url: src, effects: defaultEffects(), createdAt: new Date().toISOString(), pending: true }, ...o]); setSelectedId(id);
    fetch(`/api/myinstants?url=${encodeURIComponent(src)}`)
      .then(r => r.ok ? r.blob() : Promise.reject(new Error("proxy")))
      .then(blob => uploadTrack(new File([blob], `${title}.mp3`, { type: blob.type || "audio/mpeg" })))
      .then(url => setTracks(o => patch(o, id, { url, pending: false })))
      .catch(() => setTracks(o => patch(o, id, { pending: false }))); // keep the direct URL as a fallback
  };
  const bakeReverse = async () => {
    if (!selected) return; setBusy(true);
    try { const file = await makeReversedFile(selected.url, selected.title); const url = await uploadTrack(file); setTracks(o => [{ id: crypto.randomUUID(), title: `${selected.title} (reversed)`, url, effects: { ...selected.effects, reverse: false }, createdAt: new Date().toISOString() }, ...o]); }
    catch (err) { alert(`Reverse failed: ${(err as Error).message}`); } finally { setBusy(false); }
  };
  // Save an edited/clipped buffer from the waveform editor as a new cloud-backed track.
  const addProcessedFile = async (file: File, title: string) => { const url = await uploadTrack(file); setTracks(o => [{ id: crypto.randomUUID(), title, url, effects: defaultEffects(), createdAt: new Date().toISOString() }, ...o]); };
  const deleteTrack = (id: string) => { setTracks(o => o.filter(t => t.id !== id)); setSequences(o => o.map(s => ({ ...s, items: s.items.filter(i => i.trackId !== id) }))); if (selectedId === id) setSelectedId(tracks.find(t => t.id !== id)?.id ?? ""); };

  const addSequence = () => { const seq: Sequence = { id: crypto.randomUUID(), name: `Sequence ${sequences.length + 1}`, items: [], createdAt: new Date().toISOString() }; setSequences(o => [...o, seq]); setSequenceId(seq.id); setCueIndex(0); };
  const deleteSequence = (id: string) => { setSequences(o => o.filter(s => s.id !== id)); if (sequenceId === id) setSequenceId(sequences.find(s => s.id !== id)?.id ?? ""); };
  const addItem = () => {
    if (!sequenceId) return;
    const chosen = (selectedIds.length ? selectedIds.map(id => tracks.find(t => t.id === id)) : [selected]).filter(Boolean) as Track[];
    if (!chosen.length) return;
    setSequences(o => o.map(s => s.id !== sequenceId ? s : { ...s, items: [...s.items, ...chosen.map(t => ({ id: crypto.randomUUID(), trackId: t.id, label: t.title, effects: cloneEffects(t.effects) }))] }));
  };
  const deleteItem = (itemId: string) => setSequences(o => o.map(s => s.id !== sequenceId ? s : { ...s, items: s.items.filter(i => i.id !== itemId) }));
  const moveItem = (i: number, dir: -1 | 1) => setSequences(o => o.map(s => { if (s.id !== sequenceId) return s; const j = i + dir; if (j < 0 || j >= s.items.length) return s; const items = [...s.items]; [items[i], items[j]] = [items[j], items[i]]; return { ...s, items }; }));

  const openRename = (kind: "track" | "sequence", id: string, value: string) => { setDraft({ kind, id, value }); renameModal.onOpen(); };
  const commitRename = () => { const { kind, id, value } = draft; const v = value.trim(); if (!v) return; if (kind === "track") setTracks(o => patch(o, id, { title: v })); else setSequences(o => o.map(s => s.id === id ? { ...s, name: v } : s)); };
  const openAudience = () => window.open(`${location.origin}/audience`, "cueflow-audience", "popup,width=1000,height=650");

  return (
    <div className="relative min-h-screen">
      <Backdrop />
      <Nav />
      {/* Bottom padding clears the fixed player, which stacks taller on phones. */}
      <div className="mx-auto max-w-7xl px-4 py-6 pb-60 sm:px-6 sm:pb-44 lg:px-8">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-[11px] font-semibold uppercase tracking-[.3em] text-accent">Studio</p><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Cue board</h1></div>
          {/* Labels collapse to icons on phones — three full-width buttons do not fit a 375px row. */}
          <div className="flex flex-wrap gap-2">
            <Tooltip content="Replay the first-time setup guide" placement="bottom"><Button variant="flat" isIconOnly={false} startContent={<CircleHelp size={17} />} onPress={guideModal.onOpen}><span className="hidden sm:inline">Setup guide</span></Button></Tooltip>
            <Tooltip content="Set the keys for cues and effects" placement="bottom"><Button variant="flat" startContent={<Keyboard size={17} />} onPress={keybindsModal.onOpen}><span className="hidden sm:inline">Keybinds</span></Button></Tooltip>
            <Tooltip content="Opens a black window — drag it to the mirrored display" placement="bottom"><Button color="primary" variant="flat" startContent={<Monitor size={17} />} onPress={openAudience}><span className="hidden sm:inline">Audience display</span></Button></Tooltip>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .05 }} className="mt-6">
          <Tabs selectedKey={tab} onSelectionChange={setTab} classNames={{ tabList: "glass-soft" }}>
            <Tab key="library" id="library" title={<span className="flex items-center gap-2"><Volume2 size={16} />Library</span>}>
              <Library tracks={tracks} selectedId={selected?.id ?? ""} playingId={playing ? selected?.id ?? "" : ""} selectedIds={selectedIds} onPlay={playTrack} onToggleSelect={toggleSelect} onAdd={addFiles} onDelete={deleteTrack} onRename={(id: string) => { const t = tracks.find(x => x.id === id); if (t) openRename("track", id, t.title); }} importSound={importSound} onAddToSequence={addItem} hasSequence={!!sequenceId} />
            </Tab>
            <Tab key="editor" id="editor" title={<span className="flex items-center gap-2"><SlidersHorizontal size={16} />Editor</span>}>
              <Editor track={selected} busy={busy} update={updateEffects} bakeReverse={bakeReverse} onSave={addProcessedFile} onRename={() => selected && openRename("track", selected.id, selected.title)} />
            </Tab>
            <Tab key="sequence" id="sequence" title={<span className="flex items-center gap-2"><ListMusic size={16} />Sequences</span>}>
              <Sequences sequences={sequences} sequenceId={sequenceId} selectSequence={setSequenceId} addSequence={addSequence} deleteSequence={deleteSequence} renameSequence={(id: string) => { const s = sequences.find(x => x.id === id); if (s) openRename("sequence", id, s.name); }} tracks={tracks} selectedTrack={selected} selectedCount={selectedIds.length} addItem={addItem} deleteItem={deleteItem} moveItem={moveItem} playCue={playCue} cueIndex={cueIndex} loopSeq={loopSeq} setLoopSeq={setLoopSeq} startSequence={startSequence} />
            </Tab>
          </Tabs>
        </motion.div>
      </div>

      <AnimatePresence>{selected && <Player key="player" track={selected} playing={playing} toggle={toggle} time={time} duration={duration} seek={seek} jump={jump} loop={loop} setLoop={setLoop} effects={selected.effects} update={updateEffects} />}</AnimatePresence>

      <Modal isOpen={renameModal.isOpen} onOpenChange={renameModal.onOpenChange} placement="center" backdrop="blur">
        <ModalContent>{onClose => (<>
          <ModalHeader>Rename {draft.kind}</ModalHeader>
          <ModalBody><Input autoFocus label="Name" value={draft.value} onValueChange={v => setDraft(d => ({ ...d, value: v }))} onKeyDown={e => { if (e.key === "Enter") { commitRename(); onClose(); } }} /></ModalBody>
          <ModalFooter><Button variant="light" onPress={onClose}>Cancel</Button><Button color="primary" onPress={() => { commitRename(); onClose(); }}>Save</Button></ModalFooter>
        </>)}</ModalContent>
      </Modal>

      <Onboarding control={guideModal} />
      <KeybindsModal disc={keybindsModal} binds={binds} setBinds={setBinds} />
    </div>
  );
}

function Library({ tracks, selectedId, playingId, selectedIds, onPlay, onToggleSelect, onAdd, onDelete, onRename, importSound, onAddToSequence, hasSequence }: any) {
  const count = selectedIds.length;
  return (
    <div className="mt-5 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-accent">Soundboard</p><h2 className="text-xl font-bold">Click a sound to play</h2></div>
        <div className="flex gap-2">
          <Tooltip content={hasSequence ? "" : "Create a sequence first"} isDisabled={hasSequence}><span><Button variant="bordered" startContent={<Plus size={16} />} isDisabled={!hasSequence} onPress={onAddToSequence}>Add {count > 1 ? `${count} ` : ""}to sequence</Button></span></Tooltip>
          <Button as="label" color="primary" startContent={<Upload size={17} />}>Upload<input hidden type="file" accept="audio/*" multiple onChange={onAdd} /></Button>
        </div>
      </div>
      {tracks.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid place-items-center rounded-2xl border border-dashed border-default-200 py-16 text-center">
          <Music size={40} className="text-muted" /><p className="mt-3 font-semibold">No sounds yet</p><p className="text-sm text-muted">Upload files or search Myinstants below.</p>
        </motion.div>
      ) : (
        <motion.div layout className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence>{tracks.map((t: Track, i: number) => {
            const isPlaying = playingId === t.id, isChecked = selectedIds.includes(t.id);
            return (
            <motion.div key={t.id} layout initial={{ opacity: 0, scale: .95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .9 }} transition={{ delay: Math.min(i * .03, .3) }} whileHover={{ y: -3 }}>
              <Card isPressable onPress={() => onPlay(t)} className={`w-full border ${isPlaying ? "border-accent bg-accent/15" : selectedId === t.id ? "border-accent/60 bg-accent/5" : "border-border bg-surface/60"} ${t.pending ? "opacity-70" : ""}`}>
                <CardBody className="gap-2">
                  <div className="flex items-start gap-2">
                    <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${isPlaying ? "bg-accent text-accent-foreground" : "bg-surface-secondary text-foreground"}`}>{t.pending ? <Spinner size="sm" /> : isPlaying ? <Pause fill="currentColor" size={15} /> : <Play fill="currentColor" size={15} />}</span>
                    <p className="min-w-0 flex-1 truncate pt-1.5 font-semibold capitalize leading-tight">{t.title}</p>
                    <div className="flex shrink-0 gap-1">
                      <Tooltip content={isChecked ? "Deselect" : "Select"}><Button isIconOnly size="sm" variant={isChecked ? "solid" : "light"} color={isChecked ? "primary" : "default"} onPress={() => onToggleSelect(t.id)}><Check size={14} /></Button></Tooltip>
                      <Button isIconOnly size="sm" variant="light" onPress={() => onRename(t.id)}><Pencil size={14} /></Button>
                      <Button isIconOnly size="sm" variant="light" color="danger" onPress={() => onDelete(t.id)}><Trash2 size={14} /></Button>
                    </div>
                  </div>
                  {t.error
                    ? <p className="flex items-center gap-1 text-xs text-warning"><TriangleAlert size={12} /> local only — cloud save failed</p>
                    : <p className="pl-10 text-xs text-muted">{t.effects.speed}x • {Math.round(t.effects.volume * 100)}% vol{t.effects.reverb ? " • reverb" : ""}</p>}
                </CardBody>
              </Card>
            </motion.div>
          );})}</AnimatePresence>
        </motion.div>
      )}
      <MyInstantsPanel importSound={importSound} />
    </div>
  );
}

function MyInstantsPanel({ importSound }: { importSound: (title: string, url: string) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ name: string; url: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  const search = async () => {
    const query = q.trim(); if (!query) return; setLoading(true); setNote("");
    try { const r = await fetch(`/api/myinstants?q=${encodeURIComponent(query)}`); const d = await r.json(); setResults(d.items ?? []); if (!d.items?.length) setNote("No results."); }
    catch { setNote("Search unavailable (the proxy runs on the deployed site)."); } finally { setLoading(false); }
  };
  const importUrl = () => { const u = url.trim(); if (!u) return; const title = u.split("/").filter(Boolean).pop()?.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ") || "Sound"; importSound(title, u); setUrl(""); };
  return (
    <div className="glass-soft space-y-3 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold"><Search size={15} className="text-accent" /> Myinstants sync</p>
      <div className="flex flex-wrap gap-2">
        <Input className="flex-1 min-w-56" size="sm" value={q} onValueChange={setQ} placeholder="Search Myinstants (e.g. airhorn, vine boom)" onKeyDown={(e: any) => e.key === "Enter" && search()} />
        <Button size="sm" color="primary" variant="flat" isLoading={loading} onPress={search}>Search</Button>
        <Button size="sm" variant="light" as="a" href="https://www.myinstants.com" target="_blank" endContent={<ExternalLink size={14} />}>Open</Button>
      </div>
      {note && <p className="text-xs text-muted">{note}</p>}
      {results.length > 0 && (
        <motion.div layout className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {results.map(r => (
            <button key={r.url} onClick={() => importSound(r.name, r.url)} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-content2/60 px-3 py-2 text-left text-sm hover:border-accent hover:bg-accent/10">
              <span className="truncate">{r.name}</span><Plus size={15} className="shrink-0 text-accent" />
            </button>
          ))}
        </motion.div>
      )}
      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Input className="flex-1 min-w-56" size="sm" value={url} onValueChange={setUrl} placeholder="…or paste a direct sound URL" onKeyDown={(e: any) => e.key === "Enter" && importUrl()} />
        <Button size="sm" variant="bordered" onPress={importUrl}>Import URL</Button>
      </div>
    </div>
  );
}

function Editor({ track, busy, update, bakeReverse, onSave, onRename }: any) {
  if (!track) return <div className="mt-5 rounded-2xl border border-dashed border-default-200 py-16 text-center text-muted">Select a sound in the Library to edit it.</div>;
  return (
    <div className="mt-5 space-y-6">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-accent">Non-destructive editor</p><h2 className="flex items-center gap-2 text-xl font-bold capitalize">{track.title}<Button isIconOnly size="sm" variant="light" onPress={onRename}><Pencil size={15} /></Button></h2></div>
      <p className="max-w-2xl text-sm text-muted">Effects save with this sound and apply live in playback and sequences. The waveform tools render new cloud-backed WAVs — clip a region, mix to mono, or balance the left/right channels.</p>
      <WaveformEditor track={track} onSave={onSave} />
      <EffectGrid effects={track.effects} update={update} />
      <div className="glass-soft flex flex-wrap items-center gap-4 p-4">
        <Switch isSelected={track.effects.reverse} onValueChange={v => update({ ...track.effects, reverse: v })}>Mark for reverse render</Switch>
        {track.effects.reverse && <Button color="primary" variant="flat" startContent={busy ? <Spinner size="sm" color="current" /> : <RotateCcw size={16} />} isDisabled={busy} onPress={bakeReverse}>Render & save reversed</Button>}
      </div>
    </div>
  );
}

function Sequences({ sequences, sequenceId, selectSequence, addSequence, deleteSequence, renameSequence, tracks, selectedTrack, selectedCount, addItem, deleteItem, moveItem, playCue, cueIndex, loopSeq, setLoopSeq, startSequence }: any) {
  const seq = sequences.find((s: Sequence) => s.id === sequenceId);
  return (
    <div className="mt-5 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-accent">Manual cue deck</p><h2 className="text-xl font-bold">Sequences</h2></div>
        <Button color="primary" startContent={<Plus size={16} />} onPress={addSequence}>New sequence</Button>
      </div>
      {sequences.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {sequences.map((s: Sequence) => (
            <div key={s.id} className={`flex items-center gap-1 rounded-full border px-1 pl-3 ${s.id === sequenceId ? "border-accent bg-accent/15" : "border-border bg-surface/50"}`}>
              <button className="py-1.5 text-sm font-semibold" onClick={() => selectSequence(s.id)}>{s.name}</button>
              <Button isIconOnly size="sm" variant="light" onPress={() => renameSequence(s.id)}><Pencil size={13} /></Button>
              <Button isIconOnly size="sm" variant="light" color="danger" onPress={() => deleteSequence(s.id)}><Trash2 size={13} /></Button>
            </div>
          ))}
        </div>
      )}
      {!seq ? (
        <div className="rounded-2xl border border-dashed border-default-200 py-16 text-center text-muted">Create a sequence, then add sounds from the Library. It never autoplays — drive it with the ← → arrow keys or click a cue.</div>
      ) : (
        <div className="space-y-3">
          <div className="glass-soft flex flex-wrap items-center gap-3 p-3">
            <Button size="sm" color="primary" startContent={<Play size={14} fill="currentColor" />} isDisabled={!seq.items.length} onPress={() => startSequence(false)}>Start</Button>
            <Button size="sm" color="secondary" variant="flat" startContent={<Monitor size={14} />} isDisabled={!seq.items.length} onPress={() => startSequence(true)}>Start in audience mode</Button>
            <Switch size="sm" isSelected={loopSeq} onValueChange={setLoopSeq}>Loop sequence</Switch>
            <span className="ml-auto text-xs text-muted">← → to step through cues</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted">
            <span>{selectedCount > 1 ? <>Adds <b className="text-foreground">{selectedCount} selected sounds</b>.</> : <>Adds the selected sound{selectedTrack ? <> (<b className="text-foreground">{selectedTrack.title}</b>)</> : ""}.</>}</span>
            <Button size="sm" variant="flat" color="primary" startContent={<Plus size={14} />} isDisabled={!selectedTrack && !selectedCount} onPress={addItem}>Add {selectedCount > 1 ? `${selectedCount} cues` : "cue"}</Button>
          </div>
          {seq.items.length === 0 ? <p className="rounded-2xl border border-dashed border-default-200 py-10 text-center text-muted">Empty sequence. Add the selected sound above.</p> : (
            <ol className="space-y-2">
              <AnimatePresence>{seq.items.map((item: SequenceItem, i: number) => (
                <motion.li key={item.id} layout initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }}>
                  <div className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${i === cueIndex ? "border-accent bg-accent/10" : "border-border bg-surface/50"}`}>
                    <button className="flex flex-1 items-center gap-3 text-left" onClick={() => playCue(i)}>
                      <span className="font-mono text-sm text-accent">{String(i + 1).padStart(2, "0")}</span>
                      <span className="font-medium capitalize">{item.label}</span>
                      <span className="ml-auto text-xs text-muted">{tracks.find((t: Track) => t.id === item.trackId)?.title ?? "missing"}</span>
                    </button>
                    <div className="flex shrink-0">
                      <Button isIconOnly size="sm" variant="light" isDisabled={i === 0} onPress={() => moveItem(i, -1)}><ChevronUp size={15} /></Button>
                      <Button isIconOnly size="sm" variant="light" isDisabled={i === seq.items.length - 1} onPress={() => moveItem(i, 1)}><ChevronDown size={15} /></Button>
                      <Button isIconOnly size="sm" variant="light" color="danger" onPress={() => deleteItem(item.id)}><Trash2 size={14} /></Button>
                    </div>
                  </div>
                </motion.li>
              ))}</AnimatePresence>
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function EffectGrid({ effects, update }: { effects: Effects; update: (fx: Effects) => void }) {
  return (
    <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
      {controls.map(c => (
        <Slider key={c.key} size="sm" color="primary" label={c.label} minValue={c.min} maxValue={c.max} step={c.step}
          value={Number(effects[c.key])} onChange={v => update({ ...effects, [c.key]: Array.isArray(v) ? v[0] : v })}
          getValue={v => `${Number(v).toFixed(c.step < .1 ? 2 : 1)}${c.unit ?? ""}`} />
      ))}
    </div>
  );
}

function Player({ track, playing, toggle, time, duration, seek, jump, loop, setLoop, effects, update }: any) {
  const [open, setOpen] = useState(false);
  return (
    <motion.section initial={{ y: 120, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 120, opacity: 0 }} transition={{ type: "spring", stiffness: 260, damping: 30 }}
      className="glass fixed bottom-4 left-1/2 z-20 w-[min(96vw,1080px)] -translate-x-1/2 p-3 sm:p-4">
      {/* Phones get the title above the transport; there is no room for both on one line. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold capitalize">{track.title}</p><p className="text-xs text-muted">{format(time)} / {format(duration)}</p></div>
        <div className="flex items-center justify-center gap-2 sm:gap-4">
          <Tooltip content="Back 5s"><Button isIconOnly variant="flat" radius="full" onPress={() => jump(-5)}><Rewind size={18} /></Button></Tooltip>
          <Button isIconOnly color="primary" radius="full" size="lg" onPress={toggle} className="shadow-lg shadow-accent/30">{playing ? <Pause fill="currentColor" size={22} /> : <Play fill="currentColor" size={22} />}</Button>
          <Tooltip content="Forward 5s"><Button isIconOnly variant="flat" radius="full" onPress={() => jump(5)}><FastForward size={18} /></Button></Tooltip>
          <Tooltip content={loop ? "Looping" : "Loop"}><Button isIconOnly variant={loop ? "solid" : "flat"} color={loop ? "primary" : "default"} radius="full" onPress={() => setLoop((l: boolean) => !l)}><Repeat size={18} /></Button></Tooltip>
          <Tooltip content="Live effects"><Button isIconOnly variant={open ? "solid" : "flat"} color={open ? "primary" : "default"} radius="full" onPress={() => setOpen(o => !o)}><SlidersHorizontal size={18} /></Button></Tooltip>
        </div>
      </div>
      <Slider aria-label="Progress" size="sm" color="primary" className="mt-2" minValue={0} maxValue={duration || 0.0001} step={0.1} value={Math.min(time, duration || 0)} onChange={v => seek(Array.isArray(v) ? v[0] : v)} />
      <AnimatePresence>{open && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
          <div className="mt-3 grid gap-x-6 gap-y-3 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-4">
            {controls.slice(0, 4).map(c => (
              <Slider key={c.key} size="sm" color="primary" label={c.label} minValue={c.min} maxValue={c.max} step={c.step}
                value={Number(effects[c.key])} onChange={v => update({ ...effects, [c.key]: Array.isArray(v) ? v[0] : v })}
                getValue={v => `${Number(v).toFixed(c.step < .1 ? 2 : 1)}${c.unit ?? ""}`} />
            ))}
          </div>
        </motion.div>
      )}</AnimatePresence>
    </motion.section>
  );
}

function KeybindRow({ label, value, onSet }: { label: string; value: string; onSet: (k: string) => void }) {
  const [listening, setListening] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[.03] px-3 py-2">
      <span className="text-sm">{label}</span>
      <button
        className={`min-w-24 rounded-lg border px-3 py-1.5 font-mono text-sm ${listening ? "border-accent bg-accent/15 text-accent" : "border-white/15 bg-white/5"}`}
        onClick={() => setListening(true)} onBlur={() => setListening(false)}
        onKeyDown={e => { if (!listening) return; e.preventDefault(); if (e.key === "Escape") return setListening(false); onSet(e.key); setListening(false); }}
      >{listening ? "Press a key…" : keyLabel(value)}</button>
    </div>
  );
}

function KeybindsModal({ disc, binds, setBinds }: { disc: ReturnType<typeof useDisclosure>; binds: Record<Action, string>; setBinds: (u: (b: Record<Action, string>) => Record<Action, string>) => void }) {
  return (
    <Modal isOpen={disc.isOpen} onOpenChange={disc.onOpenChange} placement="center" backdrop="blur" scrollBehavior="inside">
      <ModalContent>{onClose => (<>
        <ModalHeader className="flex items-center gap-2"><Keyboard size={18} className="text-accent" />Keybinds</ModalHeader>
        <ModalBody className="gap-2">
          <p className="text-xs text-muted">Click a key box, then press a key to bind it. Cue keys work in the Sequences tab; effect keys nudge the currently playing sound.</p>
          {keyActions.map(a => <KeybindRow key={a.id} label={a.label} value={binds[a.id]} onSet={k => setBinds(b => ({ ...b, [a.id]: k }))} />)}
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={() => setBinds(() => defaultBinds)}>Reset defaults</Button>
          <Button color="primary" onPress={onClose}>Done</Button>
        </ModalFooter>
      </>)}</ModalContent>
    </Modal>
  );
}
