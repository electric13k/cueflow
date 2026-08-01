import { ChangeEvent, useEffect, useRef, useState } from "react";
import { Button, Card, CardBody, Input, Slider, Switch, Tab, Tabs, Tooltip, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, useDisclosure, Spinner } from "@heroui/react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronUp, ExternalLink, FastForward, ListMusic, Monitor, Music, Pause, Pencil, Play, Plus, Rewind, RotateCcw, SlidersHorizontal, Trash2, Upload, Volume2 } from "lucide-react";
import { AudioEngine, makeReversedFile } from "./lib/audio";
import { hydrateCloud, local, persist, uploadTrack } from "./lib/store";
import { cloneEffects, defaultEffects, Effects, Sequence, SequenceItem, Track } from "./types";

const format = (s = 0) => Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00";
type Ctl = { key: keyof Effects; label: string; min: number; max: number; step: number; unit?: string };
const controls: Ctl[] = [
  { key: "speed", label: "Speed", min: .5, max: 2, step: .05, unit: "x" }, { key: "volume", label: "Volume", min: 0, max: 1, step: .01 },
  { key: "gain", label: "Gain", min: .1, max: 2, step: .05, unit: "x" }, { key: "reverb", label: "Reverb", min: 0, max: 1, step: .05 },
  { key: "fadeIn", label: "Fade in", min: 0, max: 8, step: .25, unit: "s" }, { key: "fadeOut", label: "Fade out", min: 0, max: 8, step: .25, unit: "s" },
  { key: "distortion", label: "Distortion", min: 0, max: 1, step: .05 },
];

// Pure-black window for the mirrored/projected screen — audience sees nothing of the app.
function Audience() { return <main className="min-h-screen bg-black" />; }

export default function App() {
  const audio = useRef<HTMLAudioElement>(new Audio());
  const engine = useRef(new AudioEngine());
  const [tracks, setTracks] = useState<Track[]>(() => local.get("tracks", []));
  const [sequences, setSequences] = useState<Sequence[]>(() => local.get("sequences", []));
  const [selectedId, setSelectedId] = useState<string>(() => local.get<Track[]>("tracks", [])[0]?.id ?? "");
  const [sequenceId, setSequenceId] = useState<string>(() => local.get<Sequence[]>("sequences", [])[0]?.id ?? "");
  const [cueIndex, setCueIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [tab, setTab] = useState("library");
  const [myInstants, setMyInstants] = useState("");
  const [busy, setBusy] = useState(false);
  const rename = useDisclosure();
  const [draft, setDraft] = useState<{ kind: "track" | "sequence"; id: string; value: string }>({ kind: "track", id: "", value: "" });

  const selected = tracks.find(t => t.id === selectedId) ?? tracks[0];
  const selectedSequence = sequences.find(s => s.id === sequenceId);

  useEffect(() => { void persist(tracks, sequences); }, [tracks, sequences]);
  useEffect(() => { void hydrateCloud().then(cloud => { if (!cloud) return; setTracks(o => [...o, ...cloud.tracks.filter(t => !o.some(e => e.id === t.id))]); setSequences(o => [...o, ...cloud.sequences.filter(s => !o.some(e => e.id === s.id))]); }); }, []);
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
      if (!selectedSequence || ["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) return;
      if (e.key === "ArrowRight") { e.preventDefault(); playCue(Math.min(cueIndex + 1, selectedSequence.items.length - 1)); }
      if (e.key === "ArrowLeft") { e.preventDefault(); playCue(Math.max(cueIndex - 1, 0)); }
    };
    window.addEventListener("keydown", keys); return () => window.removeEventListener("keydown", keys);
  });

  const updateEffects = (fx: Effects) => { if (!selected) return; setTracks(all => all.map(t => t.id === selected.id ? { ...t, effects: fx } : t)); engine.current.apply(audio.current, fx); };
  const play = async (track = selected, fx = selected?.effects) => {
    if (!track || !fx) return;
    if (audio.current.src !== new URL(track.url, location.href).href) { audio.current.src = track.url; audio.current.currentTime = 0; setTime(0); setDuration(0); }
    try { await engine.current.play(audio.current, fx); setPlaying(true); } catch { setPlaying(false); }
  };
  const toggle = () => { if (playing) { audio.current.pause(); setPlaying(false); } else void play(); };
  const jump = (s: number) => { audio.current.currentTime = Math.max(0, Math.min((audio.current.duration || 0), audio.current.currentTime + s)); };
  const seek = (v: number) => { audio.current.currentTime = v; setTime(v); };
  const playCue = (i: number) => { if (!selectedSequence) return; const item = selectedSequence.items[i]; if (!item) return; const track = tracks.find(t => t.id === item.trackId); setCueIndex(i); if (track) void play(track, item.effects); };

  const addFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])].filter(f => f.type.startsWith("audio/")); e.target.value = "";
    if (!files.length) return; setBusy(true);
    try {
      const created = await Promise.all(files.map(async f => ({ id: crypto.randomUUID(), title: f.name.replace(/\.[^.]+$/, ""), url: await uploadTrack(f), effects: defaultEffects(), createdAt: new Date().toISOString() })));
      setTracks(o => [...created, ...o]); setSelectedId(created[0].id);
    } catch (err) { alert(`Upload failed: ${(err as Error).message}`); } finally { setBusy(false); }
  };
  const importMyInstants = async () => {
    const raw = myInstants.trim(); if (!raw) return; setBusy(true); setMyInstants("");
    const title = raw.split("/").filter(Boolean).pop()?.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ") || "Myinstants sound";
    let url = raw;
    try { const res = await fetch(raw); if (res.ok) { const blob = await res.blob(); url = await uploadTrack(new File([blob], `${title}.mp3`, { type: blob.type || "audio/mpeg" })); } } catch { /* CORS-blocked fetch: fall back to the direct URL */ }
    const track: Track = { id: crypto.randomUUID(), title, url, effects: defaultEffects(), createdAt: new Date().toISOString() };
    setTracks(o => [track, ...o]); setSelectedId(track.id); setBusy(false);
  };
  const bakeReverse = async () => {
    if (!selected) return; setBusy(true);
    try { const file = await makeReversedFile(selected.url, selected.title); const track: Track = { id: crypto.randomUUID(), title: `${selected.title} (reversed)`, url: await uploadTrack(file), effects: { ...selected.effects, reverse: false }, createdAt: new Date().toISOString() }; setTracks(o => [track, ...o]); setSelectedId(track.id); }
    catch (err) { alert(`Reverse failed: ${(err as Error).message}`); } finally { setBusy(false); }
  };
  const deleteTrack = (id: string) => { setTracks(o => o.filter(t => t.id !== id)); setSequences(o => o.map(s => ({ ...s, items: s.items.filter(i => i.trackId !== id) }))); if (selectedId === id) setSelectedId(tracks.find(t => t.id !== id)?.id ?? ""); };

  const addSequence = () => { const seq: Sequence = { id: crypto.randomUUID(), name: `Sequence ${sequences.length + 1}`, items: [], createdAt: new Date().toISOString() }; setSequences(o => [...o, seq]); setSequenceId(seq.id); setCueIndex(0); };
  const deleteSequence = (id: string) => { setSequences(o => o.filter(s => s.id !== id)); if (sequenceId === id) setSequenceId(sequences.find(s => s.id !== id)?.id ?? ""); };
  const addItem = () => { if (!selected || !sequenceId) return; setSequences(o => o.map(s => s.id !== sequenceId ? s : { ...s, items: [...s.items, { id: crypto.randomUUID(), trackId: selected.id, label: selected.title, effects: cloneEffects(selected.effects) }] })); };
  const deleteItem = (itemId: string) => setSequences(o => o.map(s => s.id !== sequenceId ? s : { ...s, items: s.items.filter(i => i.id !== itemId) }));
  const moveItem = (i: number, dir: -1 | 1) => setSequences(o => o.map(s => { if (s.id !== sequenceId) return s; const j = i + dir; if (j < 0 || j >= s.items.length) return s; const items = [...s.items]; [items[i], items[j]] = [items[j], items[i]]; return { ...s, items }; }));

  const openRename = (kind: "track" | "sequence", id: string, value: string) => { setDraft({ kind, id, value }); rename.onOpen(); };
  const commitRename = () => { const { kind, id, value } = draft; const v = value.trim(); if (!v) return; if (kind === "track") setTracks(o => o.map(t => t.id === id ? { ...t, title: v } : t)); else setSequences(o => o.map(s => s.id === id ? { ...s, name: v } : s)); };

  const openAudience = () => window.open(`${location.href.split("#")[0]}#/audience`, "cueflow-audience", "popup,width=1000,height=650");

  if (location.hash === "#/audience") return <Audience />;

  return (
    <main className="relative min-h-screen">
      <Backdrop />
      <div className="relative mx-auto max-w-7xl px-4 py-6 pb-40 sm:px-6 lg:px-8">
        <motion.header initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30"><Music size={22} /></div>
            <div><p className="text-[11px] font-semibold uppercase tracking-[.32em] text-primary">Live audio cue system</p><h1 className="text-2xl font-black tracking-tight sm:text-3xl">CueFlow</h1></div>
          </div>
          <Tooltip content="Opens a black window — drag it to the mirrored display" placement="bottom">
            <Button color="primary" variant="flat" startContent={<Monitor size={17} />} onPress={openAudience}>Audience display</Button>
          </Tooltip>
        </motion.header>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .05 }} className="mt-7">
          <Tabs aria-label="Sections" selectedKey={tab} onSelectionChange={k => setTab(String(k))} color="primary" variant="solid" radius="lg" classNames={{ tabList: "bg-content1/60 backdrop-blur" }}>
            <Tab key="library" title={<span className="flex items-center gap-2"><Volume2 size={16} />Library</span>}>
              <Library tracks={tracks} selectedId={selected?.id ?? ""} busy={busy} onSelect={setSelectedId} onAdd={addFiles} onDelete={deleteTrack} onRename={(id: string) => { const t = tracks.find(x => x.id === id); if (t) openRename("track", id, t.title); }} myInstants={myInstants} setMyInstants={setMyInstants} importMyInstants={importMyInstants} onAddToSequence={addItem} hasSequence={!!sequenceId} />
            </Tab>
            <Tab key="editor" title={<span className="flex items-center gap-2"><SlidersHorizontal size={16} />Editor</span>}>
              <Editor track={selected} busy={busy} update={updateEffects} bakeReverse={bakeReverse} onRename={() => selected && openRename("track", selected.id, selected.title)} />
            </Tab>
            <Tab key="sequence" title={<span className="flex items-center gap-2"><ListMusic size={16} />Sequences</span>}>
              <Sequences sequences={sequences} sequenceId={sequenceId} selectSequence={setSequenceId} addSequence={addSequence} deleteSequence={deleteSequence} renameSequence={(id: string) => { const s = sequences.find(x => x.id === id); if (s) openRename("sequence", id, s.name); }} tracks={tracks} selectedTrack={selected} addItem={addItem} deleteItem={deleteItem} moveItem={moveItem} playCue={playCue} cueIndex={cueIndex} />
            </Tab>
          </Tabs>
        </motion.div>
      </div>

      <AnimatePresence>{selected && <Player key="player" track={selected} playing={playing} toggle={toggle} time={time} duration={duration} seek={seek} jump={jump} effects={selected.effects} update={updateEffects} />}</AnimatePresence>

      <Modal isOpen={rename.isOpen} onOpenChange={rename.onOpenChange} placement="center" backdrop="blur">
        <ModalContent>{onClose => (<>
          <ModalHeader>Rename {draft.kind}</ModalHeader>
          <ModalBody><Input autoFocus label="Name" value={draft.value} onValueChange={v => setDraft(d => ({ ...d, value: v }))} onKeyDown={e => { if (e.key === "Enter") { commitRename(); onClose(); } }} /></ModalBody>
          <ModalFooter><Button variant="light" onPress={onClose}>Cancel</Button><Button color="primary" onPress={() => { commitRename(); onClose(); }}>Save</Button></ModalFooter>
        </>)}</ModalContent>
      </Modal>
    </main>
  );
}

function Library({ tracks, selectedId, busy, onSelect, onAdd, onDelete, onRename, myInstants, setMyInstants, importMyInstants, onAddToSequence, hasSequence }: any) {
  return (
    <div className="mt-5 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-primary">Cloud library</p><h2 className="text-xl font-bold">Your soundboard</h2></div>
        <Button as="label" color="primary" startContent={busy ? <Spinner size="sm" color="current" /> : <Upload size={17} />} isDisabled={busy}>Upload audio<input hidden type="file" accept="audio/*" multiple onChange={onAdd} /></Button>
      </div>
      {tracks.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid place-items-center rounded-2xl border border-dashed border-default-200 py-16 text-center">
          <Music size={40} className="text-default-400" /><p className="mt-3 font-semibold">No sounds yet</p><p className="text-sm text-default-500">Upload audio files or import a Myinstants URL to get started.</p>
        </motion.div>
      ) : (
        <motion.div layout className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence>{tracks.map((t: Track, i: number) => (
            <motion.div key={t.id} layout initial={{ opacity: 0, scale: .95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .9 }} transition={{ delay: Math.min(i * .03, .3) }} whileHover={{ y: -3 }}>
              <Card isPressable onPress={() => onSelect(t.id)} className={`w-full border ${selectedId === t.id ? "border-primary bg-primary/10" : "border-default-100 bg-content1/60"}`}>
                <CardBody className="gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold capitalize leading-tight">{t.title}</p>
                    <div className="flex shrink-0 gap-1">
                      <Button isIconOnly size="sm" variant="light" onPress={() => onRename(t.id)}><Pencil size={14} /></Button>
                      <Button isIconOnly size="sm" variant="light" color="danger" onPress={() => onDelete(t.id)}><Trash2 size={14} /></Button>
                    </div>
                  </div>
                  <p className="text-xs text-default-500">{t.effects.speed}x • {Math.round(t.effects.volume * 100)}% vol{t.effects.reverb ? " • reverb" : ""}</p>
                </CardBody>
              </Card>
            </motion.div>
          ))}</AnimatePresence>
        </motion.div>
      )}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-default-100 bg-content1/40 p-4">
        <Input className="flex-1 min-w-56" size="sm" value={myInstants} onValueChange={setMyInstants} placeholder="Paste a Myinstants sound URL" onKeyDown={(e: any) => e.key === "Enter" && importMyInstants()} />
        <Button size="sm" color="primary" variant="flat" isDisabled={busy} onPress={importMyInstants}>Import</Button>
        <Button size="sm" variant="light" as="a" href="https://www.myinstants.com" target="_blank" endContent={<ExternalLink size={14} />}>Browse Myinstants</Button>
        <Tooltip content={hasSequence ? "" : "Create a sequence first"} isDisabled={hasSequence}><span><Button size="sm" variant="bordered" startContent={<Plus size={15} />} isDisabled={!hasSequence} onPress={onAddToSequence}>Add selected to sequence</Button></span></Tooltip>
      </div>
    </div>
  );
}

function Editor({ track, busy, update, bakeReverse, onRename }: any) {
  if (!track) return <div className="mt-5 rounded-2xl border border-dashed border-default-200 py-16 text-center text-default-500">Select a sound in the Library to edit it.</div>;
  return (
    <div className="mt-5 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-primary">Non-destructive editor</p><h2 className="flex items-center gap-2 text-xl font-bold capitalize">{track.title}<Button isIconOnly size="sm" variant="light" onPress={onRename}><Pencil size={15} /></Button></h2></div>
      </div>
      <p className="max-w-2xl text-sm text-default-500">Edits save with this sound and apply live in playback and sequences. Reverse renders a new cloud-backed WAV.</p>
      <EffectGrid effects={track.effects} update={update} />
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-default-100 bg-content1/40 p-4">
        <Switch isSelected={track.effects.reverse} onValueChange={v => update({ ...track.effects, reverse: v })}>Mark for reverse render</Switch>
        {track.effects.reverse && <Button color="primary" variant="flat" startContent={busy ? <Spinner size="sm" color="current" /> : <RotateCcw size={16} />} isDisabled={busy} onPress={bakeReverse}>Render & save reversed</Button>}
      </div>
    </div>
  );
}

function Sequences({ sequences, sequenceId, selectSequence, addSequence, deleteSequence, renameSequence, tracks, selectedTrack, addItem, deleteItem, moveItem, playCue, cueIndex }: any) {
  const seq = sequences.find((s: Sequence) => s.id === sequenceId);
  return (
    <div className="mt-5 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-primary">Manual cue deck</p><h2 className="text-xl font-bold">Sequences</h2></div>
        <Button color="primary" startContent={<Plus size={16} />} onPress={addSequence}>New sequence</Button>
      </div>
      {sequences.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {sequences.map((s: Sequence) => (
            <div key={s.id} className={`flex items-center gap-1 rounded-full border px-1 pl-3 ${s.id === sequenceId ? "border-primary bg-primary/15" : "border-default-100 bg-content1/50"}`}>
              <button className="py-1.5 text-sm font-semibold" onClick={() => selectSequence(s.id)}>{s.name}</button>
              <Button isIconOnly size="sm" variant="light" onPress={() => renameSequence(s.id)}><Pencil size={13} /></Button>
              <Button isIconOnly size="sm" variant="light" color="danger" onPress={() => deleteSequence(s.id)}><Trash2 size={13} /></Button>
            </div>
          ))}
        </div>
      )}
      {!seq ? (
        <div className="rounded-2xl border border-dashed border-default-200 py-16 text-center text-default-500">Create a sequence, then add sounds from the Library. It never autoplays — drive it with the ← → arrow keys or click a cue.</div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-default-500"><span>Adds the selected sound{selectedTrack ? <> (<b className="text-foreground">{selectedTrack.title}</b>)</> : ""}.</span><Button size="sm" variant="flat" color="primary" startContent={<Plus size={14} />} isDisabled={!selectedTrack} onPress={addItem}>Add cue</Button></div>
          {seq.items.length === 0 ? <p className="rounded-2xl border border-dashed border-default-200 py-10 text-center text-default-500">Empty sequence. Add the selected sound above.</p> : (
            <ol className="space-y-2">
              <AnimatePresence>{seq.items.map((item: SequenceItem, i: number) => (
                <motion.li key={item.id} layout initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }}>
                  <div className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${i === cueIndex ? "border-primary bg-primary/10" : "border-default-100 bg-content1/50"}`}>
                    <button className="flex flex-1 items-center gap-3 text-left" onClick={() => playCue(i)}>
                      <span className="font-mono text-sm text-primary">{String(i + 1).padStart(2, "0")}</span>
                      <span className="font-medium capitalize">{item.label}</span>
                      <span className="ml-auto text-xs text-default-500">{tracks.find((t: Track) => t.id === item.trackId)?.title ?? "missing"}</span>
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

function Player({ track, playing, toggle, time, duration, seek, jump, effects, update }: any) {
  const [open, setOpen] = useState(false);
  return (
    <motion.section initial={{ y: 120, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 120, opacity: 0 }} transition={{ type: "spring", stiffness: 260, damping: 30 }}
      className="fixed bottom-4 left-1/2 z-20 w-[min(96vw,1080px)] -translate-x-1/2 rounded-3xl border border-default-100 bg-content1/80 p-3 shadow-2xl backdrop-blur-xl sm:p-4">
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold capitalize">{track.title}</p><p className="text-xs text-default-500">{format(time)} / {format(duration)}</p></div>
        <Tooltip content="Back 5s"><Button isIconOnly variant="flat" radius="full" onPress={() => jump(-5)}><Rewind size={18} /></Button></Tooltip>
        <Button isIconOnly color="primary" radius="full" size="lg" onPress={toggle} className="shadow-lg shadow-primary/30">{playing ? <Pause fill="currentColor" size={22} /> : <Play fill="currentColor" size={22} />}</Button>
        <Tooltip content="Forward 5s"><Button isIconOnly variant="flat" radius="full" onPress={() => jump(5)}><FastForward size={18} /></Button></Tooltip>
        <Tooltip content="Live effects"><Button isIconOnly variant={open ? "solid" : "flat"} color={open ? "primary" : "default"} radius="full" onPress={() => setOpen(o => !o)}><SlidersHorizontal size={18} /></Button></Tooltip>
      </div>
      <Slider aria-label="Progress" size="sm" color="primary" className="mt-2" minValue={0} maxValue={duration || 0.0001} step={0.1} value={Math.min(time, duration || 0)} onChange={v => seek(Array.isArray(v) ? v[0] : v)} />
      <AnimatePresence>{open && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
          <div className="mt-3 grid gap-x-6 gap-y-3 border-t border-default-100 pt-3 sm:grid-cols-2 lg:grid-cols-4">
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

function Backdrop() {
  useEffect(() => {
    const canvas = document.getElementById("bg") as HTMLCanvasElement | null; const gl = canvas?.getContext("webgl"); if (!canvas || !gl) return;
    let raf = 0; const render = () => { canvas.width = innerWidth; canvas.height = innerHeight; gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(.02, .035, .08, 1); gl.clear(gl.COLOR_BUFFER_BIT); raf = requestAnimationFrame(render); }; render();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <><canvas id="bg" aria-hidden className="fixed inset-0 -z-10 h-full w-full" /><div aria-hidden className="fixed inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(34,211,238,.14),transparent)]" /></>;
}
